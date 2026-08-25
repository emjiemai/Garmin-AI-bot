/** Parses the /start payloads the web app generates in web/js/telegram.js.
 *
 *  Format: `{source}__{productId}__{lang}` — Telegram allows 64 characters of
 *  [A-Za-z0-9_-] only, which rules out ':' as a separator. A bare '-' in the
 *  product slot means "no product". */

import { getProduct } from './catalog/catalog.js';
import { normalizeLang } from './i18n.js';

export const NO_PRODUCT = '-';

export function parseStartPayload(payload) {
  if (!payload) return { source: null, productId: null, lang: null };

  const [source, productId, lang] = String(payload).trim().split('__');
  const id = productId && productId !== NO_PRODUCT ? productId.trim() : null;

  return {
    source: source || null,
    // Resolve against the catalog so a stale link cannot poison the greeting.
    productId: id && getProduct(id) ? id : null,
    lang: normalizeLang(lang)
  };
}
