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
 * @param {'card'|'quiz'|'cmp'|'cta'|'story'} source Where the customer tapped.
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

/**
 * Navigates to a t.me link. When this page is running as a Telegram Mini App
 * (opened via the "🛍 Каталог" web_app button), a plain `<a target="_blank">`
 * or `window.open()` does not hand off to Telegram properly — the Mini App
 * stays open underneath, and re-tapping the same link (because nothing
 * visibly happened) can fire /start over and over. `openTelegramLink` is
 * Telegram's own bridge for this exact handoff and does it correctly in one
 * step. `initData` is only non-empty inside a real Telegram WebView, so
 * outside Telegram (a normal browser tab) this falls back to a plain open.
 */
export function openBotLink(url) {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData) {
    tg.openTelegramLink(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Wires the fallback path for every current and future `<a href="https://t.me/...">`
 * on the page through openBotLink, via one delegated listener instead of
 * hunting down each render site. Call once at startup.
 */
export function installTelegramLinkBridge() {
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[href^="https://t.me/"]');
    if (!anchor) return;
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) {
      event.preventDefault();
      tg.openTelegramLink(anchor.href);
    }
    // Outside Telegram: let the browser handle the link natively.
  });
}
