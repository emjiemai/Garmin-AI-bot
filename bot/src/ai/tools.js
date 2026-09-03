/** Tool definitions handed to the model plus their server-side executors.
 *
 *  Executors return plain objects; the caller JSON-stringifies them back into
 *  the conversation as `role: "tool"` messages. */

import { catalog, formatPrice, getProduct, searchProducts } from '../catalog/catalog.js';
import { alertManager } from '../leads/notify.js';
import { config } from '../config.js';
import { searchChannelCatalog } from '../channelCatalog.js';
import { sendProductPhoto } from '../media.js';

export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description:
        'Найти товары Garmin в каталоге по запросу, категории и/или бюджету. ' +
        'Используй когда клиент описывает потребность ("часы для бега до 5 млн", ' +
        '"что-то для плавания") или называет модель неточно.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Ключевые слова: название модели, спорт, функция. Можно пустую строку ' +
              'если фильтруешь только по цене/категории.'
          },
          category: {
            type: 'string',
            enum: catalog.categories.map((c) => c.slug),
            description: 'Категория каталога. Не указывай, если клиент не сузил.'
          },
          min_price: { type: 'number', description: 'Минимальная цена в сумах.' },
          max_price: { type: 'number', description: 'Максимальная цена в сумах (бюджет клиента).' },
          limit: { type: 'number', description: 'Сколько результатов вернуть, 1-8. По умолчанию 5.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_product_details',
      description:
        'Получить полные характеристики конкретной модели по её id из каталога. ' +
        'Вызывай ВСЕГДА перед тем как называть точные спецификации (батарея, экран, ' +
        'GPS, водозащита) — то есть в любой момент, когда разговор сузился до ОДНОЙ ' +
        'конкретной модели. Автоматически отправляет клиенту её реальное фото (в ' +
        'первый раз за диалог) — тебе не нужно ничего для этого делать отдельно.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'id модели, например "fenix-8-47-amoled".' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_product_photo',
      description:
        'Отправить (или переслать ещё раз) реальное фото конкретной модели. ' +
        'get_product_details уже присылает фото автоматически при первом упоминании ' +
        'модели — эту функцию вызывай отдельно только если клиент просит фото ПОВТОРНО, ' +
        'или другой цвет/вариант, или ты ещё не вызывал get_product_details для этой модели.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'id модели, чьё фото нужно отправить.' }
        },
        required: ['product_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compare_products',
      description:
        'Сравнить 2–4 модели по ключевым характеристикам. Используй когда клиент ' +
        'выбирает между конкретными вариантами.',
      parameters: {
        type: 'object',
        properties: {
          product_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'От 2 до 4 id моделей из каталога.'
          }
        },
        required: ['product_ids']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_store_info',
      description:
        'Адреса шоурумов, часы работы, телефон, условия гарантии, доставки и оплаты.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: ['showrooms', 'delivery', 'warranty', 'payment', 'contacts', 'all'],
            description: 'Какая информация нужна.'
          }
        },
        required: ['topic']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_customer_contact',
      description:
        'Сохранить имя и/или телефон клиента, как только он их назвал. ' +
        'Вызывай сразу, не откладывая до конца диалога.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Имя клиента.' },
          phone: { type: 'string', description: 'Номер телефона в любом формате.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'notify_manager',
      description:
        'Уведомить живого менеджера о клиенте. urgency="now" — клиент готов купить ' +
        'прямо сейчас, менеджер получит срочный алерт. urgency="next" — тёплый лид, ' +
        'связаться в рабочее время. Вызывай по правилам из системного промпта.',
      parameters: {
        type: 'object',
        properties: {
          urgency: {
            type: 'string',
            enum: ['now', 'next'],
            description: '"now" — покупает сейчас; "next" — интересуется, думает.'
          },
          summary: {
            type: 'string',
            description:
              'Кратко ПО-РУССКИ что нужно клиенту и на чём остановились. 1–3 предложения.'
          },
          product_id: { type: 'string', description: 'id модели, которой интересуется клиент.' },
          customer_name: { type: 'string', description: 'Имя клиента, если известно.' },
          phone: { type: 'string', description: 'Телефон клиента, если оставил.' },
          budget: { type: 'string', description: 'Бюджет клиента, если называл.' }
        },
        required: ['urgency', 'summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_channel_catalog',
      description:
        'Найти товар в РАСШИРЕННОМ каталоге Garmin — это ВСЁ, что продаёт Garmin ' +
        'кроме часов: морские навигаторы и картплоттеры, велокомпьютеры, ' +
        'фишфайндеры, авиационное оборудование, GPS-трекеры для собак и т.д. ' +
        'Эти товары НЕ в структурированном каталоге (search_catalog не найдёт их) — ' +
        'они хранятся как посты с фото в отдельном Telegram-канале. Вызывай эту ' +
        'функцию, когда клиент спрашивает о чём-то, чего нет среди часов — ' +
        'это просто поиск информации, отвечай по её результату своими словами. ' +
        'Само по себе не отправляет ничего клиенту — для этого есть forward_channel_product.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Название модели или что ищет клиент, своими словами.'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'forward_channel_product',
      description:
        'Переслать клиенту реальное фото и полное описание товара из канала ' +
        '(используй message_id из результата search_channel_catalog). Вызывай ' +
        'ТОЛЬКО когда клиент явно попросил фото/показать товар — не вызывай просто ' +
        'потому что search_channel_catalog что-то нашёл. Если фото не просили, ' +
        'ответь по данным поиска своими словами, без пересылки.',
      parameters: {
        type: 'object',
        properties: {
          message_id: {
            type: 'number',
            description: 'message_id из результата search_channel_catalog.'
          }
        },
        required: ['message_id']
      }
    }
  }
];

function publicProduct(p, lang) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: formatPrice(p.price, lang),
    price_uzs: p.price,
    tagline: p.tagline[lang] || p.tagline.ru,
    description: p.description[lang] || p.description.ru,
    battery: p.specs.battery,
    display: p.specs.display,
    gps: p.specs.gps,
    water_rating: p.specs.waterRating,
    key_features: p.specs.keyFeatures,
    tags: p.tags
  };
}

const STORE_TOPICS = {
  showrooms: () => ({ showrooms: catalog.branches }),
  contacts: () => ({
    phone: catalog.store.phone,
    website: catalog.store.website,
    catalog: config.business.webAppUrl,
    instagram: catalog.store.instagram,
    working_hours: catalog.store.workingHours
  }),
  delivery: () => ({ faq: catalog.faq.filter((f) => /доставк/i.test(f.q.ru + f.a.ru)) }),
  warranty: () => ({ faq: catalog.faq.filter((f) => /гарант|сервис/i.test(f.q.ru + f.a.ru)) }),
  payment: () => ({ faq: catalog.faq.filter((f) => /оплат|pay/i.test(f.q.ru + f.a.ru)) }),
  all: () => ({
    store: catalog.store,
    showrooms: catalog.branches,
    faq: catalog.faq.map((f) => ({ q: f.q.ru, a: f.a.ru }))
  })
};

/**
 * Runs one tool call.
 * @param {{name:string, args:object}} call
 * @param {{bot:import('grammy').Bot, session:object, user:object}} ctx
 */
export async function executeTool({ name, args }, { bot, session, user }) {
  const lang = session.lang;

  switch (name) {
    case 'search_catalog': {
      const results = searchProducts(args.query ?? '', {
        category: args.category,
        minPrice: args.min_price,
        maxPrice: args.max_price,
        limit: Math.min(Math.max(Number(args.limit) || 5, 1), 8)
      });
      return {
        found: results.length,
        products: results.map((p) => publicProduct(p, lang)),
        note: results.length
          ? undefined
          : 'Ничего не найдено. Предложи расширить бюджет или уточнить запрос.'
      };
    }

    case 'get_product_details': {
      const p = getProduct(args.product_id);
      if (!p) {
        return {
          error: 'not_found',
          note: `Модели с id "${args.product_id}" нет в каталоге. Вызови search_catalog.`
        };
      }

      // A specific model just got identified — that's the moment to show a
      // real photo, without waiting for the customer to ask for one.
      const details = publicProduct(p, lang);
      if (!session.sentPhotos.has(p.id)) {
        const photo = await sendProductPhoto(bot, session, p, lang);
        if (photo.sent) {
          details.photo_sent = true;
          details.note = 'Фото уже отправлено клиенту вместе с этим ответом — не пиши "фото на сайте" и не дублируй ссылку.';
        }
      }
      return details;
    }

    case 'send_product_photo': {
      const p = getProduct(args.product_id);
      if (!p) {
        return {
          error: 'not_found',
          note: `Модели с id "${args.product_id}" нет в каталоге. Вызови search_catalog, чтобы найти правильный id.`
        };
      }

      const result = await sendProductPhoto(bot, session, p, lang);
      if (result.error === 'no_image') {
        return { sent: false, error: 'no_image', note: 'Для этой модели нет фото в базе. Извинись и предложи каталог на сайте.' };
      }
      if (!result.sent) {
        return { sent: false, error: 'send_failed', note: 'Не удалось отправить фото. Извинись и предложи каталог на сайте.' };
      }
      return { sent: true, note: 'Фото отправлено клиенту. Не присылай ссылку на сайт — она не нужна.' };
    }

    case 'compare_products': {
      const ids = Array.isArray(args.product_ids) ? args.product_ids.slice(0, 4) : [];
      const found = ids.map(getProduct).filter(Boolean);
      if (found.length < 2) {
        return { error: 'need_two', note: 'Нужно минимум 2 существующих id. Вызови search_catalog.' };
      }
      return { comparison: found.map((p) => publicProduct(p, lang)) };
    }

    case 'get_store_info': {
      const build = STORE_TOPICS[args.topic] ?? STORE_TOPICS.all;
      return build();
    }

    case 'save_customer_contact': {
      if (args.name) session.profile.name = String(args.name).slice(0, 80);
      if (args.phone) session.profile.phone = String(args.phone).slice(0, 32);
      return { saved: true, profile: session.profile };
    }

    case 'notify_manager': {
      const urgency = args.urgency === 'now' ? 'now' : 'next';

      // Guard against the model re-alerting on every turn of the same intent.
      if (urgency === 'next' && session.lead.saved) {
        return { skipped: true, note: 'Менеджер уже уведомлён об этом клиенте. Не сообщай об этом повторно, просто продолжай диалог.' };
      }
      if (urgency === 'now' && session.lead.escalated) {
        return { skipped: true, note: 'Срочный алерт уже отправлен. Успокой клиента: менеджер уже в пути.' };
      }

      const result = await alertManager(bot, {
        urgency,
        user,
        session,
        summary: args.summary,
        productId: args.product_id || session.context.productId,
        name: args.customer_name,
        phone: args.phone,
        budget: args.budget
      });

      session.lead.saved = true;
      if (urgency === 'now') session.lead.escalated = true;

      return {
        notified: result.delivered,
        urgency,
        note: result.delivered
          ? urgency === 'now'
            ? 'Менеджер получил срочный алерт. Скажи клиенту, что менеджер свяжется в течение нескольких минут.'
            : 'Менеджер уведомлён. Скажи клиенту, что с ним свяжутся, и продолжи помогать.'
          : 'Алерт не доставлен. Дай клиенту прямой телефон ' + catalog.store.phone
      };
    }

    case 'search_channel_catalog': {
      const matches = searchChannelCatalog(args.query ?? '', 5);
      return {
        found: matches.length,
        products: matches.map((m) => ({ message_id: m.messageId, snippet: m.snippet })),
        note: matches.length
          ? 'Вызови forward_channel_product с нужным message_id, чтобы клиент увидел фото и полное описание.'
          : 'Не найдено в расширенном каталоге. Если это похоже на часы, попробуй search_catalog. ' +
            'Иначе честно скажи, что уточнишь у менеджера.'
      };
    }

    case 'forward_channel_product': {
      const messageId = Number(args.message_id);
      if (!messageId) return { error: 'bad_message_id' };

      try {
        await bot.api.copyMessage(session.chatId, config.channelCatalog.id, messageId);
        return { sent: true, note: 'Фото и описание уже отправлены клиенту. Не дублируй описание в своём ответе — коротко спроси, нужна ли помощь с заказом.' };
      } catch (err) {
        console.error('[tools] forward_channel_product failed:', err.message);
        return {
          sent: false,
          error: 'forward_failed',
          note: 'Не удалось переслать пост. Извинись и предложи связать с менеджером за деталями.'
        };
      }
    }

    default:
      return { error: 'unknown_tool', name };
  }
}
