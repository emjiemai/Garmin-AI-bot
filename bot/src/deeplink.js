/** Parses the /start payloads the web app generates in web/js/telegram.js.
 *
 *  Format: `{source}__{productId}__{lang}` — Telegram allows 64 characters of
 *  [A-Za-z0-9_-] only, which rules out ':' as a separator. A bare '-' in the
 *  product slot means "no product".
 *
 *  Deep links honour that charset, but anyone can also type "/start <anything>"
 *  by hand, so nothing here trusts the payload's shape. */

import { getProduct } from './catalog/catalog.js';
import { normalizeLang } from './i18n.js';

export const NO_PRODUCT = '-';

const SAFE = /[^A-Za-z0-9_-]/g;

export function parseStartPayload(payload) {
  if (!payload) return { source: null, productId: null, productHint: null, lang: null };

  const [rawSource, rawProduct, lang] = String(payload).trim().split('__');
  const source = (rawSource ?? '').replace(SAFE, '').slice(0, 16) || null;
  const id = rawProduct && rawProduct !== NO_PRODUCT ? rawProduct.replace(SAFE, '').slice(0, 64) : null;
  const known = id && getProduct(id) ? id : null;

  return {
    source,
    // Resolve against the catalog so a stale link cannot poison the greeting.
    productId: known,
    // …but keep what the customer was looking at: the web app can link to a
    // model the bot's catalog doesn't carry (e.g. a comparison-table entry),
    // and "interested in venu 3" is still worth knowing.
    productHint: id && !known ? id.replace(/[-_]+/g, ' ').trim() || null : null,
    lang: normalizeLang(lang)
  };
}
