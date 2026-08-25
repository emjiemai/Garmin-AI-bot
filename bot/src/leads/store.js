/** Append-only lead log.
 *
 *  Render's free instance filesystem is ephemeral, so this file is a convenience
 *  for local development and post-mortem debugging — the Telegram alert to the
 *  manager is the durable record. Point LEADS_FILE at a mounted disk (or replace
 *  this module with a Supabase insert) when moving off the free plan. */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

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
  const record = { ...lead, at: new Date().toISOString() };

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

  return record;
}

export function recentLeads(limit = 10) {
  return recent.slice(0, limit);
}

export function leadStats() {
  return {
    total: recent.length,
    hot: recent.filter((l) => l.urgency === 'now').length,
    warm: recent.filter((l) => l.urgency === 'next').length,
    withPhone: recent.filter((l) => l.phone).length
  };
}
