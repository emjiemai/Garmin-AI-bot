import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { config } from './config.js';
import { catalog, formatPrice, getProduct, productName } from './catalog/catalog.js';
import { detectLang, normalizeLang, t } from './i18n.js';
import { toTelegramHtml } from './format.js';
import { parseStartPayload } from './deeplink.js';
import { getSession, resetHistory, sessionCount } from './session.js';
import { classifyAiError, respond } from './ai/agent.js';
import { alertManager } from './leads/notify.js';
import { leadStats, recentLeads } from './leads/store.js';

export const bot = new Bot(config.telegram.token);

const TELEGRAM_MAX = 4096;
const MIN_MESSAGE_GAP_MS = 800;

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
    .text(t(lang, 'btnCatalog'))
    .text(t(lang, 'btnShowrooms'))
    .row()
    .requestContact(t(lang, 'btnSharePhone'))
    .text(t(lang, 'btnManager'))
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

/** Prompts for a phone number only when we don't already have one. */
async function maybeAskForPhone(ctx, session) {
  if (session.profile.phone) return;
  await ctx.reply(t(session.lang, 'askPhone'), { reply_markup: contactKeyboard(session.lang) });
}

function isManager(ctx) {
  return String(ctx.chat?.id) === String(config.telegram.managerChatId);
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
  await alertManager(bot, {
    urgency: 'now',
    user: ctx.from,
    session,
    summary: reason,
    productId: session.context.productId
  });
  session.lead.saved = true;
  session.lead.escalated = true;
  await safeSend(ctx, t(session.lang, 'managerCalled'));
  await maybeAskForPhone(ctx, session);
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
    `📱 С телефоном: <b>${s.withPhone}</b>`,
    `💬 Активных диалогов: <b>${sessionCount()}</b>`,
    '',
    '<b>Последние лиды:</b>'
  ];
  const last = recentLeads(5);
  if (!last.length) lines.push('—');
  for (const l of last) {
    const who = l.username ? `@${l.username}` : l.name || l.chatId;
    lines.push(`• ${l.urgency === 'now' ? '🔥' : '🟡'} ${who} — ${l.productName ?? 'без товара'}`);
  }
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
});

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

  // Reply-keyboard buttons are ordinary text; map them to intents first.
  const lang = session.lang;
  if (text === t(lang, 'btnManager')) {
    return callManager(ctx, session, 'Клиент нажал кнопку «Менеджер» в боте.');
  }
  if (text === t(lang, 'btnCatalog')) {
    return safeSend(
      ctx,
      lang === 'uz'
        ? `🛍 To'liq katalog: ${catalog.store.catalogUrl}\n\nYoki menga qanday soat kerakligini yozing — men tanlab beraman.`
        : `🛍 Полный каталог: ${catalog.store.catalogUrl}\n\nИли напишите, какие часы нужны — подберу под вашу задачу.`
    );
  }
  if (text === t(lang, 'btnShowrooms')) {
    const body = catalog.branches
      .map((b) => `📍 *${b.name}*\n${b.address}\n🕙 ${b.hours}\n📞 ${b.phone}\n${b.mapUrl}`)
      .join('\n\n');
    return safeSend(ctx, body, { link_preview_options: { is_disabled: true } });
  }
  if (text === t(lang, 'btnSkipPhone')) {
    return safeSend(ctx, t(lang, 'phoneSkipped'), { reply_markup: mainKeyboard(lang) });
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

    if (reply) await safeSend(ctx, reply);
    else await safeSend(ctx, t(session.lang, 'error'));

    // The AI just escalated a lead — get a phone number the fast way (one tap)
    // instead of hoping the customer types it.
    if (toolsUsed.includes('notify_manager')) await maybeAskForPhone(ctx, session);
  } catch (err) {
    clearInterval(typing);
    const kind = classifyAiError(err);
    console.error(`[bot] respond failed (${kind}):`, err.message);

    // Roll back the unanswered user turn so it does not poison the next call.
    if (session.history.at(-1)?.role !== 'assistant') {
      const lastUser = session.history.findLastIndex((m) => m.role === 'user');
      if (lastUser >= 0) session.history = session.history.slice(0, lastUser);
    }

    // An AI outage must not cost us the customer. Hand the conversation to a
    // human rather than showing an error and letting them walk away.
    if (!session.lead.saved) {
      await alertManager(bot, {
        urgency: 'now',
        user: ctx.from,
        session,
        summary:
          `ИИ-консультант недоступен (${kind}) — клиент остался без ответа.\n` +
          `Последнее сообщение клиента: "${text.slice(0, 300)}"`,
        productId: session.context.productId
      }).catch((e) => console.error('[bot] fallback alert failed:', e.message));
      session.lead.saved = true;
      session.lead.escalated = true;
    }

    await safeSend(ctx, t(session.lang, 'aiDown'));
    await maybeAskForPhone(ctx, session);
  } finally {
    session.busy = false;
  }
});

bot.catch((err) => {
  console.error('[bot] unhandled error:', err.error ?? err);
});
