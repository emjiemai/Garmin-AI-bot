/** The product message a customer gets when they arrive from the web app.
 *
 *  Built from hand-written copy (catalog/cards.json) — never from the catalog's
 *  structured specs, which are unreliable (bike computers tagged AMOLED, a
 *  heart-rate strap with a watch's battery life). Products without hand-written
 *  copy degrade to tagline + a short, clean excerpt of the site description,
 *  rather than pasting the site's multi-paragraph text into a chat bubble. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, formatPrice, productName } from './catalog/catalog.js';
import { escapeHtml } from './format.js';
import { t } from './i18n.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const { cards } = JSON.parse(readFileSync(resolve(HERE, 'catalog/cards.json'), 'utf8'));

const BY_ID = new Map();
for (const card of cards) for (const id of card.ids) BY_ID.set(id, card);

/** Telegram caps a photo caption at 1024 characters. */
export const CAPTION_MAX = 1024;

const FALLBACK_EXCERPT_MAX = 220;

/** Where the "open on the site" button goes: the exact product page. */
export function productSiteUrl(product) {
  const base = (catalog.store.website || 'https://garmin.com.uz').replace(/\/+$/, '');
  return `${base}/product/${encodeURIComponent(product.siteId ?? product.id)}`;
}

/** First sentence of the site description, only if it is short and clean. */
function excerpt(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const first = clean.split(/(?<=[.!?])\s/)[0];
  return first.length <= FALLBACK_EXCERPT_MAX ? first : null;
}

/** The catalog falls back to Russian text where the site has no Uzbek one; an
 *  Uzbek card must not show it. */
const CYRILLIC = /[Ѐ-ӿ]/;
const inLang = (text, lang) => (text && !(lang === 'uz' && CYRILLIC.test(text)) ? text : '');

function copyFor(product, lang) {
  const card = BY_ID.get(product.id)?.[lang];
  if (card) return { blurb: card.blurb, points: card.points ?? [] };
  return { blurb: excerpt(inLang(product.description?.[lang], lang)), points: [] };
}

/**
 * @param {object} product catalog product
 * @param {'ru'|'uz'} lang
 * @returns {{caption: string, url: string}} caption is Telegram HTML, ≤ 1024 chars
 */
export function buildProductCard(product, lang) {
  const { blurb, points } = copyFor(product, lang);
  const tagline = inLang(product.tagline?.[lang], lang) || (lang === 'ru' ? product.tagline?.ru : '') || '';
  const known = BY_ID.has(product.id);

  const render = ({ withPoints, withClosing, withMore }) => {
    const parts = [`<b>${escapeHtml(productName(product, lang))}</b>`];
    if (tagline) parts[0] += `\n<i>${escapeHtml(tagline)}</i>`;
    if (blurb) parts.push(escapeHtml(blurb));
    if (withPoints && points.length) parts.push(points.map((p) => `• ${escapeHtml(p)}`).join('\n'));
    if (withMore && !known) parts.push(escapeHtml(t(lang, 'cardMore')));
    parts.push(
      product.price > 0
        ? `💰 <b>${escapeHtml(formatPrice(product.price, lang))}</b>`
        : `💰 ${escapeHtml(t(lang, 'cardPriceAsk'))}`
    );
    if (withClosing) parts.push(escapeHtml(t(lang, 'cardClosing')));
    return parts.join('\n\n');
  };

  // Drop the optional pieces, least important first, until it fits.
  const attempts = [
    { withPoints: true, withClosing: true, withMore: true },
    { withPoints: true, withClosing: false, withMore: true },
    { withPoints: false, withClosing: false, withMore: true },
    { withPoints: false, withClosing: false, withMore: false }
  ];
  let caption = render(attempts[0]);
  for (const a of attempts) {
    caption = render(a);
    if (caption.length <= CAPTION_MAX) break;
  }

  return { caption, url: productSiteUrl(product) };
}
