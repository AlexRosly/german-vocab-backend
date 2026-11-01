import { BadRequestException } from "@nestjs/common";
import { translationLanguage } from "../languages/language-options";

type Entry = { language: string; text: string };
type Patch = { translation?: string; translations?: { language: string; text: string | null }[] };

// A patch affects only explicitly supplied languages; unrelated translations survive.
export function translationEntries(dto: Patch, current: readonly Entry[] = [], legacy = ""): Entry[] {
  const values = new Map(current.map((entry) => [entry.language, entry.text]));
  if (legacy && !values.has("ru")) values.set("ru", legacy);
  if (dto.translation !== undefined) values.set("ru", dto.translation.normalize("NFC").trim());
  const seen = new Set<string>();
  for (const entry of dto.translations ?? []) {
    const language = translationLanguage(entry.language);
    if (seen.has(language) || (language === "ru" && dto.translation !== undefined)) throw new BadRequestException("Укажите перевод языка только один раз");
    seen.add(language);
    if (entry.text === null) { values.delete(language); continue; }
    if (typeof entry.text !== "string" || !entry.text.trim() || [...entry.text.trim()].length > 1000) throw new BadRequestException("Некорректный текст перевода");
    values.set(language, entry.text.normalize("NFC").trim());
  }
  return [...values].filter(([, text]) => !!text).map(([language, text]) => ({ language, text }));
}

// Only compare meanings when a shared translation matches. Missing translations are not a meaning.
export function meaningWhere(entries: readonly Entry[], legacy: string) {
  const meanings = legacy && !entries.some((entry) => entry.language === "ru" && entry.text === legacy) ? [...entries, { language: "ru", text: legacy }] : entries;
  return meanings.length ? { OR: meanings.flatMap(({ language, text }) => [
    { translations: { some: { language, text } } }, ...(language === "ru" ? [{ translation: text }] : []),
  ]) } : { translation: "", translations: { none: {} } };
}
