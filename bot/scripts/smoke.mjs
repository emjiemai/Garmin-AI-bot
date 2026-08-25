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
import { respond } from '../src/ai/agent.js';

let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
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

console.log(`\n5. DeepSeek (${config.ai.model} @ ${config.ai.baseUrl})`);

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

for (const s of SCENARIOS) {
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

console.log(`\n${failures === 0 ? '✅ all checks passed' : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
