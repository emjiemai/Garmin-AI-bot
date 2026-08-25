// Deep links into the Garmin AI Telegram bot.
//
// Buttons in this web app used to open a plain chat with a human manager
// (t.me/garmin_uz?text=...). They now open the AI consultant instead, carrying
// enough context for the bot to greet the customer about the exact product they
// were looking at.
//
// Telegram's /start payload is limited to 64 characters of [A-Za-z0-9_-], which
// is why the fields are joined with a double underscore rather than a colon and
// why product ids are sanitised.

import { APP_CONFIG } from './data.js';

export const BOT_USERNAME = APP_CONFIG.telegramBotUsername || 'garminofficialuzbot';

/** Chat with a human manager — kept for the "call a person" path. */
export const HUMAN_TELEGRAM_URL = APP_CONFIG.telegramUrl;

const MAX_PAYLOAD = 64;

/** Stands in for "no product". A bare hyphen can never be a real id because
 *  sanitize() strips leading and trailing hyphens, so the two never collide. */
const NONE = '-';

function sanitize(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds a t.me link that opens the bot and fires `/start <payload>`.
 *
 * @param {'card'|'quiz'|'cmp'|'cta'|'pay'} source Where the customer tapped.
 * @param {string|null} productId Product the customer was viewing, if any.
 * @param {string} lang Active UI language ('ru' | 'uz' | 'en').
 */
export function botLink(source, productId = null, lang = 'ru') {
  // The bot speaks Russian and Uzbek; English visitors get the Russian flow.
  const botLang = lang === 'uz' ? 'uz' : 'ru';
  const parts = [sanitize(source) || 'cta', sanitize(productId) || NONE, botLang];

  let payload = parts.join('__');
  if (payload.length > MAX_PAYLOAD) {
    // Drop the product rather than send a truncated id the bot cannot resolve.
    payload = [parts[0], NONE, botLang].join('__');
  }

  return `https://t.me/${BOT_USERNAME}?start=${payload}`;
}
