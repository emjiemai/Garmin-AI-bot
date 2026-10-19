/**
 * Brings bot/src/catalog/catalog.json in line with the live garmin.com.uz catalog.
 *
 *   node scripts/sync-catalog.mjs          # write catalog.json
 *   node scripts/sync-catalog.mjs --check  # report what would change, write nothing
 *
 * Replaces scripts/build-catalog.mjs, which read web/js/data.js — a file the
 * landing-page rewrite deleted. What it does, per live product:
 *   - already in the catalog  -> price, discount and site id refreshed, name spacing tidied;
 *                                hand-curated text and specs are kept
 *   - not in the catalog yet  -> added with the tagline/description the site has
 * Products that left the site are reported, never deleted. The branches, FAQ and
 * store sections are untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, '../src/catalog/catalog.json');
const API = 'https://api.garmin.com.uz/api/public';
const CHECK = process.argv.includes('--check');

/** Site category -> the bot's category slug. */
const CATEGORY = { adventure: 'outdoor' };
const categoryFor = (c) => CATEGORY[c] ?? c ?? 'outdoor';

/** Same rule as the site: a whole 1-99 percent, anything else is no discount. */
const discountOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 99 ? Math.round(n) : null;
};

const clean = (s) => String(s ?? '').replace(/,(?=\S)/g, ', ').replace(/\s+/g, ' ').trim();

async function get(path) {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return (await res.json()).data;
}

const [live, translations] = await Promise.all([
  get('products?orderBy=sort&ascending=true'),
  get('product_translations')
]);

const catalog = JSON.parse(readFileSync(FILE, 'utf8'));
const byId = new Map(catalog.products.map((p) => [p.id, p]));
const uz = new Map(translations.filter((r) => r.lang === 'uz').map((r) => [r.product_id.trim(), r]));

const report = { priced: [], discounts: [], added: [], missing: [] };

// Russian tagline -> Uzbek, learned from products that have both. Fills the gap for
// new products the site has not translated yet (e.g. every «Премиум мультиспорт»).
const CYRILLIC = /[Ѐ-ӿ]/;
const uzTagline = new Map();
for (const p of catalog.products) {
  if (p.tagline.ru && p.tagline.uz && !CYRILLIC.test(p.tagline.uz)) uzTagline.set(p.tagline.ru, p.tagline.uz);
}

for (const row of live) {
  const id = row.id.trim();
  // The site looks products up by their exact id — keep it if it has stray whitespace.
  const siteId = row.id !== id ? row.id : undefined;
  const price = Number(row.price) || 0;
  const discount = discountOf(row.discount_percent);
  const existing = byId.get(id);

  if (existing) {
    // Same tidy-up the web page applies, so both show the same name.
    existing.name = clean(existing.name);
    existing.name_uz = clean(existing.name_uz);
    if (existing.price !== price) {
      report.priced.push(`${id}: ${existing.price} -> ${price}`);
      existing.price = price;
    }
    if ((existing.discount ?? null) !== discount) {
      report.discounts.push(`${id}: ${existing.discount ?? 0}% -> ${discount ?? 0}%`);
    }
    existing.discount = discount;
    if (CYRILLIC.test(existing.tagline.uz) && uzTagline.has(existing.tagline.ru)) existing.tagline.uz = uzTagline.get(existing.tagline.ru);
    if (siteId) existing.siteId = siteId;
    else delete existing.siteId;
    continue;
  }

  const t = uz.get(id);
  const image = row.image_path && !row.image_path.startsWith('seed:') ? `${API}/media/${row.image_path}` : null;
  const product = {
    id,
    name: clean(row.name),
    name_uz: clean(row.name),
    category: categoryFor(row.category),
    price,
    discount,
    tagline: { ru: row.tagline ?? '', uz: t?.tagline || uzTagline.get(row.tagline) || row.tagline || '' },
    description: { ru: row.description ?? '', uz: t?.description || row.description || '' },
    specs: { battery: null, batteryDays: null, display: null, displayType: null, waterRating: null, gps: null, keyFeatures: [] },
    tags: [],
    featured: false,
    image
  };
  if (siteId) product.siteId = siteId;
  catalog.products.push(product);
  byId.set(id, product);
  report.added.push(`${id} | ${product.name} | ${price}`);
}

const liveIds = new Set(live.map((r) => r.id.trim()));
report.missing = catalog.products.filter((p) => !liveIds.has(p.id)).map((p) => p.id);

console.log(`live products: ${live.length}, catalog products: ${catalog.products.length}`);
console.log(`prices updated (${report.priced.length}):`, report.priced.length ? '\n  ' + report.priced.join('\n  ') : 'none');
console.log(`discounts changed (${report.discounts.length}):`, report.discounts.length ? '\n  ' + report.discounts.join('\n  ') : 'none');
console.log(`added (${report.added.length}):`, report.added.length ? '\n  ' + report.added.join('\n  ') : 'none');
if (report.missing.length) console.log(`in catalog but no longer on the site (kept): ${report.missing.join(', ')}`);

if (CHECK) {
  console.log('--check: nothing written');
} else {
  writeFileSync(FILE, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log('catalog.json written');
}
