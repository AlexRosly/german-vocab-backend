import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { WordAccessService, dictionaryWords } from "./word-access.service";
import { SaveWordOrganizationDto, SaveOrganizationColorDto } from "./dto/word-organization.dto";
import { lessonKey, normalizedLessonNames, normalizedTags, normalizeTitle, organizationReady, titleKey } from "./organization-data";
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class WordOrganizationService {
  constructor(private readonly access:WordAccessService){}
  private async ready(tx:Prisma.TransactionClient){if(!await organizationReady(tx))throw new ServiceUnavailableException("Организация словаря пока недоступна");}
  private async own(tx:Prisma.TransactionClient,userId:string,wordId:string){
    const word=await tx.word.findFirst({where:{AND:[{id:wordId},dictionaryWords(userId),{userWords:{some:{userId}}}]},select:{id:true}});
    if(!word)throw new NotFoundException("Слово недоступно в вашем словаре");await this.ready(tx);
  }
  private async view(tx:Prisma.TransactionClient,userId:string,wordId:string){
    const [books,tags,settings]=await Promise.all([tx.personalWordBooks.findUnique({where:{userId_wordId:{userId,wordId}}}),tx.personalWordTags.findUnique({where:{userId_wordId:{userId,wordId}}}),tx.personalDictionarySettings.findUnique({where:{userId}})]);
    return {wordId,books:(books?.titles??[]).map(title=>({title,lessonNumbers:[...new Set(Object.entries((books?.lessons??{})as Record<string,number[]>).filter(([old])=>titleKey(old)===titleKey(title)).flatMap(([,numbers])=>numbers))].sort((a,b)=>a-b)})),tags:tags?.titles??[],bookRevision:books?.revision??null,tagsRevision:tags?.revision??null,lessonNames:normalizedLessonNames(settings?.lessonNames??[]),settingsRevision:settings?.revision??null};
  }
  get(userId:string,wordId:string){return this.access.transaction(async tx=>{await this.own(tx,userId,wordId);return this.view(tx,userId,wordId)})}
  settings(userId:string){return this.access.transaction(async tx=>{await this.ready(tx);const row=await tx.personalDictionarySettings.findUnique({where:{userId}});return {neutralColor:row?.neutralColor??null,revision:row?.revision??null}})}
  color(userId:string,dto:SaveOrganizationColorDto){return this.access.transaction(async tx=>{
    await this.ready(tx);const row=await tx.personalDictionarySettings.findUnique({where:{userId}});if((row?.revision??null)!==dto.revision)throw this.conflict();
    const neutralColor=dto.neutralColor?.toLowerCase()??null,revision=randomUUID();
    if(!row)await tx.personalDictionarySettings.create({data:{userId,neutralColor,revision}});
    else if((await tx.personalDictionarySettings.updateMany({where:{userId,revision:dto.revision!},data:{neutralColor,revision}})).count!==1)throw this.conflict();
    return {neutralColor,revision};
  })}
  save(userId:string,wordId:string,dto:SaveWordOrganizationDto){return this.access.transaction(async tx=>{
    await this.own(tx,userId,wordId);const current=await this.view(tx,userId,wordId);
    if(current.bookRevision!==dto.bookRevision||current.tagsRevision!==dto.tagsRevision)throw this.conflict();
    const tags=normalizedTags(dto.tags),books=dto.books.map(b=>({title:normalizeTitle(b.title),lessonNumbers:[...b.lessonNumbers].sort((a,b)=>a-b)}));
    if(books.some(b=>b.title==="__proto__")||new Set(books.map(b=>titleKey(b.title))).size!==books.length)throw new BadRequestException("Проверьте названия книг");
    const updates=normalizedLessonNames(dto.lessonNameUpdates,true);
    for(const n of updates)if(!books.some(b=>titleKey(b.title)===titleKey(n.book)&&b.lessonNumbers.includes(n.lessonNumber)))throw new BadRequestException("Название урока должно относиться к выбранной книге и номеру");
    const key={userId,wordId};
    if(!books.length){if(current.bookRevision&&(await tx.personalWordBooks.deleteMany({where:{...key,revision:current.bookRevision}})).count!==1)throw this.conflict()}
    else{const data={titles:books.map(b=>b.title),lessons:json(Object.fromEntries(books.map(b=>[b.title,b.lessonNumbers]))),revision:randomUUID()};if(!current.bookRevision)await tx.personalWordBooks.create({data:{...key,...data}});else if((await tx.personalWordBooks.updateMany({where:{...key,revision:current.bookRevision},data})).count!==1)throw this.conflict()}
    if(!tags.length){if(current.tagsRevision&&(await tx.personalWordTags.deleteMany({where:{...key,revision:current.tagsRevision}})).count!==1)throw this.conflict()}
    else{const data={titles:tags,revision:randomUUID()};if(!current.tagsRevision)await tx.personalWordTags.create({data:{...key,...data}});else if((await tx.personalWordTags.updateMany({where:{...key,revision:current.tagsRevision},data})).count!==1)throw this.conflict()}
    if(updates.length){
      if(current.settingsRevision!==dto.settingsRevision)throw this.conflict();
      const map=new Map(current.lessonNames.map(n=>[lessonKey(n),n]));for(const n of updates)if(n.name)map.set(lessonKey(n),n);else map.delete(lessonKey(n));
      if(map.size>500)throw new BadRequestException("Можно сохранить до 500 названий уроков");const data={lessonNames:json([...map.values()]),revision:randomUUID()};
      if(!current.settingsRevision)await tx.personalDictionarySettings.create({data:{userId,...data}});else if((await tx.personalDictionarySettings.updateMany({where:{userId,revision:current.settingsRevision},data})).count!==1)throw this.conflict();
    }
    return this.view(tx,userId,wordId);
  })}
  private conflict(){return new ConflictException("Организация словаря изменилась. Загрузите сохранённую версию.")}
}
