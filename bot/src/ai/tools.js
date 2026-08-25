/** Tool definitions handed to DeepSeek plus their server-side executors.
 *
 *  Executors return plain objects; the caller JSON-stringifies them back into
 *  the conversation as `role: "tool"` messages. */

import { catalog, formatPrice, getProduct, searchProducts } from '../catalog/catalog.js';
import { alertManager } from '../leads/notify.js';

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
        'Вызывай ВСЕГДА перед тем как называть точные спецификации (батарея, экран, GPS, водозащита).',
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
    catalog: catalog.store.catalogUrl,
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
      return publicProduct(p, lang);
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

    default:
      return { error: 'unknown_tool', name };
  }
}
