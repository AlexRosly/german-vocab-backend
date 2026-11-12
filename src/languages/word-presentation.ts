import { presentBookSources, type BookSourceWord } from "../words/book-sources";

type TranslationSource = BookSourceWord & { translations: readonly { language: string; text: string }[] };

export function presentWord<T extends TranslationSource>(word: T, language: string) {
  const selected = word.translations.find((translation) => translation.language === language);
  return { ...word, bookSources: presentBookSources(word), selectedTranslation: { language, text: selected?.text ?? null } };
}
