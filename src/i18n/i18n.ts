import i18next from "i18next";
import { getLanguage } from "obsidian";
import en from "./locales/en.json";
import de from "./locales/de.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import zh from "./locales/zh.json";
import ko from "./locales/ko.json";
import ru from "./locales/ru.json";
import pt from "./locales/pt.json";
import uk from "./locales/uk.json";
import lv from "./locales/lv.json";
import et from "./locales/et.json";
import lt from "./locales/lt.json";

void i18next.init({
  lng: getLanguage() ?? "en",
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    ja: { translation: ja },
    zh: { translation: zh },
    ko: { translation: ko },
    ru: { translation: ru },
    pt: { translation: pt },
    uk: { translation: uk },
    lv: { translation: lv },
    et: { translation: et },
    lt: { translation: lt },
  },
  interpolation: { escapeValue: false },
});

export const t = i18next.t.bind(i18next) as (key: string, options?: Record<string, unknown>) => string;
export { i18next };
