/** Manager alerting.
 *
 *  Three kinds, because the business rule is "rich people can't wait" — but a
 *  robot glitching is not the same event as a customer being ready to buy,
 *  and must never look like one:
 *   - urgency "now"    -> 🔥 HOT LEAD, the manager is expected to act immediately
 *   - urgency "next"   -> 🟡 warm lead, follow up during working hours
 *   - urgency "outage" -> ⚠️ the AI failed to answer at all — an ops problem,
 *     not a sales signal. Styled deliberately differently from a hot lead so
 *     it can never be mistaken for "this customer is dying to buy right now"
 *     when the real story is "our bot broke and someone's waiting."
 *
 *  All three go to MANAGER_CHAT_ID. The alert always carries a direct link to
 *  the customer's chat so the manager can jump straight in. */

import { config } from '../config.js';
import { formatPrice, getProduct } from '../catalog/catalog.js';
import { escapeHtml as esc, htmlToPlainWithCode } from '../format.js';
import { attachPhoneToLead, saveLead } from './store.js';

/** Why a buy-now lead went out before the bot collected everything. */
const INCOMPLETE_NOTES = {
  timeout: '⚠️ <i>Клиент не завершил оформление — не ответил на уточняющие вопросы. Отправляем что есть.</i>',
  phone_declined: '⚠️ <i>Клиент не захотел оставлять номер — ответьте на это сообщение, бот передаст ответ клиенту.</i>'
};

const REPLY_HINT = '↩️ <i>Ответьте на это сообщение — ответ уйдёт клиенту в бот.</i>';

/**
 * How the manager can reach this customer. A t.me link only exists for an
 * @username; without one, a tg://user?id link opens nothing at all when the
 * customer's privacy settings hide their account — and a customer with no
 * username and a hidden number is exactly who can't be found any other way.
 * For them the alert says plainly that replying here is the only route, rather
 * than offering a link that silently does nothing.
 */
function contactLines(user, phone, { withProfileLink = true } = {}) {
  if (user?.username) {
    return [`💬 <a href="https://t.me/${esc(user.username)}">Открыть чат с клиентом</a>`, REPLY_HINT];
  }
  const lines = [];
  if (!phone) {
    lines.push('⚠️ <b>У клиента нет @username и не оставлен телефон — связаться можно только ответом на это сообщение.</b>');
  }
  lines.push(REPLY_HINT);
  if (withProfileLink && user?.id) {
    lines.push(`👤 <a href="tg://user?id=${esc(user.id)}">Профиль клиента</a> <i>(может не открыться из-за настроек приватности)</i>`);
  }
  return lines;
}

/** Name, handle and the ID marker relay.js routes replies by. */
function customerLines(user, session, name) {
  const display = [user?.first_name, user?.last_name].filter(Boolean).join(' ');
  const lines = [`👤 <b>Клиент:</b> ${esc(name || session.profile.name || display || 'не указано')}`];
  if (user?.username) lines.push(`   @${esc(user.username)}`);
  lines.push(`   ID: <code>${esc(user?.id ?? session.chatId)}</code>`);
  return lines;
}

function phoneLine(phone, session) {
  if (phone) return `📱 <b>Телефон:</b> <code>${esc(phone)}</code>`;
  if (session.profile.phoneDeclined) return '📱 <b>Телефон:</b> клиент не захотел оставлять номер';
  return '📱 <b>Телефон:</b> не оставлен';
}

function fulfillmentLine(order) {
  if (order?.fulfillment === 'pickup') {
    return `🏬 <b>Получение:</b> самовывоз${order.showroom ? ` — ${esc(order.showroom)}` : ''}`;
  }
  if (order?.fulfillment === 'delivery') {
    return `🚚 <b>Получение:</b> доставка${order.address ? ` — ${esc(order.address)}` : ''}`;
  }
  return '🚚 <b>Получение:</b> не уточнено';
}

function buildAlert({
  urgency,
  user,
  session,
  product,
  summary,
  phone,
  name,
  budget,
  productQuery,
  incompleteReason
}, { withProfileLink = true } = {}) {
  const hot = urgency === 'now';
  const outage = urgency === 'outage';
  const head = outage
    ? '⚠️ <b>Клиент остался без ответа — сбой AI-консультанта</b>'
    : hot
      ? '🔥 <b>ГОРЯЧИЙ ЛИД — КЛИЕНТ ГОТОВ КУПИТЬ СЕЙЧАС</b>'
      : '🟡 <b>Новый лид — интерес к покупке</b>';

  const lines = [head, ''];

  lines.push(...customerLines(user, session, name));

  const contactPhone = phone || session.profile.phone;
  lines.push(phoneLine(contactPhone, session));

  if (product) {
    lines.push('');
    lines.push(`⌚️ <b>Товар:</b> ${esc(product.name)}`);
    lines.push(`💰 <b>Цена:</b> ${esc(formatPrice(product.price))}`);
  } else if (productQuery) {
    // Our catalog is not the whole Garmin line-up — a customer asking about a
    // model we haven't listed is a real lead, not a dead end. Name it, so the
    // manager isn't handed "customer asked about something" with no subject.
    lines.push('');
    lines.push(`⌚️ <b>Спрашивает про:</b> ${esc(productQuery)}`);
    lines.push('❔ <i>Нет в нашем каталоге — нужно подтвердить наличие и цену.</i>');
  }

  if (budget) lines.push(`💵 <b>Бюджет клиента:</b> ${esc(budget)}`);

  if (hot) lines.push(fulfillmentLine(session.order));

  lines.push('');
  lines.push(`🗒 <b>Суть запроса:</b>\n${esc(summary)}`);

  if (incompleteReason) {
    lines.push('');
    lines.push(INCOMPLETE_NOTES[incompleteReason] ?? INCOMPLETE_NOTES.timeout);
  }

  lines.push('');
  lines.push(`🌐 Язык: ${esc(session.lang.toUpperCase())}  •  Источник: ${esc(session.context.source || 'telegram')}`);
  // Replying works even for customers with no @username — see relay.js.
  lines.push(...contactLines(user, contactPhone, { withProfileLink }));

  if (outage) {
    lines.push('');
    lines.push('🙋 Клиент ждёт ответа вручную — бот не смог ответить сам.');
  } else if (hot) {
    lines.push('');
    lines.push('⏱ <b>Ответьте в течение 5 минут.</b>');
  }

  return lines.join('\n');
}

/**
 * Delivers an HTML message to the manager chat, degrading instead of failing:
 * a lead must never be lost to a formatting problem. First without the
 * tg://user profile link (the one part that depends on the customer's privacy
 * settings), then as plain text as a last resort — still carrying the ID as a
 * code entity, so the manager can reply to it (see relay.js).
 * @returns {Promise<boolean>} whether anything was delivered.
 */
async function sendToManager(bot, html, htmlWithoutProfileLink, options) {
  const plain = htmlToPlainWithCode(htmlWithoutProfileLink || html);
  const attempts = [
    { text: html, extra: { parse_mode: 'HTML' } },
    htmlWithoutProfileLink && htmlWithoutProfileLink !== html
      ? { text: htmlWithoutProfileLink, extra: { parse_mode: 'HTML' } }
      : null,
    { text: plain.text, extra: { entities: plain.entities } }
  ].filter(Boolean);

  for (const [i, attempt] of attempts.entries()) {
    try {
      await bot.api.sendMessage(config.telegram.managerChatId, attempt.text, { ...options, ...attempt.extra });
      return true;
    } catch (err) {
      console.error(`[notify] manager alert attempt ${i + 1}/${attempts.length} failed:`, err.message);
    }
  }
  return false;
}

/**
 * Sends the alert and records the lead.
 * @param {import('grammy').Bot} bot
 */
export async function alertManager(bot, payload) {
  const product = payload.productId ? getProduct(payload.productId) : null;
  const text = buildAlert({ ...payload, product });

  const record = saveLead({
    chatId: payload.session.chatId,
    urgency: payload.urgency,
    name: payload.name || payload.session.profile.name || payload.user?.first_name || null,
    username: payload.user?.username || null,
    phone: payload.phone || payload.session.profile.phone || null,
    productId: payload.productId || null,
    // Falls back to what the customer actually asked for, so a lead about a
    // model we don't stock still says which model in /stats and the log.
    productName: product?.name || payload.productQuery || null,
    price: product?.price ?? null,
    budget: payload.budget || null,
    summary: payload.summary,
    lang: payload.session.lang,
    source: payload.session.context.source || 'telegram'
  });

  // Never throws: a failed alert must not break the customer conversation.
  const delivered = await sendToManager(bot, text, buildAlert({ ...payload, product }, { withProfileLink: false }), {
    link_preview_options: { is_disabled: true },
    // "next" (warm, follow up whenever) is the only kind quiet enough to
    // silence — a customer stuck on a broken bot is just as time-sensitive
    // as a hot lead, even though it must not be styled like one.
    disable_notification: payload.urgency === 'next'
  });

  return { ...record, delivered };
}

/**
 * Tells the manager a customer they already have a lead for just shared a
 * phone number. Sending this as a second 🔥 lead (as it used to be) read as a
 * second order and double-counted it in /stats; it's the same customer with
 * one more detail.
 * @param {import('grammy').Bot} bot
 */
export async function notifyContactUpdate(bot, { user, session, phone, note }) {
  attachPhoneToLead(session.chatId, phone);

  const lines = [
    '📱 <b>Клиент оставил номер телефона</b>',
    '',
    ...customerLines(user, session),
    phoneLine(phone, session)
  ];
  if (note) lines.push('', `<i>${esc(note)}</i>`);
  lines.push('', REPLY_HINT);

  const html = lines.join('\n');
  const delivered = await sendToManager(bot, html, null, { link_preview_options: { is_disabled: true } });
  return { delivered };
}
