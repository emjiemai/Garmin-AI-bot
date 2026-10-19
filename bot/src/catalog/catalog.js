/** Loads the generated catalog and exposes the lookups the AI tools sit on top of. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @type {{store:object, categories:any[], products:any[], flagships:any[], branches:any[], faq:any[]}} */
export const catalog = JSON.parse(
  readFileSync(resolve(HERE, 'catalog.json'), 'utf8')
);

export const PRODUCTS = catalog.products;

/** A discount counts only when it is a whole 1-99 percent — the same rule
 *  garmin.com.uz applies, so the bot never quotes a price the site doesn't. */
export function validDiscount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? Math.round(n) : null;
}

/** The site's own rounding for a discounted price. */
export const discountedPrice = (price, discount) =>
  discount ? Math.round((price * (100 - discount)) / 100) : price;

// catalog.json stores the site's list price and its discount percent. Everything
// at runtime — search, price filters, the AI, lead alerts — works with what the
// customer actually pays, so `price` becomes that, and the list price moves to
// `listPrice` for the strike-through. scripts/sync-catalog.mjs reads the file
// itself and never sees this.
for (const p of PRODUCTS) {
  p.discount = p.price ? validDiscount(p.discount) : null;
  p.listPrice = p.price;
  p.price = discountedPrice(p.price, p.discount);
}

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

/** Prices live in the data as integers of UZS. A price of 0 means the site
 *  lists the model without one ("coming soon", "ask a manager"). */
export function formatPrice(uzs, lang = 'ru') {
  if (!uzs) return lang === 'uz' ? "so'rov bo'yicha" : 'по запросу';
  const num = new Intl.NumberFormat('ru-RU').format(uzs);
  return lang === 'uz' ? `${num} so'm` : `${num} сум`;
}

/** "17 510 000 сум (скидка 15%, было 20 600 000 сум)" — a product's price with its
 *  discount spelled out, for plain-text places (AI context, alerts, captions). */
export function formatProductPrice(p, lang = 'ru') {
  const price = formatPrice(p.price, lang);
  if (!p.discount) return price;
  return lang === 'uz'
    ? `${price} (${p.discount}% chegirma, avval ${formatPrice(p.listPrice, lang)})`
    : `${price} (скидка ${p.discount}%, было ${formatPrice(p.listPrice, lang)})`;
}

export function productName(p, lang = 'ru') {
  return lang === 'uz' ? p.name_uz || p.name : p.name;
}

export function getProduct(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * Normalises for fuzzy matching: lowercase, strip diacritics (fēnix -> fenix,
 * vívoactive -> vivoactive) and collapse anything non-alphanumeric. Customers
 * type "феникс 8", "fenix8" or "Fenix 8" and all three must hit.
 */
function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Common Cyrillic spellings customers use for the Latin model names. */
const TRANSLITERATIONS = [
  [/фен(и|е)кс/g, 'fenix'],
  [/форераннер|форранер|форерунер/g, 'forerunner'],
  [/инстинкт/g, 'instinct'],
  [/вену|веню/g, 'venu'],
  [/эпикс|эпик/g, 'epix'],
  [/вивоактив|вивактив/g, 'vivoactive'],
  [/вивосмарт/g, 'vivosmart'],
  [/лил(и|и2)/g, 'lily'],
  [/тактикс/g, 'tactix'],
  [/маркью|марк ку/g, 'marq'],
  [/эдж|едж/g, 'edge'],
  [/десцент|дескент/g, 'descent'],
  [/аппроач/g, 'approach']
];

function expandQuery(q) {
  let out = normalize(q);
  for (const [pattern, latin] of TRANSLITERATIONS) out = out.replace(pattern, latin);
  return out;
}

/**
 * Ranked keyword search across name, tagline, description, tags and specs.
 * Deliberately simple — the AI supplies well-formed queries, and an exact-ish
 * substring match on the model name is what actually matters in practice.
 */
export function searchProducts(query, { category, maxPrice, minPrice, limit = 6 } = {}) {
  const q = expandQuery(query ?? '');
  const terms = q.split(' ').filter((t) => t.length > 1);

  const scored = PRODUCTS.map((p) => {
    if (category && category !== 'all' && p.category !== category) return null;
    // An unpriced model matches no price bound — it isn't "under 10 million".
    if ((maxPrice || minPrice) && !p.price) return null;
    if (maxPrice && p.price > maxPrice) return null;
    if (minPrice && p.price < minPrice) return null;

    const haystackName = normalize(`${p.name} ${p.name_uz}`);
    const haystackRest = normalize(
      [
        p.tagline.ru,
        p.tagline.uz,
        p.description.ru,
        p.description.uz,
        p.tags.join(' '),
        p.specs.keyFeatures.join(' '),
        p.specs.displayType,
        p.specs.gps,
        p.category
      ].join(' ')
    );

    let score = 0;
    if (!terms.length) score = p.featured ? 2 : 1; // no query -> browse mode
    for (const term of terms) {
      if (haystackName.includes(term)) score += 10;
      if (haystackRest.includes(term)) score += 3;
    }
    if (!score) return null;
    if (p.featured) score += 1;

    return { product: p, score };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score || (a.product.price || Infinity) - (b.product.price || Infinity));
  return scored.slice(0, limit).map((s) => s.product);
}

/** A one-line-per-product index cheap enough to keep in the system prompt so the
 *  model always knows the full line-up without a tool round trip. */
export function compactIndex() {
  return PRODUCTS.map(
    (p) =>
      `${p.id} | ${p.name} | ${p.category} | ${p.price ? `${new Intl.NumberFormat('ru-RU').format(p.price)} UZS` : 'цена по запросу'}` +
      (p.discount ? ` (скидка ${p.discount}%, было ${new Intl.NumberFormat('ru-RU').format(p.listPrice)} UZS)` : '') +
      (p.tagline.ru ? ` | ${p.tagline.ru}` : '')
  ).join('\n');
}

export function priceRange() {
  const prices = PRODUCTS.map((p) => p.price).filter(Boolean);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
