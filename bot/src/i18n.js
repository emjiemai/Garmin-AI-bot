/** Russian and Uzbek UI strings plus language detection.
 *  The AI replies are generated in the customer's language; these strings cover
 *  the fixed chrome (buttons, errors, system notices). */

export const LANGS = ['ru', 'uz'];
export const DEFAULT_LANG = 'ru';

const STRINGS = {
  ru: {
    langName: 'Русский',
    welcome:
      '👋 Здравствуйте! Это поддержка *Garmin Uzbekistan*.\n\n' +
      'Помогу подобрать часы, сравнить модели, расскажу про цены, гарантию и доставку.\n\n' +
      'Просто напишите, что вас интересует.',
    welcomeProduct: (name, price) =>
      `👋 Здравствуйте! Вы смотрели *${name}* — ${price}.\n\n` +
      'Это поддержка Garmin Uzbekistan. Расскажу про эту модель, сравню с другими ' +
      'или оформлю заказ. Что интересует?',
    chooseLang: 'Выберите язык / Tilni tanlang:',
    langSet: '✅ Язык переключён на русский.',
    thinking: '⌛️ Секунду…',
    error: (phone) =>
      '⚠️ Извините, произошла техническая ошибка. Попробуйте ещё раз или ' +
      `свяжитесь с менеджером: ${phone}`,
    rateLimited: '⏳ Слишком много сообщений подряд. Подождите пару секунд.',
    aiDown: (phone) =>
      '🙏 Извините, консультант сейчас недоступен. Я уже передал ваш вопрос ' +
      'менеджеру — он свяжется с вами в ближайшее время.\n' +
      `Срочно? Позвоните: ${phone}`,
    reset: '🔄 История диалога очищена. Начнём заново!',
    btnCatalog: '🛍 Каталог',
    btnShowrooms: '📍 Шоурумы',
    btnContact: '💬 Написать нам',
    btnSharePhone: '📱 Оставить номер',
    btnSkipPhone: 'Позже',
    btnLang: '🌐 Til / Язык',
    // Telegram has no button type for a phone dialer (a "tel:" URL is rejected
    // outright as an inline button target) — the number goes in the message
    // text instead, which Telegram auto-links as tappable-to-call on mobile.
    contactPrompt: (phone) =>
      `Слушаю! Напишите, что вас интересует — цена, наличие, сравнение моделей.\n\n📞 Или позвоните: ${phone}`,
    phoneSkipped: 'Хорошо. Менеджер напишет вам прямо в этот чат.',
    phoneThanks: (phone) =>
      `✅ Спасибо! Записал ваш номер: ${phone}\nМенеджер свяжется с вами в рабочее время (10:00–20:00).`,
    askFulfillment:
      'Спасибо, номер записал! Последний вопрос: заберёте в одном из наших шоурумов или нужна доставка?',
    orderSent: (phone) =>
      `✅ Спасибо! Заказ передан менеджеру — он свяжется с вами по номеру ${phone} в ближайшие минуты.`,
    managerCalled: (phone) =>
      '✅ Передал ваш запрос менеджеру — он свяжется с вами в ближайшее время.\n' +
      `Если срочно, позвоните: ${phone}`,
    btnTelegramUs: '✉️ Telegram',
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
      "👋 Assalomu alaykum! Bu *Garmin Uzbekistan* qo'llab-quvvatlash xizmati.\n\n" +
      "Soat tanlashda yordam beraman, modellarni solishtiraman, narx, kafolat va " +
      "yetkazib berish haqida ma'lumot beraman.\n\n" +
      "Sizni nima qiziqtirayotganini yozing.",
    welcomeProduct: (name, price) =>
      `👋 Assalomu alaykum! Siz *${name}* modelini ko'rdingiz — ${price}.\n\n` +
      "Bu Garmin Uzbekistan qo'llab-quvvatlash xizmati. Bu model haqida so'zlab beraman, " +
      "boshqalari bilan solishtiraman yoki buyurtma rasmiylashtiramanmi?",
    chooseLang: 'Выберите язык / Tilni tanlang:',
    langSet: "✅ Til o'zbekchaga o'zgartirildi.",
    thinking: '⌛️ Bir soniya…',
    error: (phone) =>
      "⚠️ Kechirasiz, texnik xatolik yuz berdi. Qayta urinib ko'ring yoki " +
      `menejer bilan bog'laning: ${phone}`,
    rateLimited: "⏳ Juda ko'p xabar yuborildi. Bir necha soniya kuting.",
    aiDown: (phone) =>
      "🙏 Kechirasiz, maslahatchi hozir mavjud emas. Savolingizni menejerga " +
      "yubordim — u tez orada siz bilan bog'lanadi.\n" +
      `Shoshilinchmi? Qo'ng'iroq qiling: ${phone}`,
    reset: '🔄 Suhbat tarixi tozalandi. Qaytadan boshlaymiz!',
    btnCatalog: '🛍 Katalog',
    btnShowrooms: '📍 Showroomlar',
    btnContact: '💬 Bizga yozing',
    btnSharePhone: '📱 Raqam qoldirish',
    btnSkipPhone: 'Keyinroq',
    btnLang: '🌐 Til / Язык',
    contactPrompt: (phone) =>
      `Tinglayapman! Sizni nima qiziqtirayotganini yozing — narx, mavjudligi, modellarni solishtirish.\n\n📞 Yoki qo'ng'iroq qiling: ${phone}`,
    phoneSkipped: "Yaxshi. Menejer shu chatga yozadi.",
    phoneThanks: (phone) =>
      `✅ Rahmat! Raqamingiz saqlandi: ${phone}\nMenejer ish vaqtida (10:00–20:00) siz bilan bog'lanadi.`,
    askFulfillment:
      "Rahmat, raqamingiz saqlandi! Oxirgi savol: showroomimizdan olib ketasizmi yoki yetkazib berish kerakmi?",
    orderSent: (phone) =>
      `✅ Rahmat! Buyurtma menejerga yuborildi — u yaqin daqiqalarda ${phone} raqamiga bog'lanadi.`,
    managerCalled: (phone) =>
      "✅ So'rovingiz menejerga yuborildi — u tez orada bog'lanadi.\n" +
      `Shoshilinch bo'lsa qo'ng'iroq qiling: ${phone}`,
    btnTelegramUs: '✉️ Telegram',
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
