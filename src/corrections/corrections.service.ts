import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { CorrectionStatus, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../prisma.service";
import { WordAccessService } from "../words/word-access.service";
import { CorrectionQueryDto, CreateCorrectionDto, ReviewCorrectionDto } from "./corrections.dto";

export const correctionSelect = { id:true, wordId:true, category:true, description:true, suggestion:true, snapshot:true,
 status:true, revision:true, reviewComment:true, reviewedAt:true, createdAt:true, updatedAt:true } satisfies Prisma.WordCorrectionSelect;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
@Injectable()
export class CorrectionsService {
 constructor(private readonly prisma: PrismaService, private readonly access: WordAccessService) {}
 async config() {
  const rows = await this.prisma.$queryRaw<{enabled:boolean}[]>`SELECT to_regclass('public.word_corrections') IS NOT NULL AS enabled`;
  return { enabled: rows[0]?.enabled === true };
 }
 private async enabled() { if (!(await this.config()).enabled) throw new ServiceUnavailableException("Предложения исправлений пока недоступны"); }
 private admin(user: AuthUser) { if(user.role !== "ADMIN") throw new ForbiddenException("Требуются права администратора"); }
 private async snapshot(tx: Prisma.TransactionClient, wordId: string) {
  const word=await tx.word.findUnique({where:{id:wordId},include:{translations:{orderBy:{language:"asc"}},examples:{include:{translations:{orderBy:{language:"asc"}}},orderBy:{id:"asc"}}}});
  if(!word) throw new NotFoundException("Карточка не найдена");
  const edges=await tx.wordRelation.findMany({where:{OR:[{leftWordId:wordId},{rightWordId:wordId}],leftWord:{publicationStatus:"PUBLISHED"},rightWord:{publicationStatus:"PUBLISHED"}},select:{leftWord:{select:{id:true,german:true,article:true}},rightWord:{select:{id:true,german:true,article:true}}}});
  return { id:word.id,german:word.german,translation:word.translation,article:word.article,grammaticalNumber:word.grammaticalNumber,pluralForm:word.pluralForm,
   publicationStatus:word.publicationStatus,sourceBook:word.sourceBook,level:word.level,lessonNumber:word.lessonNumber,notes:word.notes,
   translations:word.translations.map(t=>({language:t.language,text:t.text})),
   examples:word.examples.map(e=>({id:e.id,german:e.german,translations:e.translations.map(t=>({language:t.language,text:t.text}))})),
   relatedWords:edges.map(e=>e.leftWord.id===wordId?e.rightWord:e.leftWord).sort((a,b)=>a.id.localeCompare(b.id)) };
 }
 async create(user: AuthUser, wordId: string, dto: CreateCorrectionDto) {
  await this.enabled();
  return this.access.transaction(async tx=>{
   const word=await tx.word.findFirst({where:{id:wordId,publicationStatus:"PUBLISHED"},select:{id:true}});
   if(!word) throw new NotFoundException("Карточка не найдена");
   if(await tx.wordCorrection.findFirst({where:{reporterId:user.id,wordId,status:"OPEN"},select:{id:true}})) throw new ConflictException("У вас уже есть открытое предложение по этой карточке");
   const snapshot=await this.snapshot(tx,wordId);
   return tx.wordCorrection.create({data:{wordId,reporterId:user.id,category:dto.category,description:dto.description,
    suggestion:dto.suggestion ?? null,snapshot:snapshot as Prisma.InputJsonValue},select:correctionSelect});
  });
 }
 async list(user:AuthUser,query:CorrectionQueryDto,admin=false) {
  if(admin) this.admin(user); await this.enabled();
  const where:Prisma.WordCorrectionWhereInput={...(admin?{}:{reporterId:user.id}),status:query.status ?? "OPEN"};
  const page=query.page ?? 0,pageSize=30;
  return this.prisma.$transaction(async tx=>({items:await tx.wordCorrection.findMany({where,select:correctionSelect,orderBy:[{createdAt:"asc"},{id:"asc"}],skip:page*pageSize,take:pageSize}),total:await tx.wordCorrection.count({where}),page,pageSize}),{isolationLevel:"RepeatableRead"});
 }
 async detail(user:AuthUser,id:string,admin=false) {
  if(admin) this.admin(user); await this.enabled();
  return this.access.transaction(async tx=>{
   const report=await tx.wordCorrection.findFirst({where:{id,...(admin?{}:{reporterId:user.id})},select:correctionSelect});
   if(!report) throw new NotFoundException("Предложение не найдено");
   // The reporter retains their own report history, but never gains access to an unpublished card.
   const readable=admin||!!await tx.word.findFirst({where:{id:report.wordId,publicationStatus:"PUBLISHED"},select:{id:true}});
   const current=readable?await this.snapshot(tx,report.wordId):null;
   return {...report,current,cardChanged:current===null||digest(current)!==digest(report.snapshot)};
  });
 }
 async review(user:AuthUser,id:string,dto:ReviewCorrectionDto) {
  this.admin(user); await this.enabled();
  return this.access.transaction(async tx=>{
   const report=await tx.wordCorrection.findUnique({where:{id},select:{id:true}});
   if(!report) throw new NotFoundException("Предложение не найдено");
   const changed=await tx.wordCorrection.updateMany({where:{id,status:CorrectionStatus.OPEN,revision:dto.expectedRevision},data:{status:dto.status,
    revision:randomUUID(),reviewComment:dto.comment,reviewerId:user.id,reviewedAt:new Date()}});
   if(changed.count!==1) throw new ConflictException("Предложение уже рассмотрено или изменилось. Обновите список.");
   return tx.wordCorrection.findUniqueOrThrow({where:{id},select:correctionSelect});
  });
 }
}
