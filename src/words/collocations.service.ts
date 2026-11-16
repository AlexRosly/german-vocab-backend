import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";
import { WordAccessService, readableWords } from "./word-access.service";
import { translationEntries } from "./translation-data";
import { CreateCollocationDto, UpdateCollocationDto } from "./dto/collocation.dto";

const include={translations:{orderBy:{language:"asc"}},nounWord:{select:{id:true,german:true,article:true,grammaticalNumber:true}},verbWord:{select:{id:true,german:true}}} satisfies Prisma.WordCollocationInclude;
type Row=Prisma.WordCollocationGetPayload<{include:typeof include}>;
export const isNoun=(word:{article:string;grammaticalNumber:string})=>word.article!=="none"&&["singular","plural"].includes(word.grammaticalNumber);
export const collocationKey=(text:string)=>text.normalize("NFC").trim().replace(/\s+/gu," ").toLocaleLowerCase("de");
const present=(row:Row,language:string)=>({id:row.id,nounWordId:row.nounWordId,verbWordId:row.verbWordId,german:row.german,grammarNote:row.grammarNote,revision:row.revision,
  translations:row.translations.map(({language,text})=>({language,text})),selectedTranslation:{language,text:row.translations.find(entry=>entry.language===language)?.text??null},noun:row.nounWord,verb:row.verbWord});

@Injectable()
export class CollocationsService {
  constructor(private readonly prisma:PrismaService,private readonly access:WordAccessService){}
  async config(){const rows=await this.prisma.$queryRaw<{enabled:boolean}[]>`SELECT to_regclass('public.word_collocations') IS NOT NULL AND to_regclass('public.word_collocation_translations') IS NOT NULL AS enabled`;return {enabled:rows[0]?.enabled===true,version:1};}
  private async enabled(){if(!(await this.config()).enabled)throw new ServiceUnavailableException("Сочетания пока недоступны");}
  private admin(user:AuthUser){if(user.role!=="ADMIN")throw new ForbiddenException("Требуются права администратора");}
  private visible(user:AuthUser):Prisma.WordCollocationWhereInput {return {AND:[{nounWord:readableWords(user)},{verbWord:readableWords(user)},
    {nounWord:{article:{in:["der","das","die"]},grammaticalNumber:{in:["singular","plural"]}}},{verbWord:{verbForms:{some:{}}}}]};}
  async list(user:AuthUser,id:string,page=1){
    await this.enabled();
    return this.access.transaction(async tx=>{
      const word=await this.access.requireReadable(user,id,tx),kind=word.verbForms.length?"verb":isNoun(word)?"noun":"other";
      const where:Prisma.WordCollocationWhereInput={AND:[this.visible(user),kind==="noun"?{nounWordId:id}:kind==="verb"?{verbWordId:id}:{id:{in:[]}}]};
      const total=await tx.wordCollocation.count({where});
      const rows=await tx.wordCollocation.findMany({where,include,orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(page-1)*20,take:20});
      return {kind,total,page,pageSize:20,hasNext:page*20<total,items:rows.map(row=>present(row,user.translationLanguage))};
    });
  }
  async detail(user:AuthUser,id:string,collocationId:string){await this.enabled();return this.access.transaction(async tx=>{
    await this.access.requireReadable(user,id,tx);
    const row=await tx.wordCollocation.findFirst({where:{AND:[{id:collocationId},{OR:[{nounWordId:id},{verbWordId:id}]},this.visible(user)]},include});
    if(!row)throw new NotFoundException("Сочетание не найдено");return present(row,user.translationLanguage);
  });}
  private async lockAndValidate(tx:Prisma.TransactionClient,user:AuthUser,nounId:string,verbId:string,previousVerbId?:string){
    if(nounId===verbId)throw new BadRequestException("Нужны разные карточки существительного и глагола");
    for(const id of [...new Set([nounId,verbId,...(previousVerbId?[previousVerbId]:[])])].sort())await this.access.beginEdit(tx,user,id);
    const noun=await this.access.requireReadable(user,nounId,tx),verb=await this.access.requireReadable(user,verbId,tx);
    if(!isNoun(noun)||noun.verbForms.length)throw new BadRequestException("Выберите карточку существительного с артиклем");
    if(!verb.verbForms.length)throw new BadRequestException("Выберите существующий глагол с заполненными формами");
  }
  private duplicate(){return new ConflictException("Такое сочетание уже существует");}
  private stale(){return new ConflictException("Сочетание изменилось. Загрузите сохранённую версию");}
  async create(user:AuthUser,nounId:string,dto:CreateCollocationDto){
    this.admin(user);await this.enabled();return this.access.transaction(async tx=>{
      await this.lockAndValidate(tx,user,nounId,dto.verbWordId);
      const german=dto.german.normalize("NFC").trim().replace(/\s+/gu," "),phraseKey=collocationKey(german);
      if(await tx.wordCollocation.findFirst({where:{nounWordId:nounId,verbWordId:dto.verbWordId,phraseKey},select:{id:true}}))throw this.duplicate();
      const row=await tx.wordCollocation.create({data:{nounWordId:nounId,verbWordId:dto.verbWordId,german,phraseKey,grammarNote:dto.grammarNote?.trim()||null,revision:randomUUID(),translations:{create:translationEntries(dto)}},include});
      return present(row,user.translationLanguage);
    });
  }
  async update(user:AuthUser,nounId:string,id:string,dto:UpdateCollocationDto){
    this.admin(user);await this.enabled();return this.access.transaction(async tx=>{
      const row=await tx.wordCollocation.findFirst({where:{id,nounWordId:nounId},include});if(!row)throw new NotFoundException("Сочетание не найдено");if(row.revision!==dto.revision)throw this.stale();
      const verbId=dto.verbWordId??row.verbWordId;await this.lockAndValidate(tx,user,nounId,verbId,row.verbWordId);
      const german=(dto.german??row.german).normalize("NFC").trim().replace(/\s+/gu," "),phraseKey=collocationKey(german);
      if(await tx.wordCollocation.findFirst({where:{nounWordId:nounId,verbWordId:verbId,phraseKey,id:{not:id}},select:{id:true}}))throw this.duplicate();
      const revision=randomUUID();
      const changed=await tx.wordCollocation.updateMany({where:{id,nounWordId:nounId,revision:dto.revision},data:{verbWordId:verbId,german,phraseKey,grammarNote:dto.grammarNote===undefined?row.grammarNote:dto.grammarNote?.trim()||null,revision}});
      if(changed.count!==1)throw this.stale();
      if(dto.translations!==undefined){const entries=translationEntries(dto,row.translations);await tx.wordCollocationTranslation.deleteMany({where:{collocationId:id}});if(entries.length)await tx.wordCollocationTranslation.createMany({data:entries.map(entry=>({collocationId:id,...entry}))});}
      return present((await tx.wordCollocation.findUnique({where:{id},include}))!,user.translationLanguage);
    });
  }
  async remove(user:AuthUser,nounId:string,id:string,revision:string){
    this.admin(user);await this.enabled();return this.access.transaction(async tx=>{
      const row=await tx.wordCollocation.findFirst({where:{id,nounWordId:nounId},include});if(!row)throw new NotFoundException("Сочетание не найдено");if(row.revision!==revision)throw this.stale();
      await this.lockAndValidate(tx,user,nounId,row.verbWordId);
      const result=await tx.wordCollocation.deleteMany({where:{id,nounWordId:nounId,revision}});if(result.count!==1)throw this.stale();return {deleted:true};
    });
  }
}
