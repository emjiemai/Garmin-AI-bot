/** Russian and Uzbek UI strings plus language detection.
 *  The AI replies are generated in the customer's language; these strings cover
 *  the fixed chrome (buttons, errors, system notices). */

export const LANGS = ['ru', 'uz'];
export const DEFAULT_LANG = 'ru';

const STRINGS = {
  ru: {
    langName: 'Русский',
    welcome:
      '👋 Здравствуйте! Я — ИИ-консультант *Garmin Uzbekistan*.\n\n' +
      'Помогу подобрать часы, сравнить модели, расскажу про цены, гарантию и доставку.\n\n' +
      'Просто напишите, что вас интересует.',
    welcomeProduct: (name, price) =>
      `👋 Здравствуйте! Вы смотрели *${name}* — ${price}.\n\n` +
      'Я — ИИ-консультант Garmin Uzbekistan. Расскажу про эту модель, сравню с другими ' +
      'или оформлю заказ. Что интересует?',
    chooseLang: 'Выберите язык / Tilni tanlang:',
    langSet: '✅ Язык переключён на русский.',
    thinking: '⌛️ Секунду…',
    error:
      '⚠️ Извините, произошла техническая ошибка. Попробуйте ещё раз или ' +
      'свяжитесь с менеджером: +998 (70) 120-33-33',
    rateLimited: '⏳ Слишком много сообщений подряд. Подождите пару секунд.',
    aiDown:
      '🙏 Извините, консультант сейчас недоступен. Я уже передал ваш вопрос ' +
      'менеджеру — он свяжется с вами в ближайшее время.\n' +
      'Срочно? Позвоните: +998 (70) 120-33-33',
    reset: '🔄 История диалога очищена. Начнём заново!',
    btnCatalog: '🛍 Каталог',
    btnShowrooms: '📍 Шоурумы',
    btnManager: '👤 Менеджер',
    btnSharePhone: '📱 Оставить номер',
    btnLang: '🌐 Til / Язык',
    phoneThanks: (phone) =>
      `✅ Спасибо! Записал ваш номер: ${phone}\nМенеджер свяжется с вами в рабочее время (10:00–20:00).`,
    managerCalled:
      '✅ Передал ваш запрос менеджеру — он свяжется с вами в ближайшее время.\n' +
      'Если срочно, позвоните: +998 (70) 120-33-33',
    help:
      '*Команды:*\n' +
      '/start — начать заново\n' +
      '/lang — сменить язык (RU/UZ)\n' +
      '/manager — связаться с живым менеджером\n' +
      '/reset — очистить историю диалога\n\n' +
      'Или просто напишите вопрос — я отвечу.'
  },

  uz: {
    langName: "O'zbekcha",
    welcome:
      "👋 Assalomu alaykum! Men — *Garmin Uzbekistan* AI-maslahatchisiman.\n\n" +
      "Soat tanlashda yordam beraman, modellarni solishtiraman, narx, kafolat va " +
      "yetkazib berish haqida ma'lumot beraman.\n\n" +
      "Sizni nima qiziqtirayotganini yozing.",
    welcomeProduct: (name, price) =>
      `👋 Assalomu alaykum! Siz *${name}* modelini ko'rdingiz — ${price}.\n\n` +
      "Men — Garmin Uzbekistan AI-maslahatchisiman. Bu model haqida so'zlab beraman, " +
      "boshqalari bilan solishtiraman yoki buyurtma rasmiylashtiramanmi?",
    chooseLang: 'Выберите язык / Tilni tanlang:',
    langSet: "✅ Til o'zbekchaga o'zgartirildi.",
    thinking: '⌛️ Bir soniya…',
    error:
      "⚠️ Kechirasiz, texnik xatolik yuz berdi. Qayta urinib ko'ring yoki " +
      'menejer bilan bog\'laning: +998 (70) 120-33-33',
    rateLimited: "⏳ Juda ko'p xabar yuborildi. Bir necha soniya kuting.",
    aiDown:
      "🙏 Kechirasiz, maslahatchi hozir mavjud emas. Savolingizni menejerga " +
      "yubordim — u tez orada siz bilan bog'lanadi.\n" +
      "Shoshilinchmi? Qo'ng'iroq qiling: +998 (70) 120-33-33",
    reset: '🔄 Suhbat tarixi tozalandi. Qaytadan boshlaymiz!',
    btnCatalog: '🛍 Katalog',
    btnShowrooms: '📍 Showroomlar',
    btnManager: '👤 Menejer',
    btnSharePhone: '📱 Raqam qoldirish',
    btnLang: '🌐 Til / Язык',
    phoneThanks: (phone) =>
      `✅ Rahmat! Raqamingiz saqlandi: ${phone}\nMenejer ish vaqtida (10:00–20:00) siz bilan bog'lanadi.`,
    managerCalled:
      "✅ So'rovingiz menejerga yuborildi — u tez orada bog'lanadi.\n" +
      "Shoshilinch bo'lsa qo'ng'iroq qiling: +998 (70) 120-33-33",
    help:
      '*Buyruqlar:*\n' +
      '/start — qaytadan boshlash\n' +
      "/lang — tilni o'zgartirish (RU/UZ)\n" +
      "/manager — jonli menejer bilan bog'lanish\n" +
      '/reset — suhbat tarixini tozalash\n\n' +
      "Yoki shunchaki savolingizni yozing — javob beraman."
  }
};

export function t(lang, key, ...args) {
  const table = STRINGS[lang] ?? STRINGS[DEFAULT_LANG];
  const value = table[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

export function normalizeLang(value) {
  if (!value) return null;
  const code = String(value).toLowerCase().slice(0, 2);
  return LANGS.includes(code) ? code : null;
}

/** Distinctive Uzbek Latin markers — apostrophe digraphs and high-frequency words. */
const UZ_MARKERS =
  /\b(salom|assalomu|rahmat|qancha|narxi|narx|soat|kerak|bormi|yaxshi|qanday|men|siz|uchun|olmoqchi|xarid|yetkazib|kafolat|arzon|qimmat|bo['’ʻ]?l|yo['’ʻ]?q|ha\b)/i;

/**
 * Guesses the language of a free-text message. Cyrillic is treated as Russian —
 * Uzbek Cyrillic exists but is vanishingly rare in Tashkent retail chat, and the
 * customer can always override with /lang.
 */
export function detectLang(text, telegramLangCode) {
  const s = String(text ?? '');
  if (/[\u0400-\u04FF]/.test(s)) return 'ru';
  if (UZ_MARKERS.test(s)) return 'uz';
  const fromTelegram = normalizeLang(telegramLangCode);
  if (fromTelegram) return fromTelegram;
  return null; // caller keeps the existing session language
}
