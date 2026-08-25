/**
 * Generates bot/src/catalog/catalog.json from the web app's js/data.js.
 *
 * The web app is the single source of truth for products, prices, branches and
 * FAQ. Rather than duplicating that data by hand, we import its ES module and
 * flatten it into a compact JSON payload the bot can load at boot.
 *
 * Run with: npm run build
 */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_SOURCE = resolve(HERE, '../../web/js/data.js');
const OUT_FILE = resolve(HERE, '../src/catalog/catalog.json');

// catalog.json is committed, so a checkout without web/ can still deploy the
// bot — it just keeps whatever catalog was last generated.
if (!existsSync(DATA_SOURCE)) {
  if (existsSync(OUT_FILE)) {
    console.warn(`[build] ${DATA_SOURCE} not found — keeping committed catalog.json`);
    process.exit(0);
  }
  console.error(`[build] ${DATA_SOURCE} not found and no committed catalog.json`);
  process.exit(1);
}

const {
  APP_CONFIG,
  CATEGORIES,
  PRODUCTS,
  BRANCHES,
  FAQ_DATA,
  FLAGSHIP_COMPARISON
} = await import(pathToFileURL(DATA_SOURCE).href);

/** Strip the fields the AI never needs so we keep the prompt payload small. */
function slimProduct(p) {
  const specs = p.specs ?? {};
  return {
    // Some SKU-style ids arrive from the CMS with stray whitespace, which would
    // break both id lookups and the Telegram deep-link payload charset.
    id: String(p.id).trim(),
    name: p.name,
    name_uz: p.name_uz ?? p.name,
    category: p.category,
    price: p.price,
    tagline: { ru: p.tagline ?? '', uz: p.tagline_uz ?? p.tagline ?? '' },
    description: {
      ru: p.description ?? '',
      uz: p.description_uz ?? p.description ?? ''
    },
    specs: {
      battery: specs.battery ?? null,
      batteryDays: specs.batteryDays ?? null,
      display: specs.display ?? null,
      displayType: specs.displayType ?? null,
      waterRating: specs.waterRating ?? null,
      gps: specs.gps ?? null,
      keyFeatures: specs.keyFeatures ?? []
    },
    tags: p.tags ?? [],
    featured: Boolean(p.featured),
    image: p.image ?? null
  };
}

function slimBranch(b) {
  return {
    name: b.name,
    address: b.address,
    phone: b.phone,
    hours: b.hours,
    mapUrl: b.map_url
  };
}

function slimFaq(f) {
  return {
    q: { ru: f.q_ru, uz: f.q_uz },
    a: { ru: f.a_ru, uz: f.a_uz }
  };
}

const catalog = {
  generatedFrom: 'web/js/data.js',
  store: {
    name: APP_CONFIG.storeName,
    phone: APP_CONFIG.phone,
    phoneClean: APP_CONFIG.phoneClean,
    website: APP_CONFIG.websiteUrl,
    catalogUrl: `${APP_CONFIG.websiteUrl.replace(/\/$/, '')}/catalog`,
    instagram: APP_CONFIG.instagramUrl,
    currency: APP_CONFIG.currency,
    workingHours: APP_CONFIG.workingHours
  },
  categories: CATEGORIES.map((c) => ({
    slug: c.slug,
    title: { ru: c.title, uz: c.title_uz ?? c.title }
  })),
  products: PRODUCTS.map(slimProduct).sort((a, b) => a.price - b.price),
  flagships: FLAGSHIP_COMPARISON,
  branches: BRANCHES.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(slimBranch),
  faq: FAQ_DATA.map(slimFaq)
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(catalog, null, 2), 'utf8');

const bytes = Buffer.byteLength(JSON.stringify(catalog));
console.log(
  `catalog.json written: ${catalog.products.length} products, ` +
    `${catalog.branches.length} branches, ${catalog.faq.length} FAQ entries ` +
    `(${(bytes / 1024).toFixed(1)} KB)`
);
