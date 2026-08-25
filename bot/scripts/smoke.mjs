/**
 * Offline sanity check — exercises the catalog, the DeepSeek connection and the
 * full tool-calling loop without touching Telegram.
 *
 *   cd bot && npm run smoke
 *
 * Manager alerts are stubbed out, so nothing is sent to a real chat.
 */
import { config } from '../src/config.js';
import { catalog, searchProducts, getProduct } from '../src/catalog/catalog.js';
import { detectLang } from '../src/i18n.js';
import { parseStartPayload } from '../src/deeplink.js';
import { toTelegramHtml } from '../src/format.js';
import { getSession } from '../src/session.js';
import { checkAiHealth, respond } from '../src/ai/agent.js';

let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Prints the tally and exits. Calling process.exit() directly trips a libuv
 * assertion on Windows while the HTTP client still holds keep-alive sockets, so
 * set the code and let the runtime tear down in its own time.
 */
function finish() {
  console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

console.log(`\n1. Catalog (${catalog.products.length} products)`);
check('products loaded', catalog.products.length > 40);
check('branches loaded', catalog.branches.length >= 2);
check('faq loaded', catalog.faq.length >= 3);
check('cyrillic model search', searchProducts('феникс 8').length > 0);
check('latin model search', searchProducts('forerunner').length > 0);
check('budget filter', searchProducts('', { maxPrice: 3_000_000 }).every((p) => p.price <= 3_000_000));
check('id lookup', getProduct(catalog.products[0].id)?.id === catalog.products[0].id);

console.log('\n2. Language detection');
check('russian', detectLang('Сколько стоит fenix 8?') === 'ru');
check('uzbek', detectLang('Salom, narxi qancha?') === 'uz');

console.log('\n3. Deep links (round trip with web/js/telegram.js)');
{
  // Mirrors botLink() in the web app; kept in step by the assertions below.
  const link = (src, id, lang) =>
    `${src}__${id ?? '-'}__${lang === 'uz' ? 'uz' : 'ru'}`;

  const card = parseStartPayload(link('card', 'fenix-8', 'ru'));
  check('product resolved', card.productId === 'fenix-8', card.productId ?? 'null');
  check('source parsed', card.source === 'card');
  check('lang parsed', card.lang === 'ru');

  const uz = parseStartPayload(link('quiz', 'instinct-3-amoled', 'uz'));
  check('uzbek payload', uz.lang === 'uz' && uz.productId === 'instinct-3-amoled');

  const none = parseStartPayload(link('cta', null, 'uz'));
  check('no-product placeholder', none.productId === null && none.lang === 'uz');

  const sku = catalog.products.find((p) => /^010-/.test(p.id));
  check('sku-style id', parseStartPayload(link('card', sku.id, 'ru')).productId === sku.id, sku.id);

  const stale = parseStartPayload(link('card', 'model-that-was-discontinued', 'ru'));
  check('stale id rejected', stale.productId === null && stale.lang === 'ru');

  check('empty payload safe', parseStartPayload('').productId === null);
  check('garbage payload safe', parseStartPayload('!!!').productId === null);

  const allFit = catalog.products.every((p) => link('card', p.id, 'ru').length <= 64);
  check('all payloads within 64 chars', allFit);
}

console.log('\n4. Markdown -> Telegram HTML');
{
  const cases = [
    ['**bold**', '<b>bold</b>'],
    ['*bold*', '<b>bold</b>'],
    ['- item', '• item'],
    ['<script>x</script>', '&lt;script&gt;x&lt;/script&gt;'],
    ['[link](https://a.uz/b)', '<a href="https://a.uz/b">link</a>']
  ];
  for (const [input, expected] of cases) {
    const out = toTelegramHtml(input);
    check(`${JSON.stringify(input)} -> ${expected}`, out === expected, out);
  }
  check('unbalanced bold does not leak', !toTelegramHtml('**oops').includes('*'));
}

console.log('\n5. Webhook secret sanitising');
{
  // Telegram: secret_token is 1-256 chars of A-Z a-z 0-9 _ - only.
  const LEGAL = /^[A-Za-z0-9_-]{1,256}$/;

  // Same shape as what Render's `generateValue: true` produces — 32 random
  // bytes in standard base64, so it carries the '+' and '=' that made
  // setWebhook fail with "secret token contains illegal characters".
  const renderGenerated = Buffer.from('a/b+c'.repeat(8)).toString('base64');

  const clean = (raw) =>
    raw
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 256);

  check('render base64 value is rejected as-is', !LEGAL.test(renderGenerated));
  check('sanitised value is legal', LEGAL.test(clean(renderGenerated)), clean(renderGenerated));
  check('base64url chars survive', clean('a-b_c') === 'a-b_c');
  check('slashes fold to underscore', clean('a/b') === 'a_b');
  check('over-long value is truncated', clean('x'.repeat(400)).length === 256);
  check('config value is legal or empty', !config.telegram.webhookSecret || LEGAL.test(config.telegram.webhookSecret));
}

console.log(`\n6. DeepSeek (${config.ai.model} @ ${config.ai.baseUrl})`);

const aiProblem = await checkAiHealth();
if (aiProblem) {
  failures++;
  console.log(`\n  FAIL  DeepSeek is unreachable — ${aiProblem}`);
  if (aiProblem.startsWith('auth')) {
    console.log('\n  The API key is rejected. Generate a new one at');
    console.log('  https://platform.deepseek.com/api_keys and set DEEPSEEK_API_KEY.');
    console.log('  Keys that have been posted publicly are revoked automatically.');
  } else if (aiProblem.startsWith('billing')) {
    console.log('\n  The account has no credit. Top up at platform.deepseek.com.');
  }
  console.log('\n  Skipping the conversation scenarios.');
}

/** Stand-in for the grammY Bot: records manager alerts instead of sending them. */
const alerts = [];
const fakeBot = {
  api: {
    async sendMessage(chatId, text) {
      alerts.push({ chatId, text });
      return { message_id: alerts.length };
    }
  }
};
const fakeUser = { id: 999, first_name: 'Тест', username: 'testuser' };

const SCENARIOS = [
  {
    label: 'RU • spec question should call a tool',
    lang: 'ru',
    text: 'Привет! Сколько держит батарея у fenix 8 и сколько он стоит?',
    expectTool: true,
    expectAlert: false
  },
  {
    label: 'UZ • must answer in Uzbek',
    lang: 'uz',
    text: 'Salom! Yugurish uchun 6 million so\'mgacha qanday soat tavsiya qilasiz?',
    expectTool: true,
    expectAlert: false
  },
  {
    label: 'RU • ready-to-buy should escalate to the manager',
    lang: 'ru',
    text: 'Беру fenix 8, хочу забрать сегодня. Мой номер +998901234567, зовут Алишер. Как оплатить?',
    expectTool: true,
    expectAlert: true
  }
];

for (const s of aiProblem ? [] : SCENARIOS) {
  const before = alerts.length;
  const session = getSession(`smoke-${s.label}`);
  session.lang = s.lang;

  const started = Date.now();
  try {
    const { text, toolsUsed } = await respond({
      bot: fakeBot,
      session,
      user: fakeUser,
      userText: s.text
    });
    const ms = Date.now() - started;

    console.log(`\n  ${s.label}  (${ms} ms, tools: ${toolsUsed.join(', ') || 'none'})`);
    console.log(`  > ${s.text}`);
    console.log(`  < ${text.replace(/\n/g, '\n    ')}`);

    check('replied', text.length > 10);
    if (s.expectTool) check('used a tool', toolsUsed.length > 0);
    if (s.expectAlert) {
      check('alerted manager', alerts.length > before);
      const last = alerts.at(-1);
      check('alert is hot', last && /ГОРЯЧИЙ/.test(last.text), last?.text.split('\n')[0]);
    }
    if (s.lang === 'uz') {
      check('answered in latin script', !/[\u0400-\u04FF]{6,}/.test(text));
    }
  } catch (err) {
    failures++;
    console.log(`\n  FAIL  ${s.label} — ${err.message}`);
  }
}

finish();
