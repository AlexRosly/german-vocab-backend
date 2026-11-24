import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import { lessonKey, namesForWord, normalizedLessonNames, normalizedTags, organizationReady, titleKey, type LessonName } from "../words/organization-data";
export function parseOrganizationMaterials(tags:string,names:string){return{tags:normalizedTags(tags?JSON.parse(tags):[]),lessonNames:normalizedLessonNames(names?JSON.parse(names):[])}}
export async function importOrganization(tx:Prisma.TransactionClient,userId:string,wordId:string,tags:string[],names:LessonName[],privateBooks:string[],privateLessons:Record<string,number[]>,write:boolean){
 if(!tags.length&&!names.length)return[];
 if(!await organizationReady(tx))throw new ServiceUnavailableException("Организация словаря пока недоступна");
 const warnings=new Set<string>();
 if(tags.length){const current=await tx.personalWordTags.findUnique({where:{userId_wordId:{userId,wordId}}}),merged=new Map((current?.titles??[]).map(t=>[titleKey(t),t]));for(const tag of tags)if(!merged.has(titleKey(tag)))merged.set(titleKey(tag),tag);
  if(merged.size>20)warnings.add('personal_tags_limit');else if(write&&JSON.stringify([...merged.values()])!==JSON.stringify(current?.titles??[])){const data={titles:[...merged.values()],revision:randomUUID()};await tx.personalWordTags.upsert({where:{userId_wordId:{userId,wordId}},create:{userId,wordId,...data},update:data})}
 }
 if(names.length){
  const [word,bookRow,settings]=await Promise.all([tx.word.findUnique({where:{id:wordId},select:{sourceBook:true,lessonNumber:true,bookSources:{select:{sourceBook:true,lessonNumbers:true}}}}),tx.personalWordBooks.findUnique({where:{userId_wordId:{userId,wordId}}}),tx.personalDictionarySettings.findUnique({where:{userId}})]);
  const combined:Record<string,number[]>={...((bookRow?.lessons??{})as Record<string,number[]>)};for(const [title,numbers]of Object.entries(privateLessons))combined[title]=[...(combined[title]??[]),...numbers];
  const eligible=word?namesForWord({...word,personalBooks:[...(bookRow?.titles??[]),...privateBooks],personalBookLessons:combined},names):[];
  if(eligible.length!==names.length)warnings.add('personal_lesson_names_unmatched');
  const map=new Map(normalizedLessonNames(settings?.lessonNames??[]).map(n=>[lessonKey(n),n]));let changed=false;
  for(const n of eligible){const old=map.get(lessonKey(n));if(old&&old.name!==n.name)warnings.add('personal_lesson_names_conflict');else if(!old){map.set(lessonKey(n),n);changed=true}}
  if(map.size>500)warnings.add('personal_lesson_names_limit');else if(write&&changed){const data={lessonNames:JSON.parse(JSON.stringify([...map.values()])),revision:randomUUID()};await tx.personalDictionarySettings.upsert({where:{userId},create:{userId,...data},update:data})}
 }
 return [...warnings];
}
