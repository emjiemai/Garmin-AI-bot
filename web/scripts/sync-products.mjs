// Snapshot the live garmin.com.uz catalog into web/products.json and mirror every
// product photo as a small WebP under web/img/p/.
//
// Why mirror: the garmin.com.uz image host drops requests when many load at once and
// serves full-size originals (up to 360 KB for a card ~170 px wide). Local 480 px WebPs
// are ~10-20 KB each and ship from the same static host as the page.
//
// Setup once:  cd web/scripts && npm install
// Run:         node web/scripts/sync-products.mjs
import { writeFileSync, readFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const API = 'https://api.garmin.com.uz/api/public';
const WEB = fileURLToPath(new URL('..', import.meta.url));
const OUT = WEB + 'products.json';
const IMG_DIR = WEB + 'img/p/';
const SIZE = 480; // cards show ~170 CSS px; 480 covers 2.8x screens

// A few products reference images bundled inside the site's own JS ("seed:<key>").
// The originals are saved once in scripts/seed-images/.
const SEED = {
  'fenix-8': 'fenix-8.png',
  'fenix-e': 'fenix-e.png',
  'tactix-8': 'tactix-8.webp',
  'instinct-3': 'instinct-3.webp',
  'forerunner-970': 'forerunner-970.webp',
  'vivoactive-6': 'vivoactive-6.jpeg',
  'lily-2-active': 'lily-2-active.webp',
  'approach-s70': 'approach-s70.jpeg',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 4) throw new Error(`${url}: ${err.message}`);
      await sleep(500 * attempt);
    }
  }
}

async function source(imagePath) {
  if (imagePath.startsWith('seed:')) {
    const file = SEED[imagePath.slice(5)];
    if (!file) throw new Error(`unmapped seed image "${imagePath}" — save it in scripts/seed-images/ and add it to SEED`);
    return readFileSync(WEB + 'scripts/seed-images/' + file);
  }
  return download(`${API}/media/${imagePath}`);
}

const res = await fetch(`${API}/products?orderBy=sort&ascending=true`);
if (!res.ok) throw new Error(`products API answered ${res.status}`);
const { data } = await res.json();
const raw = data.filter((p) => p.id && p.name && p.image_path);

mkdirSync(IMG_DIR, { recursive: true });
const fileFor = (id) => id.toLowerCase().replace(/[^a-z0-9-]+/g, '_') + '.webp';

// Few at a time: the image host is the flaky part.
const products = new Array(raw.length);
let next = 0;
let bytes = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < raw.length) {
      const i = next++;
      const p = raw[i];
      const id = p.id.trim(); // two live ids carry a trailing space
      const file = fileFor(id);
      const out = await sharp(await source(p.image_path))
        .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true, background: '#fff' })
        .flatten({ background: '#fff' }) // cards sit on white; drops the alpha channel
        .webp({ quality: 80, effort: 5 })
        .toBuffer();
      writeFileSync(IMG_DIR + file, out);
      bytes += out.length;
      products[i] = {
        id,
        name: p.name.replace(/,(?=\S)/g, ', ').replace(/\s+/g, ' ').trim(),
        category: p.category || null,
        price: Number(p.price) || 0,
        // Same rule as the site: a whole 1-99 percent, anything else is no discount.
        discount: Number(p.discount_percent) >= 1 && Number(p.discount_percent) <= 99 ? Math.round(Number(p.discount_percent)) : null,
        image: 'img/p/' + file,
      };
    }
  }),
);

// Drop images of products that no longer exist.
const keep = new Set(products.map((p) => p.image.slice('img/p/'.length)));
for (const f of readdirSync(IMG_DIR)) if (!keep.has(f)) rmSync(IMG_DIR + f);

writeFileSync(OUT, JSON.stringify({ syncedAt: new Date().toISOString(), products }, null, 1));
console.log(`${products.length} of ${data.length} products -> web/products.json`);
console.log(`${products.length} images -> web/img/p/ (${(bytes / 1024).toFixed(0)} KB total, ${(bytes / products.length / 1024).toFixed(1)} KB avg)`);
