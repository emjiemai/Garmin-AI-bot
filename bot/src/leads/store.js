/** Lead log.
 *
 *  The durable record is the MGMG Command Center's Postgres: every lead and
 *  every later phone number is sent there (commandCenter.js). The JSONL file
 *  stays as a local/debug copy — Render's free disk is wiped on restart. */

import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { leadEvent, sendToCommandCenter } from './commandCenter.js';

const FILE = resolve(process.cwd(), config.leadsFile);

let writable = true;
try {
  mkdirSync(dirname(FILE), { recursive: true });
} catch (err) {
  writable = false;
  console.warn('[leads] file logging disabled:', err.message);
}

/** Leads captured this process lifetime, newest first — powers /stats. */
const recent = [];
const RECENT_LIMIT = 100;

export function saveLead(lead) {
  const record = { ...lead, leadId: randomUUID(), at: new Date().toISOString() };

  recent.unshift(record);
  if (recent.length > RECENT_LIMIT) recent.pop();

  if (writable) {
    try {
      appendFileSync(FILE, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (err) {
      writable = false;
      console.warn('[leads] write failed, continuing in-memory only:', err.message);
    }
  }

  sendToCommandCenter(leadEvent(record));
  return record;
}

/** A phone that arrived after the lead went out belongs on that lead, so
 *  /stats counts it under "with phone" instead of as a second lead. */
export function attachPhoneToLead(chatId, phone) {
  const lead = recent.find((l) => l.chatId === chatId && l.urgency !== 'outage');
  if (lead && !lead.phone) lead.phone = phone;
  // Sent even when this process has no such lead in memory (it may have
  // restarted): the Command Center puts it on the customer's latest lead.
  sendToCommandCenter({ event: 'phone', chat_id: Number(chatId), phone });
}

export function recentLeads(limit = 10) {
  return recent.slice(0, limit);
}

export function leadStats() {
  return {
    // "total" is genuine sales leads only — an outage ticket is not one, and
    // counting it in would overstate real interest to whoever reads /stats.
    total: recent.filter((l) => l.urgency !== 'outage').length,
    hot: recent.filter((l) => l.urgency === 'now').length,
    warm: recent.filter((l) => l.urgency === 'next').length,
    outages: recent.filter((l) => l.urgency === 'outage').length,
    withPhone: recent.filter((l) => l.phone).length
  };
}
