// Small shared helpers for the UI language: the active translation table,
// localized prices and the "N models" counter. Kept apart from data.js, which
// holds the catalog content itself.
import { TRANSLATIONS } from './data.js';

/** Translation table for `lang`, falling back to Russian key by key. */
export function tr(lang) {
  const base = TRANSLATIONS.ru;
  const table = TRANSLATIONS[lang];
  return table && table !== base ? { ...base, ...table } : base;
}

/** Prices are integers of UZS. Grouped the Russian way ("18 000 000") in every
 *  language — that is how prices are written locally — with a localized unit. */
export function formatPrice(price, lang) {
  return `${Number(price).toLocaleString('ru-RU')} ${tr(lang).currency}`;
}

/** "56 моделей" / "1 модель" / "3 модели" — Russian needs real plural forms. */
export function formatModelCount(count, lang) {
  const t = tr(lang);
  const rule = new Intl.PluralRules(lang === 'en' ? 'en' : 'ru').select(count);
  if (lang === 'uz') return `${count} ${t.modelsMany}`;
  const word = rule === 'one' ? t.modelsOne : rule === 'few' ? t.modelsFew : t.modelsMany;
  return `${count} ${word}`;
}

/** localStorage throws in some embedded WebViews and private modes; the page
 *  must still work, just without remembering the choice. */
export function readStoredLang() {
  try {
    return localStorage.getItem('garmin_lang');
  } catch {
    return null;
  }
}

export function storeLang(lang) {
  try {
    localStorage.setItem('garmin_lang', lang);
  } catch {
    /* not persisted — fine */
  }
}
