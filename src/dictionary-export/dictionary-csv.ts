import { PayloadTooLargeException } from "@nestjs/common";
import { TRANSLATION_LANGUAGE_CODES } from "../languages/language-options";
export const CSV_VERSION = 1;
export const MAX_EXPORT_WORDS = 10_000;
export const MAX_EXPORT_BYTES = 25 * 1024 * 1024;
const languages = TRANSLATION_LANGUAGE_CODES;
export const EXPORT_COLUMNS = ["format_version", "word_id", "german", "word_type", "article", "grammatical_number", "plural_form", "level", "source_book", "lesson_number",
  "praeteritum", "participle_ii", "auxiliary", "reflexive", "verb_usage", ...languages.map(l => "translation_" + l),
  "example_id", "example_german", ...languages.map(l => "example_translation_" + l), "shared_note", "personal_note", "is_favorite", "is_archived", "is_difficult",
  ...languages.map(l => "personal_translation_" + l), "source_books_json", "personal_books_json", "extra_examples_json", "extra_verb_forms_json", "personal_book_lessons_json", "personal_example_translations_json", "personal_tags_json", "personal_lesson_names_json"];
export const TEMPLATE_COLUMNS = ["german", "word_type", "article", "grammatical_number", "plural_form", "level", "source_book", "lesson_number",
  "translation_ru", "translation_en", "translation_uk", "example_german", "example_translation_ru", "example_translation_en", "example_translation_uk",
  "praeteritum", "participle_ii", "auxiliary", "reflexive", "personal_note"];
type Translation = { language: string; text: string };
export type CsvWord = {
  id: string; german: string; article: string; grammaticalNumber: string; pluralForm: string | null; level: string | null;
  sourceBook: string | null; lessonNumber: number | null; notes: string | null; translation: string;
  translations: Translation[]; verbForms: { praeteritum: string; participle2: string; auxiliary: string; reflexive: boolean; usage: string | null }[];
  examples: { id: string; german: string; translation: string; translations: Translation[]; personalTranslations?: (Translation & {sourceGerman:string})[] }[];
  bookSources: { sourceBook: string; lessonNumbers: number[] }[];
  userWords: { isFavorite: boolean; isArchived: boolean; isDifficult?: boolean }[];
  personalTags?: {titles:string[]}[]; personalLessonNames?: {book:string;lessonNumber:number;name:string}[];
  personalNotes: { text: string }[]; personalTranslations: Translation[]; personalBooks: { titles: string[]; lessons?: unknown }[];
};
export type CsvRow = Record<string, string | number | boolean | null | undefined>;

// TAB is a reversible spreadsheet escape, not part of a word/note. See version-1 CSV contract.
export function csvCell(value: CsvRow[string]): string {
  const text = value == null ? "" : String(value);
  const safe = /^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠']/u.test(text) || /^[\t\r\n]/.test(text) ? "\t" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function csvLine(columns: string[], row: CsvRow): string { return columns.map(c => csvCell(row[c])).join(";") + "\r\n"; }
export function csvHeader(columns: string[]): string { return "\uFEFF" + columns.map(csvCell).join(";") + "\r\n"; }
export function tooLarge(): never { throw new PayloadTooLargeException("Словарь слишком большой для одного CSV-файла"); }

function translations(entries: Translation[], legacy = ""): Record<string, string> {
  const result = Object.fromEntries(entries.map(t => [t.language, t.text]));
  if (!Object.hasOwn(result, "ru") && legacy) result.ru = legacy;
  return result;
}
export function wordRow(word: CsvWord): CsvRow {
  const form = word.verbForms[0], example = word.examples[0], entry = word.userWords[0];
  const shared = translations(word.translations, word.translation), personal = translations(word.personalTranslations), exampleTexts = translations(example?.translations ?? [], example?.translation);
  const row: CsvRow = { format_version: CSV_VERSION, word_id: word.id, german: word.german,
    word_type: word.verbForms.length ? "verb" : word.article !== "none" ? "noun" : "other", article: word.article, grammatical_number: word.grammaticalNumber,
    plural_form: word.pluralForm, level: word.level, source_book: word.sourceBook, lesson_number: word.lessonNumber,
    praeteritum: form?.praeteritum, participle_ii: form?.participle2, auxiliary: form?.auxiliary.toLowerCase(), reflexive: form?.reflexive,
    verb_usage: form?.usage, example_id: example?.id, example_german: example?.german, shared_note: word.notes,
    personal_note: word.personalNotes[0]?.text, is_favorite: entry.isFavorite, is_archived: entry.isArchived, is_difficult: entry.isDifficult ?? false,
    source_books_json: JSON.stringify(word.bookSources), personal_books_json: JSON.stringify(word.personalBooks[0]?.titles ?? []), personal_book_lessons_json: JSON.stringify(word.personalBooks[0]?.lessons ?? {}),
    extra_examples_json: JSON.stringify(word.examples.slice(1).map(e => ({ id: e.id, german: e.german, translations: Object.entries(translations(e.translations, e.translation)).map(([language, text]) => ({ language, text })) }))),
    personal_tags_json:JSON.stringify(word.personalTags?.[0]?.titles??[]), personal_lesson_names_json:JSON.stringify(word.personalLessonNames??[]),
    personal_example_translations_json: JSON.stringify(word.examples.flatMap(e => (e.personalTranslations ?? []).map(p => ({ exampleId:e.id, german:p.sourceGerman, language:p.language, text:p.text })))),
    extra_verb_forms_json: JSON.stringify(word.verbForms.slice(1).map(f => ({ praeteritum: f.praeteritum, participle2: f.participle2, auxiliary: f.auxiliary, reflexive: f.reflexive, usage: f.usage }))),
  };
  for (const language of languages) { row["translation_" + language] = shared[language]; row["personal_translation_" + language] = personal[language]; row["example_translation_" + language] = exampleTexts[language]; }
  return row;
}
export function templateCsv(example = false): { csv: string; wordCount: number } {
  const rows: CsvRow[] = example ? [
    { german: "Haus", word_type: "noun", article: "das", grammatical_number: "singular", plural_form: "Häuser", level: "A1", source_book: "A1 Treffpunkt", lesson_number: 1, translation_ru: "дом", translation_en: "house", translation_uk: "будинок", example_german: "Das Haus ist groß.", example_translation_ru: "Дом большой.", example_translation_en: "The house is big.", example_translation_uk: "Будинок великий." },
    { german: "gehen", word_type: "verb", article: "none", grammatical_number: "not_applicable", level: "A1", praeteritum: "ging", participle_ii: "gegangen", auxiliary: "sein", reflexive: false, translation_ru: "идти", translation_en: "go", translation_uk: "йти", example_german: "Ich gehe nach Hause.", example_translation_ru: "Я иду домой." },
    { german: "Guten Tag", word_type: "other", article: "none", grammatical_number: "not_applicable", level: "A1", translation_ru: "добрый день", translation_en: "good afternoon", translation_uk: "добрий день" },
  ] : [];
  return { csv: csvHeader(TEMPLATE_COLUMNS) + rows.map(r => csvLine(TEMPLATE_COLUMNS, r)).join(""), wordCount: rows.length };
}
