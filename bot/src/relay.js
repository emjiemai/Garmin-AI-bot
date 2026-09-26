/** Manager ↔ customer relay.
 *
 *  Every lead alert carries a "Открыть чат с клиентом" link, but that link is
 *  only real when the customer has an @username. Plenty of them don't: for
 *  those, Telegram renders a text_mention that opens a profile card at best,
 *  carries no URL when copied, and gives the manager no way to actually start
 *  a conversation. A real lead was lost that way — a customer asking about a
 *  vívomove Luxe strap that nobody could reply to.
 *
 *  The bot, however, already has an open chat with every customer. So instead
 *  of trying to hand the manager a link, the manager replies to the alert and
 *  the bot carries the message across. That works for every customer, with no
 *  username, no phone number and no privacy settings involved.
 *
 *  The customer's Telegram id is printed in every alert ("ID: 1234567890"), so
 *  the routing survives a restart: even with all state lost, the id can still
 *  be read back out of the message the manager replied to. That matters on
 *  Render's free tier, where redeploys wipe memory regularly. */

import { config } from './config.js';
import { escapeHtml } from './format.js';

/** Telegram user ids are 5+ digits. */
const CUSTOMER_ID_RE = /^\d{5,}$/;

/** How long the AI stays quiet after a manager takes a conversation over.
 *  Long enough to finish the exchange, short enough that a forgotten handoff
 *  doesn't mute the bot for that customer forever. */
const HANDOFF_MS = 8 * 60 * 60 * 1000;

/**
 * Reads the customer's chat id back out of an alert (or a relayed customer
 * message) that the manager replied to.
 *
 * The id is printed as `ID: <code>123</code>`. Matching the plain text
 * "ID: 123" is not enough: a customer's name, their message, or an AI summary
 * all appear in the same alert, so a customer calling themselves "ID: 5555555"
 * would have had the manager's replies delivered to a chat of their choosing.
 * Every customer-supplied value is HTML-escaped before it is sent, so it can
 * never produce a `code` entity — only our own template can. And the message
 * must be one the bot itself sent, so a look-alike posted by someone else in a
 * manager group routes nowhere.
 *
 * @param {object|undefined} message The message the manager replied to.
 * @param {number} [botId] Our own user id; when given, only our messages count.
 * @returns {string|null}
 */
export function extractCustomerId(message, botId) {
  if (!message) return null;
  if (botId && message.from?.id !== botId) return null;

  const text = message.text ?? message.caption ?? '';
  const entities = message.entities ?? message.caption_entities ?? [];

  for (const e of entities) {
    if (e.type !== 'code') continue;
    const label = text.slice(Math.max(0, e.offset - 8), e.offset);
    if (!/ID:\s*$/.test(label)) continue;
    const value = text.slice(e.offset, e.offset + e.length);
    if (CUSTOMER_ID_RE.test(value)) return value;
  }
  return null;
}

/** Validates a chat id typed by the manager (e.g. `/release 123456789`). */
export function parseCustomerId(value) {
  const id = String(value ?? '').trim();
  return CUSTOMER_ID_RE.test(id) ? id : null;
}

/** Hands the conversation to a human: the AI stops answering this customer. */
export function beginHandoff(session) {
  session.handoffUntil = Date.now() + HANDOFF_MS;
}

/** Gives the conversation back to the AI. */
export function endHandoff(session) {
  session.handoffUntil = 0;
}

/** True while a manager is handling this customer personally. */
export function inHandoff(session) {
  return (session.handoffUntil ?? 0) > Date.now();
}

/**
 * Renders a customer's message for the manager's chat. Keeps the same
 * "ID: <id>" marker the alerts use, so the manager can reply to this message
 * too and the relay still knows where to send it.
 *
 * @param {{user:object, session:object, text:string, note?:string}} args
 *   `note` is an optional italic line above the text (e.g. why this message is
 *   being relayed rather than answered by the AI).
 */
export function formatForManager({ user, session, text, note }) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Клиент';
  const handle = user?.username ? ` @${user.username}` : '';
  return (
    `💬 <b>${escapeHtml(name)}</b>${escapeHtml(handle)}  •  ID: <code>${escapeHtml(session.chatId)}</code>\n` +
    (note ? `<i>${escapeHtml(note)}</i>\n` : '') +
    `\n${escapeHtml(text)}\n\n` +
    `<i>Ответьте на это сообщение — клиент получит ваш ответ.</i>`
  );
}

/** What kind of non-text message this is, in words the manager reads. */
export function describeMedia(message) {
  if (message.photo) return 'фото';
  if (message.voice) return 'голосовое сообщение';
  if (message.video_note) return 'видеосообщение';
  if (message.video) return 'видео';
  if (message.audio) return 'аудио';
  if (message.document) return 'файл';
  if (message.sticker) return `стикер ${message.sticker.emoji ?? ''}`.trim();
  if (message.animation) return 'GIF';
  if (message.location || message.venue) return 'геолокация';
  if (message.contact) return 'контакт';
  return 'сообщение';
}

/**
 * Carries a customer's message to the manager chat. Text is re-rendered with
 * the ID marker; anything else (photo, voice, location…) goes as a header with
 * the ID, followed by a copy of the original threaded under it, so the manager
 * replies to the header and the routing still works.
 *
 * @param {import('grammy').Bot} bot
 * @returns {Promise<void>} Throws if the manager chat could not be reached.
 */
export async function relayToManager(bot, { user, session, message, text, note }) {
  const managerChatId = config.telegram.managerChatId;
  const isText = text !== undefined || typeof message?.text === 'string';
  const body = isText
    ? (text ?? message.text)
    : `[${describeMedia(message)}]${message.caption ? `\n${message.caption}` : ''}`;

  const header = await bot.api.sendMessage(
    managerChatId,
    formatForManager({ user, session, text: body, note }),
    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
  );

  if (!isText && message) {
    await bot.api.copyMessage(managerChatId, message.chat.id, message.message_id, {
      reply_parameters: { message_id: header.message_id, allow_sending_without_reply: true }
    });
  }
}
