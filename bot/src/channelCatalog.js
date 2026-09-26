/** Index of the "extended" product catalog — everything Garmin sells beyond
 *  watches (navigators, marine electronics, cycling computers, etc.) that
 *  lives as photo+caption posts in a Telegram channel rather than in the
 *  structured JSON catalog, because someone can just post a photo with a
 *  Cyrillic description instead of hand-writing a data entry for each one.
 *
 *  The bot listens for channel_post updates from that channel (see bot.js),
 *  extracts the caption, and adds it here. When a customer's question matches
 *  an entry, the AI can forward that exact post — the real photo and the real
 *  description, not a paraphrase — via forward_channel_product in ai/tools.js.
 *
 *  Requires the bot to be added as an ADMIN of the channel; that's the only
 *  way Telegram delivers channel_post updates to a bot at all.
 *
 *  Persistence is best-effort JSONL, same ephemeral-on-Render-free caveat as
 *  leads/store.js — a redeploy wipes it, and it rebuilds from whatever the bot
 *  observes from that point forward. Move to a real database (e.g. the
 *  Supabase project the web app already uses) if that gap matters. */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';

const FILE = resolve(process.cwd(), config.channelCatalog.file);

/** messageId -> { messageId, caption, hasPhoto, indexedAt } */
const entries = new Map();

let writable = true;
try {
  mkdirSync(dirname(FILE), { recursive: true });
} catch (err) {
  writable = false;
  console.warn('[channel-catalog] file logging disabled:', err.message);
}

function loadFromDisk() {
  let raw;
  try {
    raw = readFileSync(FILE, 'utf8');
  } catch {
    return; // no file yet — fresh channel, or first boot since a redeploy
  }
  let loaded = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.messageId) {
        entries.set(entry.messageId, entry); // last write for a given id wins
        loaded++;
      }
    } catch {
      /* skip a corrupt line rather than fail the whole load */
    }
  }
  if (loaded) console.log(`[channel-catalog] loaded ${entries.size} entr(y/ies) from disk`);
}

loadFromDisk();

/** Called from the channel_post handler in bot.js as new products are posted. */
export function indexChannelPost({ messageId, caption, hasPhoto }) {
  if (!caption?.trim()) return null; // nothing to search on without a caption

  const entry = { messageId, caption: caption.trim(), hasPhoto, indexedAt: new Date().toISOString() };
  entries.set(messageId, entry);

  if (writable) {
    try {
      appendFileSync(FILE, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (err) {
      writable = false;
      console.warn('[channel-catalog] write failed, continuing in-memory only:', err.message);
    }
  }

  return entry;
}

/** True when this channel message was indexed as a product post. */
export function hasChannelPost(messageId) {
  return entries.has(Number(messageId));
}

/** Any letter or digit, not just a-z/а-я: Uzbek Cyrillic (қ, ғ, ҳ) must not be
 *  treated as a word separator, or "қўл" would be searched as "л". */
function normalize(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Ranked keyword search over indexed captions — same simple substring-scoring
 * approach as catalog/catalog.js's searchProducts, since captions are free
 * text rather than structured fields.
 */
export function searchChannelCatalog(query, limit = 5) {
  const terms = normalize(query).split(' ').filter((t) => t.length > 1);
  if (!terms.length) return [];

  const scored = [];
  for (const entry of entries.values()) {
    const haystack = normalize(entry.caption);
    let score = 0;
    for (const term of terms) if (haystack.includes(term)) score += 1;
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ entry }) => ({
    messageId: entry.messageId,
    // Long enough to tell several matches apart and answer a question (price,
    // specs) before forwarding. Still capped so a multi-result search doesn't
    // blow up the tool-result payload.
    snippet: entry.caption.slice(0, 500),
    has_photo: Boolean(entry.hasPhoto)
  }));
}

export function channelCatalogSize() {
  return entries.size;
}
