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

const BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));

/** Prices live in the data as integers of UZS. */
export function formatPrice(uzs, lang = 'ru') {
  const num = new Intl.NumberFormat('ru-RU').format(uzs);
  return lang === 'uz' ? `${num} so'm` : `${num} сум`;
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
    .replace(/[^a-z0-9а-яё]+/gi, ' ')
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

  scored.sort((a, b) => b.score - a.score || a.product.price - b.product.price);
  return scored.slice(0, limit).map((s) => s.product);
}

/** A one-line-per-product index cheap enough to keep in the system prompt so the
 *  model always knows the full line-up without a tool round trip. */
export function compactIndex() {
  return PRODUCTS.map(
    (p) =>
      `${p.id} | ${p.name} | ${p.category} | ${new Intl.NumberFormat('ru-RU').format(p.price)} UZS` +
      (p.tagline.ru ? ` | ${p.tagline.ru}` : '')
  ).join('\n');
}

export function priceRange() {
  const prices = PRODUCTS.map((p) => p.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
