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

/** Telegram ids are 5+ digits; the alert prints exactly one per message. */
const CUSTOMER_ID_RE = /\bID:\s*(\d{5,})/;

/** How long the AI stays quiet after a manager takes a conversation over.
 *  Long enough to finish the exchange, short enough that a forgotten handoff
 *  doesn't mute the bot for that customer forever. */
const HANDOFF_MS = 8 * 60 * 60 * 1000;

/**
 * Reads the customer's chat id back out of an alert (or a relayed customer
 * message) that the manager replied to.
 * @returns {string|null}
 */
export function extractCustomerId(text) {
  const match = CUSTOMER_ID_RE.exec(String(text ?? ''));
  return match ? match[1] : null;
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
 */
export function formatForManager({ user, session, text }) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Клиент';
  const handle = user?.username ? ` @${user.username}` : '';
  return (
    `💬 <b>${escapeHtml(name)}</b>${escapeHtml(handle)}  •  ID: <code>${escapeHtml(session.chatId)}</code>\n\n` +
    `${escapeHtml(text)}\n\n` +
    `<i>Ответьте на это сообщение — клиент получит ваш ответ.</i>`
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
