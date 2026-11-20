import { lessonMap } from "./import-materials";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { parse } from "csv-parse/sync";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { EXPORT_COLUMNS, MAX_EXPORT_BYTES, MAX_EXPORT_WORDS } from "../dictionary-export/dictionary-csv";
import { TRANSLATION_LANGUAGE_CODES } from "../languages/language-options";
import { CreateWordDto } from "../words/dto/create-word.dto";
import { verbData } from "../words/verb-data";

export const MAX_IMPORT_BYTES = MAX_EXPORT_BYTES;
export const MAX_IMPORT_ROWS = MAX_EXPORT_WORDS;
type Translation = { language: string; text: string };
export type ImportRow = { row: number; german: string; wordId: string; type: string; article: string; number: string;
  translations: Translation[]; errors: string[]; values: Record<string, string>; exampleCount: number; verbFormCount: number };
export const normalizeText = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");
export function germanVariants(row: Pick<ImportRow,"german"|"article"|"type">):string[]{const text=normalizeText(row.german),prefix=/^(der|die|das) (.+)$/iu.exec(text);const bare=row.type==="noun"&&prefix?.[1].toLowerCase()===row.article?prefix![2]:text;return row.type==="noun"?[bare,row.article+" "+bare]:[bare];}
export const lexemeKey = (row: Pick<ImportRow, "german" | "article" | "number" | "type">) => JSON.stringify([germanVariants(row)[0].toLocaleLowerCase("de"), row.article, row.number, row.type]);
export function meaningsOverlap(a: Translation[], b: Translation[]) {
  return a.some(x => b.some(y => x.language === y.language && normalizeText(x.text).toLocaleLowerCase() === normalizeText(y.text).toLocaleLowerCase()));
}
const invalid = () => new BadRequestException("dictionary_import_invalid_csv");
const allowedKeys = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));
function array(value: string, limit: number): unknown[] { const result: unknown = value ? JSON.parse(value) : []; if (!Array.isArray(result) || result.length > limit) throw Error(); return result; }
function boolean(value: string): boolean | undefined { if (!value) return undefined; if (value !== "true" && value !== "false") throw Error(); return value === "true"; }
function texts(values: Record<string, string>, prefix: string): Translation[] { return TRANSLATION_LANGUAGE_CODES.filter(l => values[prefix + l]).map(language => ({ language, text: values[prefix + language] })); }

export function parseDictionaryCsv(buffer: Buffer): ImportRow[] {
  if (buffer.length > MAX_IMPORT_BYTES) throw new PayloadTooLargeException("dictionary_import_too_large");
  let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { throw invalid(); }
  if (text.includes("\0")) throw invalid();
  let records: Record<string, string>[]; let count = 0;
  try {
    records = parse(text, { bom: true, delimiter: ";", skip_empty_lines: true, max_record_size: 256 * 1024,
      columns: (headers: string[]) => { if (headers.length > EXPORT_COLUMNS.length || new Set(headers).size !== headers.length || !["german", "word_type", "article", "grammatical_number"].every(h => headers.includes(h)) || headers.some(h => !EXPORT_COLUMNS.includes(h))) throw invalid(); return headers; },
      on_record: (record: Record<string, string>) => { if (++count > MAX_IMPORT_ROWS) throw new PayloadTooLargeException("dictionary_import_too_many_rows"); return record; },
    });
  } catch (error) { if (error instanceof PayloadTooLargeException) throw error; throw invalid(); }
  if (!records.length) throw new BadRequestException("dictionary_import_empty");
  return records.map((original, index): ImportRow => {
    const errors: string[] = [], values: Record<string, string> = { ...original };
    if (values.format_version && values.format_version !== "1") errors.push("format_version");
    // Only marked v1 exports use the reversible TAB escape. Plain templates keep literal text.
    if (values.format_version === "1") for (const key of Object.keys(values)) if (values[key].startsWith("\t")) values[key] = values[key].slice(1);
    const type = values.word_type, article = values.article, number = values.grammatical_number;
    let german = normalizeText(values.german);
    const prefix = /^(der|die|das)\s+(.+)$/iu.exec(german);
    if (prefix && type === "noun") { if (prefix[1].toLowerCase() !== article) errors.push("article_conflict"); else german = prefix[2]; }
    const translations = texts(values, "translation_"); let exampleCount = 0, verbFormCount = 0;
    if (Object.values(values).some(v => v.length > 64 * 1024)) errors.push("cell_too_long");
    if (!/^[^\p{Cc}]+$/u.test(german)) errors.push("german");
    if (values.word_id && !/^[A-Za-z0-9._-]{1,191}$/.test(values.word_id)) errors.push("word_id");
    if (!["noun", "verb", "other"].includes(type) || (type === "noun" ? article === "none" || number === "not_applicable" : article !== "none" || number !== "not_applicable")) errors.push("word_type");
    try {
      const extras = array(values.extra_examples_json, 19).map(e => {
        if (!allowedKeys(e, ["id", "german", "translations"]) || (e.id !== undefined && (typeof e.id !== "string" || !/^[A-Za-z0-9._-]{1,191}$/.test(e.id)))) throw Error();
        return { german: e.german, translations: e.translations };
      });
      const exampleTranslations = texts(values, "example_translation_");
      if (!values.example_german && (exampleTranslations.length || values.example_id)) errors.push("example_german");
      const examples = [...(values.example_german ? [{ german: values.example_german, translations: exampleTranslations }] : []), ...extras];
      exampleCount = examples.length;
      const forms = array(values.extra_verb_forms_json, 3);
      if (values.praeteritum || values.participle_ii || values.auxiliary || values.reflexive || values.verb_usage) forms.unshift({ praeteritum: values.praeteritum, participle2: values.participle_ii, auxiliary: values.auxiliary?.toUpperCase(), reflexive: boolean(values.reflexive), usage: values.verb_usage || null });
      if (type !== "verb" && forms.length) errors.push("verb_forms");
      if (type === "verb" && !forms.length) errors.push("verb_forms_required");
      const dto = plainToInstance(CreateWordDto, { german, article, grammaticalNumber: number, translations, pluralForm: values.plural_form || null, level: values.level || null,
        sourceBook: values.source_book || null, lessonNumber: values.lesson_number ? (/^\d+$/.test(values.lesson_number) ? Number(values.lesson_number) : -1) : null,
        notes: values.shared_note || null, examples, ...(type === "verb" ? { isVerb: true, verbForms: forms } : {}),
      });
      for (const error of validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })) errors.push(error.property);
      if (!errors.length) verbData(dto, dto, [], true);
      verbFormCount = forms.length;
      const personal = texts(values, "personal_translation_");
      if (personal.some(t => t.text.trim().length < 1 || t.text.length > 1000) || (values.personal_note?.length ?? 0) > 2000) errors.push("personal_materials");
      boolean(values.is_archived); boolean(values.is_favorite); boolean(values.is_difficult);
      if(values.personal_book_lessons_json) lessonMap(JSON.parse(values.personal_book_lessons_json));
      const books = array(values.personal_books_json, 20);
      if (books.some(b => typeof b !== "string" || !b.trim() || b.length > 120 || /\p{Cc}/u.test(b))) errors.push("personal_books_json");
      const sources = array(values.source_books_json, 50);
      if (sources.some(b => !allowedKeys(b, ["sourceBook", "lessonNumbers"]) || typeof b.sourceBook !== "string" || !b.sourceBook.trim() || b.sourceBook.length > 120 || /\p{Cc}/u.test(b.sourceBook) || !Array.isArray(b.lessonNumbers) || b.lessonNumbers.length > 10000 || b.lessonNumbers.some(n => !Number.isInteger(n) || Number(n) < 1 || Number(n) > 10000))) errors.push("source_books_json");
    } catch { errors.push("invalid_materials"); }
    return { row: index + 1, german: german.slice(0, 200), wordId: values.word_id || "", type, article, number, translations, errors: [...new Set(errors)], values, exampleCount, verbFormCount };
  });
}
