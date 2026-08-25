/** Sends a product's photo and tracks that it's been sent this session, so the
 *  same model doesn't get re-photographed every time the AI re-checks its
 *  details in the same conversation. Shared between the /start deep-link
 *  greeting (bot.js) and the get_product_details/send_product_photo tools
 *  (ai/tools.js), since both are "a specific product just got identified"
 *  moments that should show the customer a real photo without them asking. */

import { formatPrice, productName } from './catalog/catalog.js';

/**
 * @param {import('grammy').Bot} bot
 * @param {object} session
 * @param {object} product
 * @param {string} lang
 * @returns {Promise<{sent: boolean, alreadySent?: boolean, error?: string}>}
 */
export async function sendProductPhoto(bot, session, product, lang) {
  if (!product.image) return { sent: false, error: 'no_image' };

  const alreadySent = session.sentPhotos.has(product.id);

  try {
    await bot.api.sendPhoto(session.chatId, product.image, {
      caption: `${productName(product, lang)} — ${formatPrice(product.price, lang)}`
    });
    session.sentPhotos.add(product.id);
    return { sent: true, alreadySent };
  } catch (err) {
    console.error('[media] sendProductPhoto failed:', err.message);
    return { sent: false, error: 'send_failed' };
  }
}
