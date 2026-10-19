/** Sends a product's photo and tracks that it's been sent this session, so the
 *  same model doesn't get re-photographed every time the AI re-checks its
 *  details in the same conversation. Shared between the /start deep-link
 *  greeting (bot.js) and the get_product_details/send_product_photo tools
 *  (ai/tools.js), since both are "a specific product just got identified"
 *  moments that should show the customer a real photo without them asking. */

import { formatProductPrice, productName } from './catalog/catalog.js';
import { buildProductCard, CAPTION_MAX } from './productCard.js';

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
      caption: `${productName(product, lang)} — ${formatProductPrice(product, lang)}`
    });
    session.sentPhotos.add(product.id);
    return { sent: true, alreadySent };
  } catch (err) {
    console.error('[media] sendProductPhoto failed:', err.message);
    return { sent: false, error: 'send_failed' };
  }
}

/**
 * The message a customer gets on arriving from the web app: the product photo
 * with a written card as its caption. If Telegram can't fetch the photo (a bad URL or file
 * type), the same card goes out as plain text — the customer still gets it.
 *
 * @param {import('grammy').Bot} bot
 * @param {object} session
 * @param {object} product
 * @param {'ru'|'uz'} lang
 */
export async function sendProductCard(bot, session, product, lang) {
  const { caption } = buildProductCard(product, lang);

  if (product.image && caption.length <= CAPTION_MAX) {
    try {
      await bot.api.sendPhoto(session.chatId, product.image, { caption, parse_mode: 'HTML' });
      session.sentPhotos.add(product.id);
      return { sent: true, photo: true };
    } catch (err) {
      console.error('[media] sendProductCard photo failed, sending text:', err.message);
    }
  }

  try {
    await bot.api.sendMessage(session.chatId, caption, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    });
    return { sent: true, photo: false };
  } catch (err) {
    console.error('[media] sendProductCard failed:', err.message);
    return { sent: false, error: 'send_failed' };
  }
}
