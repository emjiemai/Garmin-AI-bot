/** Sends every lead to the MGMG Command Center, where it is stored in Postgres.
 *
 *  This bot runs on Render's free plan, whose disk is wiped on every restart,
 *  so leads.jsonl was never a real record. The Command Center (the company's
 *  FastAPI + PostgreSQL service, repo emjiemai/mgmg-agents) keeps them:
 *
 *      POST {COMMAND_CENTER_URL}/webhooks/garmin-lead/{COMMAND_CENTER_SECRET}
 *
 *  - Never blocks or breaks a customer conversation: sending is
 *    fire-and-forget, and the Telegram alert to the manager still goes out.
 *  - A 5xx, 429 or network error is retried (3 tries), and what still failed
 *    waits in memory and is re-sent with the next lead and every 5 minutes.
 *  - A 4xx (wrong secret, malformed lead) is logged and dropped — retrying
 *    can't fix it.
 *  - Each lead carries its own lead_id, so a re-sent lead is stored once.
 *
 *  Without COMMAND_CENTER_URL and COMMAND_CENTER_SECRET this does nothing. */

import { config } from '../config.js';

const MAX_QUEUE = 500;
const queue = [];
let flushing = false;

export function commandCenterEnabled() {
  return Boolean(config.commandCenter.url && config.commandCenter.secret);
}

/** Leads (and phone updates) not delivered yet — shown in /stats. */
export function pendingForCommandCenter() {
  return queue.length;
}

/** The lead as the Command Center expects it (integrations/garmin/leads.py). */
export function leadEvent(record) {
  return {
    event: 'lead',
    lead_id: record.leadId,
    chat_id: Number(record.chatId),
    urgency: record.urgency,
    name: record.name ?? null,
    username: record.username ?? null,
    phone: record.phone ?? null,
    product_id: record.productId ?? null,
    product_name: record.productName ?? null,
    price: record.price ?? null,
    budget: record.budget ?? null,
    summary: record.summary ?? null,
    lang: record.lang ?? null,
    source: record.source ?? null,
    at: record.at
  };
}

/** Queue one event and try to deliver everything waiting. Returns at once. */
export function sendToCommandCenter(event) {
  if (!commandCenterEnabled()) return false;
  queue.push(event);
  if (queue.length > MAX_QUEUE) queue.shift();
  void flushCommandCenter();
  return true;
}

/** Deliver queued events in order; stops at the first one that must wait. */
export async function flushCommandCenter() {
  if (flushing || !commandCenterEnabled()) return;
  flushing = true;
  try {
    while (queue.length) {
      const outcome = await deliver(queue[0]);
      if (outcome === 'retry-later') break;
      queue.shift();
    }
  } finally {
    flushing = false;
  }
}

async function deliver(event) {
  const { url, secret, retryMs } = config.commandCenter;
  const endpoint = `${url.replace(/\/+$/, '')}/webhooks/garmin-lead/${encodeURIComponent(secret)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(10_000)
      });
      if (res.ok) return 'delivered';
      if (res.status < 500 && res.status !== 429) {
        // Never print the URL: it contains the secret.
        console.error(`[command-center] lead refused (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
        return 'dropped';
      }
      console.warn(`[command-center] HTTP ${res.status}, attempt ${attempt}/3`);
    } catch (err) {
      console.warn(`[command-center] ${err.name}: ${err.message}, attempt ${attempt}/3`);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, retryMs * attempt));
  }
  return 'retry-later';
}

// Re-send what's waiting every 5 minutes; unref so it never keeps the process alive.
setInterval(() => {
  if (queue.length) void flushCommandCenter();
}, 5 * 60_000).unref();
