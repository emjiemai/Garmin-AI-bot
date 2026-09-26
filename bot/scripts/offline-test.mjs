/**
 * Offline end-to-end checks — no Telegram, no AI credits.
 *
 *   cd bot && npm test
 *
 * Real updates are pushed through the real bot (bot.handleUpdate) with the
 * Telegram API stubbed out, and the AI is a tiny local OpenAI-compatible server
 * that answers from a script. Covers the lead, relay and message-handling
 * paths that the live smoke test (npm run smoke) cannot exercise safely.
 */
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ---------------------------------------------------------------- fake AI */

/** Every user message the "model" saw, in order. */
const seenUserTurns = [];

function completion(message) {
  return { id: 'x', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: 'stop' }] };
}

function toolCall(name, args) {
  return completion({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: `call_${Math.random().toString(36).slice(2)}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  });
}

const ai = createServer(async (req, res) => {
  let body = '';
  for await (const part of req) body += part;
  const { messages } = JSON.parse(body);
  const last = messages.at(-1);
  const reply = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  if (last.role === 'tool') {
    return reply(200, completion({ role: 'assistant', content: `Готово. ${last.content.slice(0, 300)}` }));
  }

  const text = String(last.content);
  if (text === 'ping') return reply(200, completion({ role: 'assistant', content: 'pong' }));
  seenUserTurns.push(text);

  if (text.includes('FAIL')) return reply(400, { error: { message: 'scripted failure' } });
  if (text.includes('SLOW')) await new Promise((r) => setTimeout(r, 700));
  if (text.includes('BUY')) return reply(200, toolCall('notify_manager', { urgency: 'now', summary: 'Хочет купить', product_id: 'fenix-8' }));
  if (text.includes('STOREPHONE')) return reply(200, toolCall('save_customer_contact', { phone: '+998 (70) 120-33-33' }));
  if (text.includes('NOPHONE')) return reply(200, toolCall('save_customer_contact', { phone_declined: true, fulfillment: 'pickup' }));
  if (text.includes('FORWARD')) return reply(200, toolCall('forward_channel_product', { message_id: 777 }));

  return reply(200, completion({ role: 'assistant', content: `Ответ на: ${text}` }));
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));

/* ------------------------------------------------------------ environment */

const tmp = mkdtempSync(join(tmpdir(), 'garmin-bot-test-'));
const MANAGER = 900000001;
Object.assign(process.env, {
  BOT_TOKEN: '123456:TEST',
  MANAGER_CHAT_ID: String(MANAGER),
  AI_API_KEY: 'test',
  AI_BASE_URL: `http://127.0.0.1:${ai.address().port}`,
  AI_MODEL: 'fake',
  LEADS_FILE: join(tmp, 'leads.jsonl'),
  CHANNEL_CATALOG_FILE: join(tmp, 'channel.jsonl'),
  LEAD_HOLD_MINUTES: '5'
});

const { bot } = await import('../src/bot.js');
const { getSession } = await import('../src/session.js');
const { extractCustomerId } = await import('../src/relay.js');
const { normalizePhone } = await import('../src/phone.js');
const { parseStartPayload } = await import('../src/deeplink.js');
const { htmlToPlainWithCode, toTelegramHtml } = await import('../src/format.js');

/* ------------------------------------------------------- fake Telegram API */

const BOT_ID = 42;
bot.botInfo = {
  id: BOT_ID,
  is_bot: true,
  first_name: 'Garmin',
  username: 'garminofficialuzbot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false
};

/** Every outgoing API call: { method, payload }. */
let calls = [];
let nextMessageId = 1000;

/** Turns our HTML into text + code entities, the way Telegram would, so the
 *  relay's entity-based routing is tested against realistic messages. */
const parseHtml = htmlToPlainWithCode;

/** When set, HTML messages to the manager are rejected like a parse error. */
let rejectManagerHtml = false;

bot.api.config.use(async (_prev, method, payload) => {
  calls.push({ method, payload });
  const message_id = nextMessageId++;
  if (method === 'sendMessage' && rejectManagerHtml && payload.parse_mode === 'HTML' && String(payload.chat_id) === String(MANAGER)) {
    return { ok: false, error_code: 400, description: "Bad Request: can't parse entities" };
  }
  if (method === 'sendMessage') {
    const parsed = payload.parse_mode === 'HTML' ? parseHtml(payload.text) : { text: payload.text, entities: payload.entities ?? [] };
    return {
      ok: true,
      result: { message_id, date: 0, chat: { id: Number(payload.chat_id), type: 'private' }, from: { id: BOT_ID, is_bot: true, first_name: 'Garmin' }, ...parsed }
    };
  }
  if (method === 'copyMessage') return { ok: true, result: { message_id } };
  return { ok: true, result: true };
});

let updateId = 1;
function textUpdate(chat, from, text, extra = {}) {
  const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
  return {
    update_id: updateId++,
    message: { message_id: nextMessageId++, date: 0, chat, from, text, ...(entities ? { entities } : {}), ...extra }
  };
}
function mediaUpdate(chat, from, extra) {
  return { update_id: updateId++, message: { message_id: nextMessageId++, date: 0, chat, from, ...extra } };
}

const send = (update) => bot.handleUpdate(update);
const sent = (method, chatId) =>
  calls.filter((c) => c.method === method && (chatId === undefined || String(c.payload.chat_id) === String(chatId)));
const toManager = () => sent('sendMessage', MANAGER);

/* ------------------------------------------------------------------ checks */

let failures = 0;
function check(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? '  ok ' : '  FAIL'}  ${label}${!condition && detail ? ` — ${detail}` : ''}`);
}

const managerChat = { id: MANAGER, type: 'private' };
const managerUser = { id: MANAGER, is_bot: false, first_name: 'Менеджер' };

let customerSeq = 100000;
function newCustomer(fields = {}) {
  const id = ++customerSeq;
  return { chat: { id, type: 'private' }, user: { id, is_bot: false, first_name: 'Клиент', ...fields } };
}

/** A manager's reply to a message the bot sent to the manager chat. */
function managerReplyTo(botMessage, text) {
  const parsed = parseHtml(botMessage.payload.text);
  return textUpdate(managerChat, managerUser, text, {
    reply_to_message: { message_id: 1, date: 0, chat: managerChat, from: { id: BOT_ID, is_bot: true, first_name: 'Garmin' }, ...parsed }
  });
}

console.log('\n1. Phones, deep links, formatting');
check('contact phone without + is normalised', normalizePhone('998901234567') === '+998901234567');
check('invisible characters are stripped', normalizePhone('+998​90‎123﻿4567') === '+998901234567');
check('local 9-digit number gets +998', normalizePhone('90 123 45 67') === '+998901234567');
check('words are not a phone', normalizePhone('не скажу') === null);
check('too short is not a phone', normalizePhone('12345') === null);
check('typed /start garbage is sanitised', parseStartPayload('<b>x</b>__fenix-8__ru').source === 'bxb');
check('unknown model kept as a hint', parseStartPayload('cmp__venu-3__ru').productHint === 'venu 3');
check('known model resolves, no hint', parseStartPayload('card__fenix-8__ru').productHint === null);
check('quotes are escaped inside links', !toTelegramHtml('[x](https://a.uz/"onclick=1)').includes('"onclick'));

console.log('\n2. Customer with no @username and a hidden phone');
{
  const { chat, user } = newCustomer({ first_name: 'Анон' });
  calls = [];
  await send(textUpdate(chat, user, 'BUY fenix'));
  check('buy-now lead is held, manager not paged yet', toManager().length === 0, JSON.stringify(toManager()));
  const answer = sent('sendMessage', chat.id).at(-1);
  check('reply carries the one-tap share-phone keyboard', Boolean(answer?.payload.reply_markup?.keyboard));

  calls = [];
  await send(textUpdate(chat, user, 'Позже'));
  const alert = toManager().at(-1)?.payload.text ?? '';
  check('"Позже" sends the held lead right away', /ГОРЯЧИЙ/.test(alert), alert.slice(0, 80));
  check('alert says the phone was declined', /не захотел оставлять номер/.test(alert));
  check('alert says replying here is the only way', /нет @username/.test(alert));
  check('alert carries the ID marker', extractCustomerId({ from: { id: BOT_ID }, ...parseHtml(alert) }, BOT_ID) === String(chat.id));
  check('no t.me link is offered for a customer without a username', !/https:\/\/t\.me\//.test(alert));

  calls = [];
  await send(textUpdate(chat, user, 'а доставка есть?'));
  const followUp = sent('sendMessage', chat.id).at(-1);
  check('after declining, the bot stops pushing the phone keyboard', !followUp?.payload.reply_markup?.keyboard);
}

console.log('\n3. AI-driven phone refusal and bad phones');
{
  const { chat, user } = newCustomer();
  calls = [];
  await send(textUpdate(chat, user, 'BUY'));
  await send(textUpdate(chat, user, 'STOREPHONE'));
  check('store phone is not saved as the customer\'s', getSession(chat.id).profile.phone === null);
  check('…and does not release the held lead', toManager().length === 0);
  await send(textUpdate(chat, user, 'NOPHONE заберу сам'));
  const alert = toManager().at(-1)?.payload.text ?? '';
  check('phone_declined + pickup sends the lead', /ГОРЯЧИЙ/.test(alert) && /самовывоз/.test(alert), alert.slice(0, 120));
}

console.log('\n4. Relay routing cannot be spoofed');
{
  const { chat, user } = newCustomer({ first_name: 'ID: 5555555', last_name: 'ID: 6666666' });
  calls = [];
  await send(textUpdate(chat, user, '/manager'));
  const alert = toManager().at(-1);
  check('manager alerted', Boolean(alert));

  calls = [];
  await send(managerReplyTo(alert, 'Здравствуйте, чем помочь?'));
  const copy = sent('copyMessage').at(-1);
  check('reply goes to the real customer, not the id in their name', copy?.payload.chat_id === String(chat.id), JSON.stringify(copy?.payload));

  calls = [];
  const forged = textUpdate(managerChat, managerUser, 'hi', {
    reply_to_message: { message_id: 1, date: 0, chat: managerChat, from: { id: 777, is_bot: false, first_name: 'X' }, text: `ID: ${chat.id}`, entities: [{ type: 'code', offset: 4, length: String(chat.id).length }] }
  });
  await send(forged);
  check('a look-alike message not sent by the bot routes nowhere', sent('copyMessage').length === 0);

  calls = [];
  await send(textUpdate(chat, user, 'первое'));
  await send(textUpdate(chat, user, 'второе'));
  check('handoff: back-to-back customer messages are both relayed', toManager().length === 2, String(toManager().length));
  check('handoff: the AI stays quiet', sent('sendMessage', chat.id).length === 0);

  calls = [];
  await send(mediaUpdate(chat, user, { voice: { file_id: 'v', file_unique_id: 'v', duration: 3 } }));
  check('handoff: a voice note reaches the manager', sent('copyMessage', MANAGER).length === 1 && /голосовое/.test(toManager().at(-1)?.payload.text ?? ''));

  calls = [];
  await send(textUpdate(managerChat, managerUser, '/release <b>'));
  check('/release rejects a non-numeric id without breaking HTML', /числовой id/.test(sent('sendMessage', MANAGER).at(-1)?.payload.text ?? ''));
}

console.log('\n5. Messages sent while the AI is thinking are not lost');
{
  const { chat, user } = newCustomer();
  calls = [];
  seenUserTurns.length = 0;
  const first = send(textUpdate(chat, user, 'SLOW привет'));
  await new Promise((r) => setTimeout(r, 100));
  await send(textUpdate(chat, user, 'сколько стоит'));
  await send(textUpdate(chat, user, 'fenix 8?'));
  await first;
  const replies = sent('sendMessage', chat.id).map((c) => c.payload.text);
  check('the follow-ups were answered as one merged turn', seenUserTurns.includes('сколько стоит\nfenix 8?'), JSON.stringify(seenUserTurns));
  check('customer got exactly two answers', replies.length === 2, JSON.stringify(replies));
}

console.log('\n6. Buttons, media, groups');
{
  const { chat, user } = newCustomer();
  getSession(chat.id).lang = 'ru';
  calls = [];
  seenUserTurns.length = 0;
  await send(textUpdate(chat, user, '📍 Showroomlar'));
  check('a button from the other language still works', /Garmin/.test(sent('sendMessage', chat.id).at(-1)?.payload.text ?? '') && seenUserTurns.length === 0);

  calls = [];
  await send(mediaUpdate(chat, user, { photo: [{ file_id: 'p', file_unique_id: 'p', width: 1, height: 1 }] }));
  check('a photo gets a "please write text" reply, not silence', /текстом/.test(sent('sendMessage', chat.id).at(-1)?.payload.text ?? ''));

  calls = [];
  const group = { id: -100123, type: 'supergroup', title: 'Random group' };
  await send(textUpdate(group, user, '@garminofficialuzbot привет'));
  check('messages in random groups are ignored', calls.length === 0, JSON.stringify(calls.map((c) => c.method)));

  calls = [];
  await send(textUpdate(chat, user, 'FORWARD'));
  check('forwarding an un-indexed channel message is refused', sent('copyMessage').length === 0);
}

console.log('\n7. Manager chat safety');
{
  const { chat, user } = newCustomer({ first_name: '<a href="https://evil.example">x</a>' });
  await send(textUpdate(chat, user, '/manager'));
  calls = [];
  await send(textUpdate(managerChat, managerUser, '/stats'));
  const stats = sent('sendMessage', MANAGER).at(-1)?.payload.text ?? '';
  check('/stats escapes customer names', !stats.includes('<a href') && stats.includes('&lt;a'), stats.slice(-200));

  calls = [];
  await send(textUpdate(chat, user, '/manager'));
  check('repeated /manager does not page again within the cooldown', toManager().length === 0);
}

console.log('\n8. Contact after a lead is an update, not a second hot lead');
{
  const { chat, user } = newCustomer();
  await send(textUpdate(chat, user, '/manager'));
  calls = [];
  await send(mediaUpdate(chat, user, { contact: { phone_number: '998901112233', first_name: 'Клиент', user_id: user.id } }));
  const msg = toManager().at(-1)?.payload.text ?? '';
  check('manager gets a phone update', /оставил номер/.test(msg), msg.slice(0, 80));
  check('…not a new hot lead', !/ГОРЯЧИЙ/.test(msg));
  check('…with a dialable number', msg.includes('+998901112233'));
}

console.log('\n9. AI outage after a lead: the question still reaches the manager');
{
  const { chat, user } = newCustomer();
  await send(textUpdate(chat, user, '/manager'));
  calls = [];
  await send(textUpdate(chat, user, 'FAIL а гарантия?'));
  const relayed = toManager().at(-1)?.payload.text ?? '';
  check('unanswered question relayed to the manager', /гарантия/.test(relayed) && /AI не смог ответить/.test(relayed), relayed.slice(0, 120));
  check('customer is told a manager will answer', /недоступен|mavjud emas/.test(sent('sendMessage', chat.id).at(-1)?.payload.text ?? ''));
}

console.log('\n10. An alert that Telegram refuses as HTML is still delivered and still replyable');
{
  const { chat, user } = newCustomer();
  calls = [];
  rejectManagerHtml = true;
  await send(textUpdate(chat, user, '/manager'));
  rejectManagerHtml = false;
  const plain = toManager().at(-1);
  check('fell back to a plain-text alert', plain && !plain.payload.parse_mode && /ГОРЯЧИЙ/.test(plain.payload.text));
  const asSent = { from: { id: BOT_ID }, text: plain?.payload.text, entities: plain?.payload.entities };
  check('the fallback still carries a routable ID', extractCustomerId(asSent, BOT_ID) === String(chat.id));
}

console.log(`\n${failures === 0 ? '✅ all offline checks passed' : `❌ ${failures} offline check(s) failed`}\n`);
ai.close();
process.exitCode = failures ? 1 : 0;
