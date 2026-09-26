/** Per-chat conversation state.
 *
 *  In-memory on purpose: Render's free instance has no persistent disk and
 *  restarts wipe it anyway. Conversations are short (a customer picks a watch in
 *  a few minutes), so losing history on redeploy is acceptable at this stage.
 *  Swap this module for Redis/Postgres when the bot goes to production. */

import { DEFAULT_LANG } from './i18n.js';

const sessions = new Map();

/** Evict chats untouched for this long so the map cannot grow without bound. */
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SWEEP_MS = 30 * 60 * 1000; // every 30 min

function blank(chatId) {
  return {
    chatId,
    lang: DEFAULT_LANG,
    langLocked: false, // true once the customer picked explicitly via /lang
    /** OpenAI-shaped message list, system prompt excluded. */
    history: [],
    /** Product the customer arrived with from the web app deep link. */
    context: { productId: null, source: null, productHint: null },
    /** `phoneDeclined`: the customer said they won't share a number (the
     *  "Позже" button or in words) — stop holding leads and re-asking for it. */
    profile: { name: null, phone: null, phoneDeclined: false },
    /** How the customer wants to receive a purchase — collected before a
     *  buy-now lead goes to the manager. See leads/pending.js. */
    order: { fulfillment: null, showroom: null, address: null },
    /** `pending` holds a buy-now lead still waiting on phone/fulfillment. */
    lead: { saved: false, escalated: false, pending: null },
    /** product ids already photographed this session — avoids resending the
     *  same photo every time the AI re-checks details on the same model. */
    sentPhotos: new Set(),
    /** Epoch ms until which a manager is handling this customer personally
     *  and the AI stays quiet. 0 = the AI is answering. See relay.js. */
    handoffUntil: 0,
    /** Epoch ms of the last /manager alert — repeated taps don't re-page. */
    managerCalledAt: 0,
    lastSeen: Date.now(),
    /** True while the AI is answering this chat. */
    busy: false,
    /** Texts that arrived while `busy`, answered together right after — people
     *  split one thought across several messages, and none may be dropped. */
    queue: [],
    /** Timestamps of recent AI turns, for the per-chat cost guard. */
    aiTurns: []
  };
}

export function getSession(chatId) {
  const key = String(chatId);
  let s = sessions.get(key);
  if (!s) {
    s = blank(key);
    sessions.set(key, s);
  }
  s.lastSeen = Date.now();
  return s;
}

export function resetHistory(chatId) {
  const s = getSession(chatId);
  s.history = [];
  // A buy-now lead still collecting details survives a /start (the web app's
  // deep links trigger one) — its timer will still deliver it. Like `profile`,
  // `order` is about the customer, not the conversation, so it stays too.
  s.lead = { saved: false, escalated: false, pending: s.lead?.pending ?? null };
  s.sentPhotos = new Set();
  return s;
}

/** Keeps the replayed window bounded; `turns` counts user+assistant messages.
 *  Tool call/result pairs must not be split, so we trim to the nearest user
 *  message boundary. */
export function trimHistory(session, turns) {
  const max = turns * 2;
  if (session.history.length <= max) return;
  let cut = session.history.length - max;
  while (cut < session.history.length && session.history[cut].role !== 'user') cut++;
  session.history = session.history.slice(cut);
}

/** A normal conversation is nowhere near this; a script hammering the bot to
 *  burn AI credits hits it within minutes. */
const AI_TURN_LIMIT = 30;
const AI_TURN_WINDOW_MS = 10 * 60 * 1000;

/** Records an AI turn; returns false when the chat is over its budget. */
export function takeAiTurn(session) {
  const now = Date.now();
  session.aiTurns = session.aiTurns.filter((at) => now - at < AI_TURN_WINDOW_MS);
  if (session.aiTurns.length >= AI_TURN_LIMIT) return false;
  session.aiTurns.push(now);
  return true;
}

export function sessionCount() {
  return sessions.size;
}

const sweeper = setInterval(() => {
  const now = Date.now();
  const cutoff = now - TTL_MS;
  for (const [key, s] of sessions) {
    // A conversation a manager is still handling must keep its handoff flag,
    // or the AI would start answering in the middle of it.
    if (s.lastSeen < cutoff && !s.busy && !s.lead.pending && s.handoffUntil <= now) {
      sessions.delete(key);
    }
  }
}, SWEEP_MS);
sweeper.unref?.();
