/** Customer phone numbers.
 *
 *  A phone reaches the bot three ways — the "📱 Оставить номер" button, the
 *  customer typing it, or the AI extracting it into a tool call — and every one
 *  of them has produced something a manager can't dial:
 *   - Telegram's shared contact omits the "+" ("998901234567");
 *   - text copied from other apps carries invisible characters (zero-width
 *     spaces, bidi marks) that survive into the alert;
 *   - the model, asked for "the customer's phone", will sometimes fill in the
 *     one phone it knows for sure — ours — or a refusal like "не скажу".
 *  A held buy-now lead treats any non-empty phone as "we can call them", so a
 *  bad value here silently sends the manager a lead with no way to reach the
 *  customer. Everything goes through normalizePhone before it is stored. */

import { catalog } from './catalog/catalog.js';
import { config } from './config.js';

/** Zero-width, bidi-control and BOM characters that are invisible on screen. */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g;

/** E.164 allows at most 15 digits; anything under 9 cannot be a full number. */
const MIN_DIGITS = 9;
const MAX_DIGITS = 15;

/** Uzbek mobile numbers are often written without the country code. */
const UZ_LOCAL_DIGITS = 9;
const UZ_COUNTRY = '998';

/**
 * @returns {string|null} "+<digits>" or null when the input is not a usable
 *   phone number.
 */
export function normalizePhone(raw) {
  const text = String(raw ?? '').replace(INVISIBLE, '').trim();
  if (!text) return null;

  // A real number is digits plus separators; words mean it is something else
  // ("не скажу", "позже", an @username).
  if (/[^\d\s()+\-.]/.test(text)) return null;

  let digits = text.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2); // 00998… international prefix
  if (digits.length === UZ_LOCAL_DIGITS) digits = UZ_COUNTRY + digits;
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

  return `+${digits}`;
}

const BUSINESS_PHONES = new Set(
  [
    config.business.phone,
    config.business.managerPhone,
    catalog.store.phone,
    catalog.store.phoneClean,
    ...catalog.branches.map((b) => b.phone)
  ]
    .map(normalizePhone)
    .filter(Boolean)
);

/** True when the number is one of ours, not the customer's. */
export function isBusinessPhone(phone) {
  const normalized = normalizePhone(phone);
  return Boolean(normalized) && BUSINESS_PHONES.has(normalized);
}
