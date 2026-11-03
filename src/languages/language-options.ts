import { BadRequestException } from "@nestjs/common";

export const INTERFACE_LANGUAGES = [
  { code: "ru", label: "Русский" },
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "uk", label: "Українська" },
];
// Content languages can expand without translating the application interface.
export const TRANSLATION_LANGUAGES = [
  { code: "ru", label: "Русский" }, { code: "de", label: "Deutsch" },
  { code: "en", label: "English" }, { code: "uk", label: "Українська" },
  { code: "pl", label: "Polski" }, { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" }, { code: "fr", label: "Français" },
  { code: "es", label: "Español" }, { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
];
export const INTERFACE_LANGUAGE_CODES = INTERFACE_LANGUAGES.map((language) => language.code);
export const TRANSLATION_LANGUAGE_CODES = TRANSLATION_LANGUAGES.map((language) => language.code);

export function normalizeLanguage(value: unknown): unknown {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

export function translationLanguage(value: unknown): string {
  const language = normalizeLanguage(value);
  if (typeof language !== "string" || !TRANSLATION_LANGUAGE_CODES.includes(language)) {
    throw new BadRequestException("Неподдерживаемый язык перевода");
  }
  return language;
}
