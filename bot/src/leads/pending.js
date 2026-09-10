/** Buy-now leads, held until the manager can actually act on them.
 *
 *  A real lead arrived as "🔥 ready to buy now, reply in 5 minutes" the moment
 *  a customer typed "i will buy this" — no phone, no pickup-or-delivery choice,
 *  and a nameless account. The bot then asked the delivery question itself,
 *  after the manager had already been paged with nothing to act on.
 *
 *  A buy-now lead is useful once two things are known: a number to call, and
 *  whether the customer is coming to a showroom or needs delivery. So the lead
 *  is held on the session while the bot asks for exactly those, and goes out as
 *  one complete alert once they're in.
 *
 *  Holding must never cost a buyer, so there are two other ways out:
 *   - a timer: after LEAD_HOLD_MINUTES the lead goes out with what is known;
 *   - the customer declining to share a phone ("Позже"): it goes out at once.
 *  A customer explicitly asking for a human skips holding entirely (see
 *  notify_manager's `immediate` flag in ai/tools.js).
 *
 *  The timer lives in memory, so a redeploy inside the hold window drops it —
 *  the same ephemeral-state tradeoff sessions already make on Render's free
 *  tier. */

import { config } from '../config.js';
import { alertManager } from './notify.js';

/** chatId -> pending timeout handle. */
const timers = new Map();

const MISSING_LABELS = {
  phone: 'номер телефона (под сообщением будет кнопка «Оставить номер»)',
  fulfillment: 'самовывоз из шоурума или доставка'
};

/** What a buy-now lead still lacks before the manager can act on it. */
export function missingForHotLead(session) {
  const missing = [];
  if (!session.profile.phone) missing.push('phone');
  if (!session.order?.fulfillment) missing.push('fulfillment');
  return missing;
}

/** Human-readable list for the model's tool result. */
export function describeMissing(missing) {
  return missing.map((key) => MISSING_LABELS[key] ?? key).join(' и ');
}

function definedOnly(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

/**
 * Parks a buy-now lead on the session. Calling again while one is parked
 * updates it (a newer summary, a product id learned since) without restarting
 * the clock — the customer has already been waiting since the first call.
 */
export function holdHotLead(bot, session, payload) {
  if (session.lead.pending) {
    session.lead.pending = { ...session.lead.pending, ...definedOnly(payload) };
    return;
  }

  // A token, so a timer left over from an earlier hold can't fire on a newer one.
  const token = `${Date.now()}-${Math.random()}`;
  session.lead.pending = { ...payload, token };

  clearTimeout(timers.get(session.chatId));
  const timer = setTimeout(() => {
    timers.delete(session.chatId);
    if (session.lead.pending?.token !== token) return; // already sent or replaced
    flushPendingLead(bot, session, 'timeout').catch((err) =>
      console.error('[leads] held lead failed to send on timeout:', err.message)
    );
  }, config.leadHoldMinutes * 60 * 1000);
  timer.unref?.();
  timers.set(session.chatId, timer);
}

/** Reasons a lead goes out with details still missing that the manager should
 *  be told about. "complete" and "immediate" (customer asked for a human right
 *  away) need no warning — the alert's phone line already shows what's known. */
const INCOMPLETE_REASONS = new Set(['timeout', 'phone_declined']);

/**
 * Sends the parked lead now. `reason` is "complete" when everything was
 * collected, "immediate" when the customer asked for a person, otherwise why
 * it is going out without the details ("timeout", "phone_declined") — the
 * alert says so, so the manager knows what's missing.
 */
export async function flushPendingLead(bot, session, reason) {
  const pending = session.lead.pending;
  if (!pending) return null;

  // Clear before awaiting, so a concurrent completion can't send it twice.
  dropPendingLead(session);

  const { token, ...payload } = pending;
  const result = await alertManager(bot, {
    ...payload,
    urgency: 'now',
    session,
    incompleteReason: INCOMPLETE_REASONS.has(reason) ? reason : null
  });

  session.lead.saved = true;
  session.lead.escalated = true;
  return result;
}

/** Sends the parked lead if nothing is missing any more; otherwise no-op. */
export async function completeIfReady(bot, session) {
  if (!session.lead.pending || missingForHotLead(session).length) return null;
  return flushPendingLead(bot, session, 'complete');
}

/** Forgets a parked lead without sending it. */
export function dropPendingLead(session) {
  session.lead.pending = null;
  clearTimeout(timers.get(session.chatId));
  timers.delete(session.chatId);
}
