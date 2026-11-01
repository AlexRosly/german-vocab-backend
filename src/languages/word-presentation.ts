type TranslationSource = { translations: readonly { language: string; text: string }[] };

export function presentWord<T extends TranslationSource>(word: T, language: string) {
  const selected = word.translations.find((translation) => translation.language === language);
  return { ...word, selectedTranslation: { language, text: selected?.text ?? null } };
}
