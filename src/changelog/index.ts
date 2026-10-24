import en from "./en.md";
import de from "./de.md";
import es from "./es.md";
import et from "./et.md";
import fr from "./fr.md";
import ja from "./ja.md";
import ko from "./ko.md";
import lt from "./lt.md";
import lv from "./lv.md";
import pt from "./pt.md";
import ru from "./ru.md";
import uk from "./uk.md";
import zh from "./zh.md";

// One import per translated changelog, keyed like the locales in i18n.ts.
const CHANGELOGS: Record<string, string> = {
  en,
  de,
  es,
  et,
  fr,
  ja,
  ko,
  lt,
  lv,
  pt,
  ru,
  uk,
  zh,
};

/** The changelog in `lang`, or the English one while that translation is missing. */
export function changelogFor(lang: string): { text: string; isEnglish: boolean } {
  const text = CHANGELOGS[lang] ?? CHANGELOGS[lang.split("-")[0]];
  if (text === undefined || text === en) return { text: en, isEnglish: true };
  return { text, isEnglish: false };
}
