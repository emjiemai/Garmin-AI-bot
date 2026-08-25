/** Manager alerting.
 *
 *  Two tiers, because the business rule is "rich people can't wait":
 *   - urgency "now"  -> 🔥 HOT LEAD, the manager is expected to act immediately
 *   - urgency "next" -> 🟡 warm lead, follow up during working hours
 *
 *  Both go to MANAGER_CHAT_ID. The alert always carries a direct link to the
 *  customer's chat so the manager can jump straight in. */

import { config } from '../config.js';
import { formatPrice, getProduct } from '../catalog/catalog.js';
import { saveLead } from './store.js';

/** Telegram MarkdownV2 is unforgiving; we use plain HTML parse mode instead. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function customerLink(user) {
  if (user?.username) return `https://t.me/${user.username}`;
  // Fallback: tg://user works from mobile/desktop clients when there is no @username.
  return `tg://user?id=${user?.id}`;
}

function buildAlert({ urgency, user, session, product, summary, phone, name, budget }) {
  const hot = urgency === 'now';
  const head = hot
    ? '🔥 <b>ГОРЯЧИЙ ЛИД — КЛИЕНТ ГОТОВ КУПИТЬ СЕЙЧАС</b>'
    : '🟡 <b>Новый лид — интерес к покупке</b>';

  const lines = [head, ''];

  const display = [user?.first_name, user?.last_name].filter(Boolean).join(' ');
  lines.push(`👤 <b>Клиент:</b> ${esc(name || display || 'не указано')}`);
  if (user?.username) lines.push(`   @${esc(user.username)}`);
  lines.push(`   ID: <code>${esc(user?.id ?? session.chatId)}</code>`);

  const contactPhone = phone || session.profile.phone;
  if (contactPhone) lines.push(`📱 <b>Телефон:</b> <code>${esc(contactPhone)}</code>`);
  else lines.push('📱 <b>Телефон:</b> не оставлен — писать в Telegram');

  if (product) {
    lines.push('');
    lines.push(`⌚️ <b>Товар:</b> ${esc(product.name)}`);
    lines.push(`💰 <b>Цена:</b> ${esc(formatPrice(product.price))}`);
  }

  if (budget) lines.push(`💵 <b>Бюджет клиента:</b> ${esc(budget)}`);

  lines.push('');
  lines.push(`🗒 <b>Суть запроса:</b>\n${esc(summary)}`);

  lines.push('');
  lines.push(`🌐 Язык: ${session.lang.toUpperCase()}  •  Источник: ${esc(session.context.source || 'telegram')}`);
  lines.push(`💬 <a href="${customerLink(user)}">Открыть чат с клиентом</a>`);

  if (hot) {
    lines.push('');
    lines.push('⏱ <b>Ответьте в течение 5 минут.</b>');
  }

  return lines.join('\n');
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
    name: payload.name || payload.user?.first_name || null,
    username: payload.user?.username || null,
    phone: payload.phone || payload.session.profile.phone || null,
    productId: payload.productId || null,
    productName: product?.name || null,
    price: product?.price ?? null,
    budget: payload.budget || null,
    summary: payload.summary,
    lang: payload.session.lang,
    source: payload.session.context.source || 'telegram'
  });

  try {
    await bot.api.sendMessage(config.telegram.managerChatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      disable_notification: payload.urgency !== 'now'
    });
  } catch (err) {
    // Never let a failed alert break the customer conversation.
    console.error('[notify] manager alert failed:', err.message);
    return { ...record, delivered: false };
  }

  return { ...record, delivered: true };
}
