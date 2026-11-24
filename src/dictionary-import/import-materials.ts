import { parsePersonalExampleTranslations, type PersonalExampleInput } from "./personal-example-import";
import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { CreateWordDto } from "../words/dto/create-word.dto";
import { TRANSLATION_LANGUAGE_CODES } from "../languages/language-options";
import { normalizeText, type ImportRow } from "./dictionary-csv-reader";
export type Lessons = Record<string, number[]>;
export type SavedImportRow = Omit<ImportRow, "values" | "errors"> & { card: CreateWordDto; sources: { sourceBook: string; lessonNumbers: number[] }[]; personal: { exampleTranslations?: PersonalExampleInput[]; note: string; translations: {language:string;text:string}[]; books: string[]; lessons: Lessons; favorite: boolean|null; archived: boolean|null; difficult?: boolean|null } };
const entries = (v: Record<string,string>, prefix: string) => TRANSLATION_LANGUAGE_CODES.filter(l=>v[prefix+l]).map(language=>({language,text:v[prefix+language].normalize("NFC").trim()}));
export function lessonMap(value: unknown): Lessons {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new BadRequestException("dictionary_import_private_books_invalid");
  const result: Lessons=Object.create(null);
  for (const [title, numbers] of Object.entries(value)) {
    const name=normalizeText(title);
    if (name==="__proto__" || !name || name.length>120 || /\p{Cc}/u.test(name) || !Array.isArray(numbers) || numbers.length>10000 || numbers.some(n=>!Number.isInteger(n)||n<1||n>10000) || Object.keys(result).length>=20) throw new BadRequestException("dictionary_import_private_books_invalid");
    result[name]=[...new Set(numbers as number[])].sort((a,b)=>a-b);
  }
  return result;
}
export function privateBooks(titles: string[], lessons: Lessons) {
  const books=new Map<string,string>();const result:Lessons=Object.create(null);
  for(const raw of [...titles,...Object.keys(lessons)]) {const title=normalizeText(raw),key=title.toLocaleLowerCase("de");if(!books.has(key))books.set(key,title);}
  if(books.has("__proto__")||books.size>20)throw new BadRequestException("dictionary_import_private_books_invalid");
  for(const [title,numbers]of Object.entries(lessons)){const name=books.get(normalizeText(title).toLocaleLowerCase("de"))!;result[name]=[...new Set([...(result[name]??[]),...numbers])].sort((a,b)=>a-b);}
  return {titles:[...books.values()],lessons:result};
}
export function savedRow(row: ImportRow): SavedImportRow {
  if(row.errors.length)throw new BadRequestException("dictionary_import_invalid_row");
  const v=row.values, extras=JSON.parse(v.extra_examples_json||"[]") as {german:string;translations:{language:string;text:string}[]}[];
  const forms=JSON.parse(v.extra_verb_forms_json||"[]");
  if(row.type==="verb"&&(v.praeteritum||v.participle_ii||v.auxiliary)) forms.unshift({praeteritum:v.praeteritum,participle2:v.participle_ii,auxiliary:v.auxiliary.toUpperCase(),reflexive:v.reflexive==="true",usage:v.verb_usage||null});
  const examples=[...(v.example_german?[{german:v.example_german,translations:entries(v,"example_translation_")}]:[]),...extras.map(e=>({german:e.german,translations:e.translations}))];
  const sources=JSON.parse(v.source_books_json||"[]") as {sourceBook:string;lessonNumbers:number[]}[];
  if(v.source_book)sources.push({sourceBook:normalizeText(v.source_book),lessonNumbers:v.lesson_number?[Number(v.lesson_number)]:[]});
  const sourceMap=new Map<string,Set<number>>();for(const s of sources){const title=normalizeText(s.sourceBook);sourceMap.set(title,new Set([...(sourceMap.get(title)??[]),...s.lessonNumbers]));}
  const personalLessons=lessonMap(JSON.parse(v.personal_book_lessons_json||"{}"));
  const personalTitles=JSON.parse(v.personal_books_json||"[]") as string[];
  // In a full export the source columns describe shared provenance, not private preferences.
  if(!v.format_version&&v.source_book){const title=normalizeText(v.source_book);personalTitles.push(title);personalLessons[title]=[...(personalLessons[title]??[]),...(v.lesson_number?[Number(v.lesson_number)]:[])];}
  if(!v.format_version&&v.lesson_number&&!v.source_book)throw new BadRequestException("dictionary_import_lesson_needs_book");
  const books=privateBooks(personalTitles,personalLessons);
  const {values:_values,errors:_errors,...identity}=row;
  return {...identity,card:plainToInstance(CreateWordDto,{german:row.german,article:row.article,grammaticalNumber:row.number,translations:entries(v,"translation_"),pluralForm:v.plural_form||null,level:v.level||null,sourceBook:v.source_book||null,lessonNumber:v.lesson_number?Number(v.lesson_number):null,notes:v.shared_note||null,examples,...(row.type==="verb"?{isVerb:true,verbForms:forms}:{})}),
    sources:[...sourceMap].map(([sourceBook,numbers])=>({sourceBook,lessonNumbers:[...numbers].sort((a,b)=>a-b)})),personal:{exampleTranslations:parsePersonalExampleTranslations(v.personal_example_translations_json),note:v.personal_note?.normalize("NFC").trim()||"",translations:entries(v,"personal_translation_"),books:books.titles,lessons:books.lessons,favorite:v.is_favorite?v.is_favorite==="true":null,archived:v.is_archived?v.is_archived==="true":null,difficult:v.is_difficult?v.is_difficult==="true":null}};
}
