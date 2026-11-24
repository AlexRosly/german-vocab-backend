import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { presentBookSources, type BookSourceWord } from "./book-sources";
export type LessonName = { book: string; lessonNumber: number; name: string };
export const normalizeTitle = (s: string) => s.normalize("NFC").trim().replace(/\s+/gu, " ");
export const titleKey = (s: string) => normalizeTitle(s).toLocaleLowerCase("de");
export const lessonKey = (n: LessonName) => JSON.stringify([titleKey(n.book),n.lessonNumber]);
export async function organizationReady(db: Pick<Prisma.TransactionClient,"$queryRaw">) {
  const rows = await db.$queryRaw<{organizationReady:boolean}[]>`SELECT to_regclass('public.personal_word_tags') IS NOT NULL AND to_regclass('public.personal_dictionary_settings') IS NOT NULL AS "organizationReady"`;
  return rows[0]?.organizationReady === true;
}
export function normalizedTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length>20 || value.some(t=>typeof t!=="string")) throw new BadRequestException("Проверьте теги: до 20 названий по 40 символов");
  const result=value.map(normalizeTitle);
  if(result.some(t=>!t || [...t].length>40 || /\p{Cc}/u.test(t)) || new Set(result.map(titleKey)).size!==result.length) throw new BadRequestException("Проверьте теги: до 20 названий по 40 символов");
  return result;
}
export function normalizedLessonNames(value: unknown, allowEmpty=false): LessonName[] {
  if(!Array.isArray(value)||value.length>(allowEmpty?100:500))throw new BadRequestException("Проверьте названия уроков");
  const result=value.map((row:unknown)=>{
    if(!row||typeof row!=="object"||Array.isArray(row)||Object.keys(row).some(k=>!["book","lessonNumber","name"].includes(k)))throw new BadRequestException("Проверьте названия уроков");
    const r=row as LessonName;
    if(typeof r.book!=="string"||typeof r.name!=="string")throw new BadRequestException("Проверьте названия уроков");
    const book=normalizeTitle(r.book),name=normalizeTitle(r.name);
    if(!book||book==="__proto__"||[...book].length>120||(!allowEmpty&&!name)||[...name].length>120||/\p{Cc}/u.test(book+name)||!Number.isInteger(r.lessonNumber)||r.lessonNumber<1||r.lessonNumber>10000)throw new BadRequestException("Проверьте названия уроков");
    return {book,lessonNumber:r.lessonNumber,name};
  });
  if(new Set(result.map(lessonKey)).size!==result.length)throw new BadRequestException("Названия уроков не должны повторяться");
  return result;
}
export function namesForWord(word: BookSourceWord & {personalBooks?:readonly string[];personalBookLessons?:unknown}, names: readonly LessonName[]): LessonName[] {
  const keys=new Set(presentBookSources(word).flatMap(s=>s.lessonNumbers.map(n=>JSON.stringify([titleKey(s.sourceBook),n]))));
  const lessons=word.personalBookLessons as Record<string,number[]>|undefined;
  for(const title of word.personalBooks??[])for(const [old,numbers]of Object.entries(lessons??{}))if(titleKey(old)===titleKey(title))for(const n of numbers)keys.add(JSON.stringify([titleKey(title),n]));
  return names.filter(n=>keys.has(lessonKey(n)));
}
