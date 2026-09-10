import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { config } from './config.js';
import { catalog, formatPrice, getProduct, productName } from './catalog/catalog.js';
import { detectLang, normalizeLang, t } from './i18n.js';
import { toTelegramHtml } from './format.js';
import { parseStartPayload } from './deeplink.js';
import { getSession, resetHistory, sessionCount } from './session.js';
import { classifyAiError, isFatalAiError, respond } from './ai/agent.js';
import { alertManager } from './leads/notify.js';
import { flushPendingLead, missingForHotLead } from './leads/pending.js';
import { leadStats, recentLeads } from './leads/store.js';
import { indexChannelPost, channelCatalogSize } from './channelCatalog.js';
import { sendProductPhoto } from './media.js';
import { beginHandoff, endHandoff, extractCustomerId, formatForManager, inHandoff } from './relay.js';

export const bot = new Bot(config.telegram.token);

const TELEGRAM_MAX = 4096;
const MIN_MESSAGE_GAP_MS = 800;

/** Systemic AI failures (bad key, no balance) hit every customer at once. The
 *  operator only needs telling once — see the catch block in message:text. */
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
      await ctx.reply(part.replace(/<[^>]+>/g, ''), extra);
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
 * ignore it. One message, one ask.
 */
function phoneRequestExtra(session) {
  return session.profile.phone ? {} : { reply_markup: contactKeyboard(session.lang) };
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

/* ----------------------------------------------------------------- commands */

bot.command('start', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const { source, productId, lang } = parseStartPayload(ctx.match);

  const picked = lang ?? normalizeLang(ctx.from?.language_code) ?? session.lang;
  session.lang = picked;
  if (lang) session.langLocked = true;

  session.context = { productId, source: source ?? 'direct' };
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
  } else {
    await alertManager(bot, {
      urgency: 'now',
      user: ctx.from,
      session,
      summary: reason,
      productId: session.context.productId
    });
  }
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
    const who = l.username ? `@${l.username}` : l.name || l.chatId;
    lines.push(`• ${icon[l.urgency] ?? '•'} ${who} — ${l.productName ?? 'без товара'}`);
  }
  lines.push('', `🗂 Каталог из канала: <b>${channelCatalogSize()}</b> товаров`);
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
});

/** Ends a handoff and lets the AI answer this customer again. Accepts either
 *  a reply to that customer's thread, or an explicit `/release <chat id>`. */
bot.command('release', async (ctx) => {
  if (!isManager(ctx)) return;

  const chatId =
    String(ctx.match ?? '').trim() ||
    extractCustomerId(ctx.message?.reply_to_message?.text ?? '');

  if (!chatId) {
    return ctx.reply(
      'Ответьте командой /release на сообщение клиента, или укажите id: /release 123456789'
    );
  }

  endHandoff(getSession(chatId));
  await ctx.reply(`✅ AI снова отвечает клиенту <code>${chatId}</code>.`, { parse_mode: 'HTML' });
});

/* ------------------------------------------------------------------- relay */

/**
 * Everything the manager types in the bot's chat. A reply to a lead alert (or
 * to a relayed customer message) is carried to that customer; anything else
 * gets a short hint rather than being fed to the AI as if the manager were a
 * customer, which is what used to happen — confusing, and it burned credits.
 */
bot.on('message:text', async (ctx, next) => {
  if (!isManager(ctx)) return next();

  const replied = ctx.message.reply_to_message?.text;
  const customerId = replied ? extractCustomerId(replied) : null;

  if (!customerId) {
    await ctx.reply(
      'ℹ️ Чтобы ответить клиенту — ответьте (reply) на сообщение с лидом, ' +
        'и я передам ваш текст ему.\n\n/stats — статистика, /release — вернуть AI.'
    );
    return;
  }

  const session = getSession(customerId);
  try {
    // Sent as ordinary text: from the customer's side this is the same voice
    // that has been helping them all along, not a visibly different channel.
    await bot.api.sendMessage(customerId, ctx.message.text);
  } catch (err) {
    console.error('[relay] delivery to customer failed:', err.message);
    await ctx.reply(
      `⚠️ Не удалось доставить сообщение клиенту <code>${customerId}</code>: ${err.message}`,
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
  session.profile.phone = contact.phone_number;
  if (!session.profile.name) {
    session.profile.name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  }

  // Mid-order: the phone was one of the details a held buy-now lead was
  // waiting on. Either that completes it, or ask the one thing still missing.
  // Recorded in history too, so the AI knows what was just asked and answered.
  if (session.lead.pending) {
    session.history.push({
      role: 'user',
      content: `[Клиент поделился номером телефона через кнопку: ${contact.phone_number}]`
    });

    if (missingForHotLead(session).length) {
      const ask = t(session.lang, 'askFulfillment');
      session.history.push({ role: 'assistant', content: ask });
      await safeSend(ctx, ask, { reply_markup: mainKeyboard(session.lang) });
      return;
    }

    const result = await flushPendingLead(bot, session, 'complete');
    const reply = result?.delivered
      ? t(session.lang, 'orderSent', contact.phone_number)
      : t(session.lang, 'phoneThanks', contact.phone_number);
    session.history.push({ role: 'assistant', content: reply });
    await safeSend(ctx, reply, { reply_markup: mainKeyboard(session.lang) });
    return;
  }

  await safeSend(ctx, t(session.lang, 'phoneThanks', contact.phone_number), {
    reply_markup: mainKeyboard(session.lang)
  });

  await alertManager(bot, {
    urgency: session.lead.escalated ? 'now' : 'next',
    user: ctx.from,
    session,
    summary: 'Клиент оставил номер телефона через кнопку в боте.',
    productId: session.context.productId,
    phone: contact.phone_number
  });
  session.lead.saved = true;
});

/* ------------------------------------------------------------------- prose */

bot.on('message:text', async (ctx) => {
  const session = getSession(ctx.chat.id);
  const text = ctx.message.text.trim();
  if (!text) return;

  const now = Date.now();
  if (now - session.lastMessageAt < MIN_MESSAGE_GAP_MS || session.busy) {
    return; // drop the burst silently rather than queueing duplicate answers
  }
  session.lastMessageAt = now;

  // A manager is handling this person personally — carry their message across
  // instead of answering, so the customer isn't talking to two voices at once.
  if (inHandoff(session)) {
    try {
      const sent = await bot.api.sendMessage(
        config.telegram.managerChatId,
        formatForManager({ user: ctx.from, session, text }),
        { parse_mode: 'HTML' }
      );
      if (!sent) throw new Error('no message returned');
    } catch (err) {
      // Don't strand the customer in silence if the relay itself breaks:
      // drop the handoff so the AI picks the conversation back up.
      console.error('[relay] delivery to manager failed, releasing handoff:', err.message);
      endHandoff(session);
    }
    return;
  }

  // Reply-keyboard buttons are ordinary text; map them to intents first.
  // btnContact is a soft "I have a question" nudge — it does NOT alert the
  // manager. Only real purchase intent (via the AI's notify_manager tool) or
  // an explicit /manager should page a human.
  const lang = session.lang;
  try {
    if (text === t(lang, 'btnContact')) {
      // Telegram flatly rejects "tel:" as an inline button URL — confirmed
      // directly against the live API ("Wrong port number specified in the
      // URL", for every phone format tried) — and rejecting one button
      // silently kills the WHOLE sendMessage call, not just that button. The
      // phone number goes in the message text instead (Telegram auto-links a
      // properly formatted number as tap-to-call), and the username link
      // — which Telegram does accept — stays as the one inline button. A
      // @username link also has no phone-resolution step, unlike t.me/+<phone>.
      const directContact = new InlineKeyboard().url(t(lang, 'btnTelegramUs'), config.business.humanTelegramUrl);
      return await safeSend(ctx, t(lang, 'contactPrompt', config.business.phone), { reply_markup: directContact });
    }
    if (text === t(lang, 'btnShowrooms')) {
      const body = catalog.branches
        .map((b) => `📍 *${b.name}*\n${b.address}\n🕙 ${b.hours}\n📞 ${b.phone}\n${b.mapUrl}`)
        .join('\n\n');
      return await safeSend(ctx, body, { link_preview_options: { is_disabled: true } });
    }
    if (text === t(lang, 'btnSkipPhone')) {
      // No number is coming — don't make a held buy-now lead wait out its timer.
      if (session.lead.pending) await flushPendingLead(bot, session, 'phone_declined');
      return await safeSend(ctx, t(lang, 'phoneSkipped'), { reply_markup: mainKeyboard(lang) });
    }
  } catch (err) {
    // These are simple, static replies — a failure here is almost certainly a
    // Telegram API hiccup, not a real bug. Never let it look like the button
    // silently did nothing: log it and still tell the customer something broke.
    console.error('[bot] quick-reply handler failed:', err.message);
    await safeSend(ctx, t(lang, 'error', config.business.phone)).catch(() => {});
    return;
  }

  if (!session.langLocked) {
    const detected = detectLang(text, ctx.from?.language_code);
    if (detected) session.lang = detected;
  }

  session.busy = true;
  let typing;
  try {
    // Telegram clears the indicator after ~5s, so refresh it while we think.
    await ctx.replyWithChatAction('typing');
    typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 4500);

    const { text: reply, toolsUsed } = await respond({
      bot,
      session,
      user: ctx.from,
      userText: text
    });

    clearInterval(typing);

    // Attach the one-tap contact button directly to this same message when the
    // AI just escalated a lead, or an order is still waiting on the number.
    const extra =
      toolsUsed.includes('notify_manager') || session.lead.pending ? phoneRequestExtra(session) : {};

    if (reply) await safeSend(ctx, reply, extra);
    else await safeSend(ctx, t(session.lang, 'error', config.business.phone), extra);
  } catch (err) {
    clearInterval(typing);
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

    // An AI outage must not cost us the customer, but it is not a buying
    // signal either — alert the manager with urgency "outage", never "now",
    // so this never gets mistaken for a hot sales lead.
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
      }).catch((e) => console.error('[bot] fallback alert failed:', e.message));
      session.lead.saved = true;
    }

    await safeSend(ctx, t(session.lang, 'aiDown', config.business.phone), phoneRequestExtra(session));
  } finally {
    session.busy = false;
  }
});

bot.catch((err) => {
  console.error('[bot] unhandled error:', err.error ?? err);
});
