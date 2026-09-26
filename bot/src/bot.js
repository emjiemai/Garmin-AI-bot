import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { config } from './config.js';
import { catalog, formatPrice, getProduct, productName } from './catalog/catalog.js';
import { LANGS, detectLang, normalizeLang, t } from './i18n.js';
import { escapeHtml, toTelegramHtml, unescapeHtml } from './format.js';
import { parseStartPayload } from './deeplink.js';
import { getSession, resetHistory, sessionCount, takeAiTurn } from './session.js';
import { classifyAiError, isFatalAiError, respond } from './ai/agent.js';
import { alertManager, notifyContactUpdate } from './leads/notify.js';
import { flushPendingLead, missingForHotLead } from './leads/pending.js';
import { leadStats, recentLeads } from './leads/store.js';
import { indexChannelPost, channelCatalogSize } from './channelCatalog.js';
import { sendProductPhoto } from './media.js';
import { normalizePhone } from './phone.js';
import {
  beginHandoff,
  endHandoff,
  extractCustomerId,
  inHandoff,
  parseCustomerId,
  relayToManager
} from './relay.js';

export const bot = new Bot(config.telegram.token);

const TELEGRAM_MAX = 4096;

/** Messages that arrive while the AI is still answering are held and answered
 *  together afterwards. Bounded so a flood can't build an unbounded prompt. */
const MAX_QUEUED = 8;
const MAX_MERGED_CHARS = 4000;

/** Repeated /manager taps inside this window don't page the manager again. */
const MANAGER_CALL_COOLDOWN_MS = 10 * 60 * 1000;

/** Systemic AI failures (bad key, no balance) hit every customer at once. The
 *  operator only needs telling once — see handleAiFailure. */
let lastSystemicNotice = 0;
const SYSTEMIC_NOTICE_MS = 30 * 60 * 1000;

/* ------------------------------------------------------------------ helpers */

/** Splits on paragraph boundaries so long AI answers stay readable. */
function chunk(text) {
  if (text.length <= TELEGRAM_MAX) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > TELEGRAM_MAX) {
    let cut = rest.lastIndexOf('\n\n', TELEGRAM_MAX);
    if (cut < TELEGRAM_MAX / 2) cut = rest.lastIndexOf('\n', TELEGRAM_MAX);
    if (cut < TELEGRAM_MAX / 2) cut = rest.lastIndexOf(' ', TELEGRAM_MAX);
    if (cut <= 0) cut = TELEGRAM_MAX;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Converts the model's Markdown to Telegram HTML and sends it. `toTelegramHtml`
 * escapes first and re-adds tags, so a parse error should be impossible — but we
 * still fall back to plain text rather than drop a customer's answer on the floor.
 */
async function safeSend(ctx, text, extra = {}) {
  const html = toTelegramHtml(text);
  for (const part of chunk(html)) {
    try {
      await ctx.reply(part, { parse_mode: 'HTML', ...extra });
    } catch (err) {
      if (!/parse entities/i.test(err.message ?? '')) throw err;
      console.warn('[bot] HTML parse failed, sending plain:', err.message);
      await ctx.reply(unescapeHtml(part.replace(/<[^>]+>/g, '')), extra);
    }
  }
}

function mainKeyboard(lang) {
  return new Keyboard()
    // Opens as a Telegram Mini App (in-app WebView), not an external browser.
    .webApp(t(lang, 'btnCatalog'), config.business.webAppUrl)
    .text(t(lang, 'btnShowrooms'))
    .row()
    .requestContact(t(lang, 'btnSharePhone'))
    .text(t(lang, 'btnContact'))
    .resized()
    .persistent();
}

function langKeyboard() {
  return new InlineKeyboard().text('🇷🇺 Русский', 'lang:ru').text("🇺🇿 O'zbekcha", 'lang:uz');
}

/** One-tap native contact share, front and center — used right after purchase
 *  intent so the customer never has to type their number. Hides itself after
 *  one tap (share or skip); the handlers below restore mainKeyboard. */
function contactKeyboard(lang) {
  return new Keyboard()
    .requestContact(t(lang, 'btnSharePhone'))
    .row()
    .text(t(lang, 'btnSkipPhone'))
    .resized()
    .oneTime();
}

/**
 * `reply_markup` extra to attach the one-tap contact button to a message we're
 * already sending — never a separate follow-up. A second message saying
 * "please share your number" right after the assistant just said "the manager
 * already has everything" reads as a contradiction and trains customers to
 * ignore it. One message, one ask — and none at all once the customer has said
 * they won't share a number.
 */
function phoneRequestExtra(session) {
  return session.profile.phone || session.profile.phoneDeclined
    ? {}
    : { reply_markup: contactKeyboard(session.lang) };
}

/**
 * Reply-keyboard buttons arrive as ordinary text in whatever language the
 * keyboard was drawn in. The session language can change after that (the
 * customer writes in Uzbek, /lang), so a tap is matched against every
 * language, not just the current one — otherwise it would be sent to the AI as
 * the literal text "📍 Шоурумы".
 */
function isButton(text, key) {
  return LANGS.some((lang) => t(lang, key) === text);
}

function isManager(ctx) {
  return String(ctx.chat?.id) === String(config.telegram.managerChatId);
}

/** Matches a chat against CHANNEL_CATALOG_ID, by numeric id or @username
 *  (leading @ optional on either side, comparison case-insensitive). */
function isChannelCatalogChat(chat) {
  const configured = config.channelCatalog.id.replace(/^@/, '').toLowerCase();
  if (String(chat?.id) === configured) return true;
  const username = chat?.username?.toLowerCase();
  return Boolean(username) && username === configured;
}

/** Keeps Telegram's "typing…" indicator up while the AI thinks. It clears after
 *  ~5s on its own, so refresh it. Never throws — a failed chat action (the
 *  customer blocked the bot) is not an AI failure. */
function startTyping(ctx) {
  const send = () => ctx.replyWithChatAction('typing').catch(() => {});
  send();
  const timer = setInterval(send, 4500);
  return () => clearInterval(timer);
}

/* --------------------------------------------------------------- chat scope */

/**
 * The bot serves customers one-to-one. Anyone can add a bot to a group, and
 * there every mention or reply would be answered by the AI on our bill, with
 * the whole group treated as one "customer". Only private chats, the manager
 * chat and the catalog channel get through.
 */
bot.use(async (ctx, next) => {
  if (ctx.channelPost || ctx.editedChannelPost) return next();
  if (!ctx.chat || ctx.chat.type === 'private' || isManager(ctx)) return next();
});

/* ----------------------------------------------------------------- commands */

bot.command('start', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const { source, productId, productHint, lang } = parseStartPayload(ctx.match);

  const picked = lang ?? normalizeLang(ctx.from?.language_code) ?? session.lang;
  session.lang = picked;
  if (lang) session.langLocked = true;

  session.context = { productId, productHint, source: source ?? 'direct' };
  resetHistory(ctx.chat.id);

  const product = productId ? getProduct(productId) : null;

  const greeting = product
    ? t(session.lang, 'welcomeProduct', productName(product, session.lang), formatPrice(product.price, session.lang))
    : t(session.lang, 'welcome');

  await safeSend(ctx, greeting, { reply_markup: mainKeyboard(session.lang) });

  // Arriving with a product in hand is already a buying signal worth logging.
  if (product) {
    // Show the real photo right away — the customer already told us which
    // model they want by tapping through from the web app, no need to ask.
    await sendProductPhoto(bot, session, product, session.lang);

    session.history.push({
      role: 'assistant',
      content: `[Клиент открыл чат из веб-приложения, интересуется моделью ${product.name}]`
    });
  } else if (productHint) {
    session.history.push({
      role: 'assistant',
      content: `[Клиент открыл чат из веб-приложения, интересуется моделью «${productHint}» — её нет в каталоге бота]`
    });
  }
});

bot.command('lang', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await ctx.reply(t(session.lang, 'chooseLang'), { reply_markup: langKeyboard() });
});

bot.command('reset', async (ctx) => {
  const session = resetHistory(ctx.chat.id);
  await safeSend(ctx, t(session.lang, 'reset'), { reply_markup: mainKeyboard(session.lang) });
});

bot.command('help', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await safeSend(ctx, t(session.lang, 'help'));
});

/** Explicit "get me a human" — always a hot alert, no AI in the loop. */
async function callManager(ctx, session, reason) {
  if (session.lead.pending) {
    // An order was already being collected — send that one, now, with the
    // request for a human noted, rather than a second separate alert.
    session.lead.pending.summary = `${session.lead.pending.summary}\n${reason}`;
    await flushPendingLead(bot, session, 'immediate');
    session.managerCalledAt = Date.now();
  } else if (Date.now() - session.managerCalledAt > MANAGER_CALL_COOLDOWN_MS) {
    await alertManager(bot, {
      urgency: 'now',
      user: ctx.from,
      session,
      summary: reason,
      productId: session.context.productId,
      productQuery: session.context.productId ? undefined : session.context.productHint
    });
    session.managerCalledAt = Date.now();
  }
  // Inside the cooldown the manager already has this request — tapping again
  // just gets the same reassurance, not another page.
  session.lead.saved = true;
  session.lead.escalated = true;
  const managerPhone = config.business.managerPhone || config.business.phone;
  await safeSend(ctx, t(session.lang, 'managerCalled', managerPhone), phoneRequestExtra(session));
}

bot.command('manager', async (ctx) => {
  const session = getSession(ctx.chat.id);
  await callManager(ctx, session, 'Клиент нажал /manager — просит живого менеджера.');
});

/** Manager-only dashboard. */
bot.command('stats', async (ctx) => {
  if (!isManager(ctx)) return;
  const s = leadStats();
  const lines = [
    '<b>📊 Статистика (с последнего перезапуска)</b>',
    '',
    `Лидов всего: <b>${s.total}</b>`,
    `🔥 Горячих (now): <b>${s.hot}</b>`,
    `🟡 Тёплых (next): <b>${s.warm}</b>`,
    `⚠️ Сбоев AI (не лиды): <b>${s.outages}</b>`,
    `📱 С телефоном: <b>${s.withPhone}</b>`,
    `💬 Активных диалогов: <b>${sessionCount()}</b>`,
    '',
    '<b>Последние записи:</b>'
  ];
  const last = recentLeads(5);
  if (!last.length) lines.push('—');
  const icon = { now: '🔥', next: '🟡', outage: '⚠️' };
  for (const l of last) {
    // Names and product queries come from customers — escape, or a first
    // name like <a href="…"> renders as a link in the manager's chat.
    const who = l.username ? `@${l.username}` : l.name || l.chatId;
    lines.push(`• ${icon[l.urgency] ?? '•'} ${escapeHtml(who)} — ${escapeHtml(l.productName ?? 'без товара')}`);
  }
  lines.push('', `🗂 Каталог из канала: <b>${channelCatalogSize()}</b> товаров`);
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
});

/** Ends a handoff and lets the AI answer this customer again. Accepts either
 *  a reply to that customer's thread, or an explicit `/release <chat id>`. */
bot.command('release', async (ctx) => {
  if (!isManager(ctx)) return;

  const typed = String(ctx.match ?? '').trim();
  const chatId = typed
    ? parseCustomerId(typed)
    : extractCustomerId(ctx.message?.reply_to_message, ctx.me.id);

  if (!chatId) {
    return ctx.reply(
      'Ответьте командой /release на сообщение клиента, или укажите числовой id: /release 123456789'
    );
  }

  endHandoff(getSession(chatId));
  await ctx.reply(`✅ AI снова отвечает клиенту <code>${escapeHtml(chatId)}</code>.`, { parse_mode: 'HTML' });
});

/* ------------------------------------------------------------------- relay */

const MANAGER_HINT =
  'ℹ️ Чтобы ответить клиенту — ответьте (reply) на сообщение с лидом, ' +
  'и я передам ваш ответ ему: текст, фото, голосовое — что угодно.\n\n' +
  '/stats — статистика, /release — вернуть AI.';

/**
 * Everything the manager sends in the bot's chat. A reply to a lead alert (or
 * to a relayed customer message) is carried to that customer — as a copy, so
 * text formatting, photos, voice notes and files all arrive intact. Anything
 * else gets a short hint rather than being fed to the AI as if the manager
 * were a customer.
 */
bot.on('message', async (ctx, next) => {
  if (!isManager(ctx)) return next();

  const target = ctx.message.reply_to_message;
  const customerId = extractCustomerId(target, ctx.me.id);

  if (!customerId) {
    // In a group, staff talk to each other — only speak up when someone
    // replied to one of our own messages and it couldn't be routed.
    if (ctx.chat.type !== 'private' && target?.from?.id !== ctx.me.id) return;
    await ctx.reply(MANAGER_HINT);
    return;
  }

  const session = getSession(customerId);
  try {
    // From the customer's side this is the same voice that has been helping
    // them all along, not a visibly different channel.
    await ctx.api.copyMessage(customerId, ctx.chat.id, ctx.message.message_id);
  } catch (err) {
    console.error('[relay] delivery to customer failed:', err.message);
    await ctx.reply(
      `⚠️ Не удалось доставить сообщение клиенту <code>${escapeHtml(customerId)}</code>: ${escapeHtml(err.message)}`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const first = !inHandoff(session);
  beginHandoff(session);
  await ctx.reply(
    first
      ? '✅ Отправлено. AI больше не отвечает этому клиенту — вы ведёте диалог. ' +
          'Его ответы будут приходить сюда. /release — вернуть AI.'
      : '✅ Отправлено.'
  );
});

/**
 * Carries a customer's message across to the manager during a handoff.
 * @returns {Promise<boolean>} false when the relay itself is broken — the
 *   handoff is then dropped so the customer isn't left talking to nobody.
 */
async function relayCustomer(ctx, session, { text, note } = {}) {
  try {
    await relayToManager(bot, { user: ctx.from, session, message: ctx.message, text, note });
    return true;
  } catch (err) {
    console.error('[relay] delivery to manager failed, releasing handoff:', err.message);
    endHandoff(session);
    return false;
  }
}

/* ------------------------------------------------------------- channel catalog */

/** Indexes a product post from CHANNEL_CATALOG_ID for later search+forward.
 *  Requires the bot to be an admin of that channel. */
function ingestChannelPost(ctx) {
  const post = ctx.channelPost ?? ctx.editedChannelPost;
  if (!post || !isChannelCatalogChat(post.chat)) return;

  const caption = post.caption ?? post.text;
  const entry = indexChannelPost({
    messageId: post.message_id,
    caption,
    hasPhoto: Boolean(post.photo?.length)
  });

  if (entry) console.log(`[channel-catalog] indexed message ${post.message_id}: ${entry.caption.slice(0, 60)}…`);
  else console.warn(`[channel-catalog] message ${post.message_id} has no caption/text — skipped (nothing to search on)`);
}

bot.on('channel_post', ingestChannelPost);
bot.on('edited_channel_post', ingestChannelPost);

/* ------------------------------------------------------------------ buttons */

bot.callbackQuery(/^lang:(ru|uz)$/, async (ctx) => {
  const session = getSession(ctx.chat.id);
  session.lang = ctx.match[1];
  session.langLocked = true;
  await ctx.answerCallbackQuery();
  await safeSend(ctx, t(session.lang, 'langSet'), { reply_markup: mainKeyboard(session.lang) });
});

bot.on('message:contact', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const contact = ctx.message.contact;

  // Telegram sends the number without "+" — normalise before anyone dials it.
  const phone = normalizePhone(contact.phone_number);
  if (!phone) {
    await safeSend(ctx, t(session.lang, 'error', config.business.phone), { reply_markup: mainKeyboard(session.lang) });
    return;
  }

  // The button shares the customer's own contact, but the attachment menu can
  // share anyone's. Take the number either way (they chose to give it), but
  // never label the customer with someone else's name.
  const own = contact.user_id === ctx.from?.id;
  const contactName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const note = own ? null : `Клиент отправил не свой контакт${contactName ? `: ${contactName}` : ''}.`;

  session.profile.phone = phone;
  session.profile.phoneDeclined = false;
  if (own && !session.profile.name && contactName) session.profile.name = contactName;

  // Mid-order: the phone was one of the details a held buy-now lead was
  // waiting on. Either that completes it, or ask the one thing still missing.
  // Recorded in history too, so the AI knows what was just asked and answered.
  if (session.lead.pending) {
    session.history.push({
      role: 'user',
      content: `[Клиент поделился номером телефона через кнопку: ${phone}]`
    });
    if (note) session.lead.pending.summary = `${session.lead.pending.summary}\n${note}`;

    if (missingForHotLead(session).length) {
      const ask = t(session.lang, 'askFulfillment');
      session.history.push({ role: 'assistant', content: ask });
      await safeSend(ctx, ask, { reply_markup: mainKeyboard(session.lang) });
      return;
    }

    const result = await flushPendingLead(bot, session, 'complete');
    const reply = result?.delivered
      ? t(session.lang, 'orderSent', phone)
      : t(session.lang, 'phoneThanks', phone);
    session.history.push({ role: 'assistant', content: reply });
    await safeSend(ctx, reply, { reply_markup: mainKeyboard(session.lang) });
    return;
  }

  await safeSend(ctx, t(session.lang, 'phoneThanks', phone), {
    reply_markup: mainKeyboard(session.lang)
  });

  if (session.lead.saved) {
    // The manager already has this customer — add the number to that lead
    // instead of paging them with what looks like a second order.
    await notifyContactUpdate(bot, { user: ctx.from, session, phone, note });
    return;
  }

  await alertManager(bot, {
    urgency: 'next',
    user: ctx.from,
    session,
    summary: `Клиент оставил номер телефона через кнопку в боте.${note ? `\n${note}` : ''}`,
    productId: session.context.productId,
    productQuery: session.context.productId ? undefined : session.context.productHint,
    phone
  });
  session.lead.saved = true;
});

/* ------------------------------------------------------------------- prose */

/**
 * Fixed-answer reply-keyboard buttons. Answered even while the AI is busy or a
 * manager has the conversation — they need no AI, and a button that does
 * nothing when tapped looks broken.
 * @returns {Promise<boolean>} true when `text` was a button and was handled.
 */
async function handleQuickReply(ctx, session, text) {
  const lang = session.lang;
  try {
    if (isButton(text, 'btnContact')) {
      // Telegram flatly rejects "tel:" as an inline button URL — confirmed
      // directly against the live API ("Wrong port number specified in the
      // URL", for every phone format tried) — and rejecting one button
      // silently kills the WHOLE sendMessage call, not just that button. The
      // phone number goes in the message text instead (Telegram auto-links a
      // properly formatted number as tap-to-call), and the username link
      // — which Telegram does accept — stays as the one inline button. A
      // @username link also has no phone-resolution step, unlike t.me/+<phone>.
      // btnContact is a soft "I have a question" nudge — it does NOT alert the
      // manager. Only real purchase intent or an explicit /manager does.
      const directContact = new InlineKeyboard().url(t(lang, 'btnTelegramUs'), config.business.humanTelegramUrl);
      await safeSend(ctx, t(lang, 'contactPrompt', config.business.phone), { reply_markup: directContact });
      return true;
    }
    if (isButton(text, 'btnShowrooms')) {
      const body = catalog.branches
        .map((b) => `📍 *${b.name}*\n${b.address}\n🕙 ${b.hours}\n📞 ${b.phone}\n${b.mapUrl}`)
        .join('\n\n');
      await safeSend(ctx, body, { link_preview_options: { is_disabled: true } });
      return true;
    }
    if (isButton(text, 'btnSkipPhone')) {
      // No number is coming — stop asking for it, and don't make a held
      // buy-now lead wait out its timer for it.
      if (!session.profile.phone) session.profile.phoneDeclined = true;
      const reply = t(lang, 'phoneSkipped');
      session.history.push(
        { role: 'user', content: '[Клиент нажал «Позже» — не хочет оставлять номер телефона]' },
        { role: 'assistant', content: reply }
      );
      if (session.lead.pending) await flushPendingLead(bot, session, 'phone_declined');
      await safeSend(ctx, reply, { reply_markup: mainKeyboard(lang) });
      return true;
    }
  } catch (err) {
    // These are simple, static replies — a failure here is almost certainly a
    // Telegram API hiccup, not a real bug. Never let it look like the button
    // silently did nothing: log it and still tell the customer something broke.
    console.error('[bot] quick-reply handler failed:', err.message);
    await safeSend(ctx, t(lang, 'error', config.business.phone)).catch(() => {});
    return true;
  }
  return false;
}

/**
 * The AI could not answer. An outage must not cost us the customer, but it is
 * not a buying signal either — the manager gets an "outage" alert, never a
 * "now" one, and later failures for the same customer are relayed as plain
 * messages so the "I passed your question to a manager" we tell them is true.
 */
async function handleAiFailure(ctx, session, text, err) {
  const kind = classifyAiError(err);
  console.error(`[bot] respond failed (${kind}):`, err.message);

  // The user's turn failed rather than getting answered — but deleting it
  // outright (as this used to do) wiped it from the model's memory too, so
  // the next message started from a blank slate with no idea a question had
  // even been asked. Keep the question, and record a truthful note in its
  // place of the answer, so a follow-up like "why is it unavailable?" still
  // has something to refer back to instead of the model apologizing for
  // conversation it can no longer see happened.
  if (session.history.at(-1)?.role !== 'assistant') {
    session.history.push({
      role: 'assistant',
      content: '[Технический сбой — не удалось ответить на это сообщение клиента.]'
    });
  }

  if (!session.lead.saved) {
    let summary =
      `ИИ-консультант не смог ответить (${kind}).\n` +
      `Последнее сообщение клиента: "${text.slice(0, 300)}"`;

    // A rejected key or an empty balance is ONE operator problem, not one
    // per customer: without this, everybody who writes during the outage
    // gets their own full-width alert and the real cause — a single env var
    // — is nowhere in any of them. Say what to actually do, once per window.
    if (isFatalAiError(err) && Date.now() - lastSystemicNotice > SYSTEMIC_NOTICE_MS) {
      lastSystemicNotice = Date.now();
      summary +=
        `\n\n🔧 Это не разовый сбой — он повторится у КАЖДОГО клиента, пока не починить:\n` +
        `ключ AI_API_KEY отклонён или на счету пусто (${kind}).\n` +
        `Проверьте ${config.ai.consoleUrl} и переменную AI_API_KEY в Render.\n` +
        `Текущая модель: ${config.ai.model} (${config.ai.baseUrl}).`;
    }

    await alertManager(bot, {
      urgency: 'outage',
      user: ctx.from,
      session,
      summary,
      productId: session.context.productId
    });
    session.lead.saved = true;
  } else {
    // The manager already knows this customer; hand over the unanswered
    // question itself rather than a second alert — or nothing at all.
    await relayToManager(bot, {
      user: ctx.from,
      session,
      text,
      note: `AI не смог ответить (${kind}) — ответьте клиенту сами.`
    }).catch((e) => console.error('[bot] outage relay failed:', e.message));
  }

  await safeSend(ctx, t(session.lang, 'aiDown', config.business.phone), phoneRequestExtra(session));
}

/** One AI turn: think, then send the answer. Telegram delivery errors are
 *  thrown to the caller; AI errors are handled here. */
async function answerWithAi(ctx, session, text) {
  if (!session.langLocked) {
    const detected = detectLang(text, ctx.from?.language_code);
    if (detected) session.lang = detected;
  }

  if (!takeAiTurn(session)) {
    await safeSend(ctx, t(session.lang, 'rateLimited', config.business.phone));
    return;
  }

  const stopTyping = startTyping(ctx);
  let result;
  try {
    result = await respond({ bot, session, user: ctx.from, userText: text });
  } catch (err) {
    stopTyping();
    await handleAiFailure(ctx, session, text, err);
    return;
  }
  stopTyping();

  // Attach the one-tap contact button directly to this same message when the
  // AI just escalated a lead, or an order is still waiting on the number.
  const extra =
    result.toolsUsed.includes('notify_manager') || session.lead.pending ? phoneRequestExtra(session) : {};

  await safeSend(ctx, result.text || t(session.lang, 'error', config.business.phone), extra);
}

bot.on('message:text', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const text = ctx.message.text.trim();
  if (!text) return;

  if (await handleQuickReply(ctx, session, text)) return;

  // A manager is handling this person personally — carry their message across
  // instead of answering, so the customer isn't talking to two voices at once.
  // If the relay itself is broken, fall through and let the AI answer.
  if (inHandoff(session) && (await relayCustomer(ctx, session))) return;

  // Already answering this chat: hold the message and answer it together with
  // anything else that arrives, right after. Dropping it — as this used to —
  // meant "Hi" + "how much is the fēnix 8?" sent a second apart got an answer
  // to "Hi" and silence on the actual question.
  if (session.busy) {
    if (session.queue.length < MAX_QUEUED) session.queue.push(text);
    return;
  }

  session.busy = true;
  try {
    let next = text;
    while (next) {
      try {
        await answerWithAi(ctx, session, next);
      } catch (err) {
        // Only Telegram delivery failures reach here (blocked bot, network);
        // the AI path handles its own errors.
        console.error('[bot] could not deliver answer to customer:', err.message);
      }

      next = session.queue.splice(0).join('\n').slice(0, MAX_MERGED_CHARS);
      // A manager may have taken over while the AI was thinking.
      if (next && inHandoff(session) && (await relayCustomer(ctx, session, { text: next }))) next = '';
    }
  } finally {
    session.busy = false;
  }
});

/**
 * Photos, voice notes, stickers, locations… The AI only reads text, and silence
 * would look like the bot is broken. During a handoff they go to the manager
 * like everything else.
 */
bot.on(
  [
    'message:photo',
    'message:video',
    'message:voice',
    'message:audio',
    'message:document',
    'message:sticker',
    'message:video_note',
    'message:animation',
    'message:location'
  ],
  async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (inHandoff(session) && (await relayCustomer(ctx, session))) return;
    await safeSend(ctx, t(session.lang, 'textOnly', config.business.phone));
  }
);

bot.catch((err) => {
  console.error('[bot] unhandled error:', err.error ?? err);
});
