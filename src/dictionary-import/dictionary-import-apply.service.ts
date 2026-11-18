import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException, OnModuleInit, OnModuleDestroy, HttpException } from "@nestjs/common";
import { Prisma, DictionaryImportBatch, PersonalWordNote, PersonalWordTranslation, PersonalWordBooks, UserWord } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { AuthUser } from "../auth/auth.service";
import { dictionaryWords, WORD_INCLUDE } from "../words/word-access.service";
import { verbData } from "../words/verb-data";
import { translationEntries } from "../words/translation-data";
import { guardWordSpellings, importSchemaReady, transactionConflict } from "./import-schema";
import { germanVariants, lexemeKey, MAX_IMPORT_BYTES, meaningsOverlap, parseDictionaryCsv } from "./dictionary-csv-reader";
import { privateBooks, savedRow, SavedImportRow, Lessons } from "./import-materials";

export type ImportDecision = { row:number; action:"skip"|"existing"|"new"|"newMeaning"|"reuse"; wordId?:string; referenceRow?:number; revision?:string };
type Receipt = {row:number; wordId:string|null; outcome:"created"|"attached"|"already"|"skipped"; warnings:string[]; revision?:string};
type PlanSummary = {total:number;new:number;existing:number;reuse:number;skip:number;warnings:{row:number;fields:string[]}[];rows:{row:number;german:string;action:string}[]};
type ReadableWord=Prisma.WordGetPayload<{include:typeof WORD_INCLUDE}>;
type PrivateSnapshot={note:PersonalWordNote|null|undefined;translations:PersonalWordTranslation[];books:Pick<PersonalWordBooks,'titles'|'lessons'|'revision'>|null|undefined;entry:UserWord|null|undefined};
const wordKey=(w:{german:string;article:string;grammaticalNumber:string;verbForms:unknown[]})=>lexemeKey({german:w.german,article:w.article,number:w.grammaticalNumber,type:w.verbForms.length?"verb":w.article!=="none"?"noun":"other"});
const conflict=(row:number,reason:string):never=>{throw new ConflictException({message:"dictionary_import_changed",row,reason});};
const uuid=(key:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))throw new BadRequestException("dictionary_import_invalid_key");return key.toLowerCase();};
const json=(data:unknown)=>JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;

@Injectable()
export class DictionaryImportApplyService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: ReturnType<typeof setInterval>;
  constructor(private readonly prisma:PrismaService){}
  onModuleInit(){void this.cleanup();this.cleanupTimer=setInterval(()=>void this.cleanup(),3600000);this.cleanupTimer.unref();}
  onModuleDestroy(){if(this.cleanupTimer)clearInterval(this.cleanupTimer);}
  private async cleanup(){try{if(await this.ready())await this.prisma.dictionaryImportBatch.updateMany({where:{state:{in:["PLANNED","IMPORTING"]},expiresAt:{lt:new Date()}},data:{state:"EXPIRED",rows:[],decisions:[],revision:{increment:1}}});}catch{/* No private payloads or connection data in logs. The next hourly pass retries. */}}
  async ready(){return importSchemaReady(this.prisma);}
  private async requireReady(){if(!await this.ready())throw new ServiceUnavailableException("dictionary_import_not_ready");}
  private async transaction<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
    for(let i=0;i<4;i++)try{return await this.prisma.$transaction(work,{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:60000});}
    catch(e){if(!transactionConflict(e)){if(e instanceof HttpException)throw e;throw new ServiceUnavailableException("dictionary_import_failed");}if(i===3)throw new ConflictException("dictionary_import_concurrent_change");}
    throw new ConflictException("dictionary_import_concurrent_change");
  }
  private view(batch:DictionaryImportBatch){
    const summary=batch.summary as unknown as PlanSummary,results=batch.results as unknown as Receipt[];
    return {key:batch.key,state:batch.state,cursor:batch.cursor,expiresAt:batch.expiresAt.toISOString(),summary,counts:{created:results.filter(r=>r.outcome==="created").length,attached:results.filter(r=>r.outcome==="attached").length,already:results.filter(r=>r.outcome==="already").length,skipped:results.filter(r=>r.outcome==="skipped").length,warnings:results.filter(r=>r.warnings.length).length},results};
  }
  async get(user:AuthUser,key:string){await this.requireReady();const batch=await this.prisma.dictionaryImportBatch.findUnique({where:{userId_key:{userId:user.id,key:uuid(key)}}});if(!batch)throw new NotFoundException("dictionary_import_batch_missing");return this.view(batch);}
  async latest(user:AuthUser){await this.requireReady();const batch=await this.prisma.dictionaryImportBatch.findFirst({where:{userId:user.id,state:{in:["PLANNED","IMPORTING"]},expiresAt:{gt:new Date()}},orderBy:{updatedAt:"desc"}});return batch?this.view(batch):null;}
  async discard(user:AuthUser,key:string){await this.requireReady();await this.prisma.dictionaryImportBatch.updateMany({where:{userId:user.id,key:uuid(key),state:{in:["PLANNED","IMPORTING"]}},data:{state:"EXPIRED",rows:[],decisions:[],revision:{increment:1}}});return this.get(user,key);}
  private decisions(input:string,total:number):ImportDecision[]{
    let data:unknown;try{data=JSON.parse(input);}catch{throw new BadRequestException("dictionary_import_choices_required");}
    if(!Array.isArray(data)||data.length!==total)throw new BadRequestException("dictionary_import_choices_required");
    return data.map((d,i)=>{if(!d||typeof d!=="object"||Array.isArray(d)||Object.keys(d).some(k=>!["row","action","wordId","referenceRow"].includes(k))||d.row!==i+1||!["skip","existing","new","newMeaning","reuse"].includes(d.action))throw new BadRequestException("dictionary_import_choices_required");
      if(d.action==="existing"?(typeof d.wordId!=="string"||!/^[A-Za-z0-9._-]{1,191}$/.test(d.wordId)||d.referenceRow!==undefined):d.wordId!==undefined)throw new BadRequestException("dictionary_import_choices_required");
      if(d.action==="reuse"?(!Number.isInteger(d.referenceRow)||d.referenceRow<1||d.referenceRow>=d.row):d.referenceRow!==undefined)throw new BadRequestException("dictionary_import_choices_required");
      return {row:d.row,action:d.action,...(d.wordId?{wordId:d.wordId}:{}),...(d.referenceRow?{referenceRow:d.referenceRow}:{})};});
  }
  private async matches(tx:Prisma.TransactionClient,user:AuthUser,row:SavedImportRow){
    const words=await tx.word.findMany({where:{AND:[dictionaryWords(user.id),{OR:germanVariants(row).map(german=>({german:{equals:german,mode:"insensitive" as const}}))}]},include:WORD_INCLUDE,take:201});
    if(words.length>200)conflict(row.row,"too_many_matches");return words.filter(w=>wordKey(w)===lexemeKey(row));
  }
  private async target(tx:Prisma.TransactionClient,user:AuthUser,id:string,row:SavedImportRow,revision?:string){
    const word=await tx.word.findFirst({where:{AND:[dictionaryWords(user.id),{id}]},include:WORD_INCLUDE});
    if(!word||wordKey(word)!==lexemeKey(row)||(revision&&word.updatedAt.toISOString()!==revision))conflict(row.row,"target_changed");return word!;
  }
  private async personal(tx:Prisma.TransactionClient,user:AuthUser,wordId:string,row:SavedImportRow,write:boolean,prefetched?:PrivateSnapshot){
    const p=row.personal,key={userId:user.id,wordId},warnings:string[]=[];
    const [note,translations,books,entry]=prefetched?[prefetched.note,prefetched.translations,prefetched.books,prefetched.entry]:await Promise.all([tx.personalWordNote.findUnique({where:{userId_wordId:key}}),tx.personalWordTranslation.findMany({where:key}),tx.personalWordBooks.findUnique({where:{userId_wordId:key},select:{titles:true,lessons:true,revision:true}}),tx.userWord.findUnique({where:{userId_wordId:key}})]);
    if(p.note&&note&&p.note!==note.text)warnings.push("personal_note");
    if(write&&p.note&&!note)await tx.personalWordNote.create({data:{...key,text:p.note,revision:randomUUID()}});
    for(const incoming of p.translations){const current=translations.find(t=>t.language===incoming.language);if(current&&current.text!==incoming.text)warnings.push("personal_translation_"+incoming.language);else if(write&&!current)await tx.personalWordTranslation.create({data:{...key,...incoming,revision:randomUUID()}});}
    const merged=privateBooks([...(books?.titles??[]),...p.books],{...Object.fromEntries(Object.entries((books?.lessons??{})as Lessons).map(([title,numbers])=>[title,[...numbers]])),...Object.fromEntries(Object.entries(p.lessons).map(([title,numbers])=>[title,[...(books?.lessons&&Object.hasOwn(books.lessons as Lessons,title)?(books.lessons as Lessons)[title]:[]),...numbers]]))});
    if(write&&JSON.stringify({titles:books?.titles??[],lessons:books?.lessons??{}})!==JSON.stringify(merged))await tx.personalWordBooks.upsert({where:{userId_wordId:key},create:{...key,titles:merged.titles,lessons:json(merged.lessons),revision:randomUUID()},update:{titles:merged.titles,lessons:json(merged.lessons),revision:randomUUID()}});
    if(entry&&((p.favorite!==null&&entry.isFavorite!==p.favorite)||(p.archived!==null&&entry.isArchived!==p.archived)))warnings.push("dictionary_flags");
    return {warnings,entry};
  }
  async prepare(user:AuthUser,buffer:Buffer,rawDecisions:string,key:string){
    await this.requireReady();key=uuid(key);const parsed=parseDictionaryCsv(buffer),decisions=this.decisions(rawDecisions,parsed.length);
    const requestHash=createHash("sha256").update(buffer).update(JSON.stringify(decisions)).digest("hex");
    const rows=parsed.map((row,i)=>decisions[i].action==="skip"?null:savedRow(row));
    if(Buffer.byteLength(JSON.stringify(rows))>MAX_IMPORT_BYTES)throw new BadRequestException("dictionary_import_too_large");
    return this.transaction(async tx=>{
      const previous=await tx.dictionaryImportBatch.findUnique({where:{userId_key:{userId:user.id,key}}});
      if(previous){if(previous.requestHash!==requestHash)throw new ConflictException("dictionary_import_key_reused");return this.view(previous);}
      const now=new Date();await tx.dictionaryImportBatch.updateMany({where:{userId:user.id,state:{in:["PLANNED","IMPORTING"]},expiresAt:{lt:now}},data:{state:"EXPIRED",rows:[],decisions:[],revision:{increment:1}}});
      if(await tx.dictionaryImportBatch.count({where:{userId:user.id,createdAt:{gte:new Date(Date.now()-86400000)}}})>=10||await tx.dictionaryImportBatch.count({where:{userId:user.id,state:{in:["PLANNED","IMPORTING"]}}})>=2)throw new BadRequestException("dictionary_import_batch_limit");
      const summary:PlanSummary={total:parsed.length,new:0,existing:0,reuse:0,skip:0,warnings:[],rows:parsed.map((r,i)=>({row:r.row,german:r.german,action:decisions[i].action}))};
      // Large files are prepared in bounded query batches, not thousands of round trips.
      const words=new Map<string,ReadableWord>();
      const terms:Prisma.WordWhereInput[]=[...new Set(rows.filter((r,i):r is SavedImportRow=>!!r&&["new","newMeaning"].includes(decisions[i].action)).flatMap(germanVariants))].map(german=>({german:{equals:german,mode:"insensitive"}}));
      const selectedIds=decisions.filter(d=>d.action==="existing").map(d=>d.wordId!);if(selectedIds.length)terms.push({id:{in:selectedIds}});
      for(let offset=0;offset<terms.length;offset+=100){const page=await tx.word.findMany({where:{AND:[dictionaryWords(user.id),{OR:terms.slice(offset,offset+100)}]},include:WORD_INCLUDE,take:20001});for(const word of page)words.set(word.id,word);if(page.length>20000||words.size>20000)throw new BadRequestException("dictionary_import_too_many_candidates");}
      const byKey=new Map<string,ReadableWord[]>();for(const word of words.values()){const key=wordKey(word);byKey.set(key,[...(byKey.get(key)??[]),word]);}
      const ownerWhere={userId:user.id,wordId:{in:selectedIds}};
      const [notes,privateTranslations,books,entries]=selectedIds.length?await Promise.all([tx.personalWordNote.findMany({where:ownerWhere}),tx.personalWordTranslation.findMany({where:ownerWhere}),tx.personalWordBooks.findMany({where:ownerWhere}),tx.userWord.findMany({where:ownerWhere})]):[[],[],[],[]];
      const notesByWord=new Map(notes.map(n=>[n.wordId,n])),booksByWord=new Map(books.map(b=>[b.wordId,b])),entriesByWord=new Map(entries.map(e=>[e.wordId,e]));
      const translationsByWord=new Map<string,PersonalWordTranslation[]>();for(const entry of privateTranslations)translationsByWord.set(entry.wordId,[...(translationsByWord.get(entry.wordId)??[]),entry]);
      const seen=new Map<string,SavedImportRow[]>();
      for(let i=0;i<rows.length;i++){
        const row=rows[i],choice=decisions[i];if(!row){summary.skip++;continue;}
        if(choice.action==="reuse") {const ref=rows[choice.referenceRow!-1];if(!ref||decisions[choice.referenceRow!-1].action==="skip"||lexemeKey(ref)!==lexemeKey(row))conflict(row.row,"invalid_reference");summary.reuse++;continue;}
        if(choice.action==="existing") {const target=words.get(choice.wordId!);if(!target||wordKey(target)!==lexemeKey(row))conflict(row.row,"target_changed");choice.revision=target!.updatedAt.toISOString();const {warnings}=await this.personal(tx,user,target!.id,row,false,{note:notesByWord.get(target!.id),translations:translationsByWord.get(target!.id)??[],books:booksByWord.get(target!.id),entry:entriesByWord.get(target!.id)});if(warnings.length)summary.warnings.push({row:row.row,fields:warnings});summary.existing++;continue;}
        const candidates=byKey.get(lexemeKey(row))??[];
        if(choice.action==="new"&&candidates.length)conflict(row.row,"matches_found");
        if(choice.action==="newMeaning"&&(!row.translations.length||candidates.some(w=>meaningsOverlap(row.translations,[...w.translations,...(w.translation?[{language:"ru",text:w.translation}]:[])]))))conflict(row.row,"same_meaning");
        const prior=seen.get(lexemeKey(row))??[];if(prior.some(r=>meaningsOverlap(r.translations,row.translations)||(!r.translations.length&&!row.translations.length)))conflict(row.row,"file_duplicate");
        seen.set(lexemeKey(row),[...prior,row]);summary.new++;
      }
      if(summary.skip===summary.total)throw new BadRequestException("dictionary_import_nothing_selected");
      const batch=await tx.dictionaryImportBatch.create({data:{userId:user.id,key,requestHash,rows:json(rows),decisions:json(decisions),summary:json(summary),expiresAt:new Date(Date.now()+86400000)}});return this.view(batch);
    });
  }
  async apply(user:AuthUser,key:string,cursor:number){
    await this.requireReady();key=uuid(key);if(!Number.isInteger(cursor)||cursor<0||cursor>10000)throw new BadRequestException("dictionary_import_invalid_cursor");
    return this.transaction(async tx=>{
      const batch=await tx.dictionaryImportBatch.findUnique({where:{userId_key:{userId:user.id,key}}});if(!batch)throw new NotFoundException("dictionary_import_batch_missing");
      if(batch.state==="COMPLETED"||cursor<batch.cursor)return this.view(batch);
      if(batch.state==="EXPIRED"||batch.expiresAt.getTime()<Date.now())throw new ConflictException("dictionary_import_batch_expired");
      if(cursor!==batch.cursor)throw new ConflictException("dictionary_import_invalid_cursor");
      const locked=await tx.dictionaryImportBatch.updateMany({where:{id:batch.id,revision:batch.revision},data:{revision:{increment:1}}});if(locked.count!==1)throw new ConflictException("dictionary_import_concurrent_change");
      const rows=batch.rows as unknown as (SavedImportRow|null)[],decisions=batch.decisions as unknown as ImportDecision[],receipts=batch.results as unknown as Receipt[],end=Math.min(cursor+25,rows.length);
      await guardWordSpellings(tx,rows.slice(cursor,end).filter((r):r is SavedImportRow=>!!r).map(r=>r.german));
      for(let i=cursor;i<end;i++){
        const row=rows[i],choice=decisions[i];if(!row){receipts.push({row:i+1,wordId:null,outcome:"skipped",warnings:[]});continue;}
        let word:Awaited<ReturnType<DictionaryImportApplyService['target']>>,created=false;
        if(choice.action==="existing")word=await this.target(tx,user,choice.wordId!,row,choice.revision);
        else if(choice.action==="reuse"){const previous=receipts[choice.referenceRow!-1];if(!previous?.wordId)conflict(row.row,"invalid_reference");word=await this.target(tx,user,previous.wordId!,row,previous.revision);}
        else {
          const candidates=await this.matches(tx,user,row);
          if(choice.action==="new"&&candidates.length){if(candidates.length!==1||!meaningsOverlap(row.translations,[...candidates[0].translations,...(candidates[0].translation?[{language:"ru",text:candidates[0].translation}]:[])]))conflict(row.row,"matches_changed");word=candidates[0];}
          else {
            if(choice.action==="newMeaning"&&candidates.some(w=>meaningsOverlap(row.translations,[...w.translations,...(w.translation?[{language:"ru",text:w.translation}]:[])])))conflict(row.row,"same_meaning");
            const card=row.card,translations=translationEntries(card);
            word=await tx.word.create({data:{german:row.german,article:card.article,grammaticalNumber:card.grammaticalNumber,translation:translations.find(t=>t.language==="ru")?.text??"",pluralForm:card.pluralForm,level:card.level,sourceBook:card.sourceBook,lessonNumber:card.lessonNumber,notes:card.notes,
              createdByUserId:user.id,publicationStatus:"PENDING_REVIEW",translations:{create:translations},verbForms:verbData(card,card,[],true),bookSources:{create:row.sources},examples:{create:(card.examples??[]).map(e=>{const texts=translationEntries(e);return{german:e.german.normalize("NFC").trim(),translation:texts.find(t=>t.language==="ru")?.text??"",translations:{create:texts}};})}},include:WORD_INCLUDE});created=true;
          }
        }
        const {warnings,entry}=await this.personal(tx,user,word.id,row,true);
        if(!entry)await tx.userWord.create({data:{userId:user.id,wordId:word.id,isFavorite:row.personal.favorite??false,isArchived:row.personal.archived??false,revision:randomUUID()}});
        receipts.push({row:row.row,wordId:word.id,outcome:created?"created":entry?"already":"attached",warnings,revision:word.updatedAt.toISOString()});
      }
      const done=end===rows.length;
      const updated=await tx.dictionaryImportBatch.update({where:{id:batch.id},data:{cursor:end,results:json(receipts),state:done?"COMPLETED":"IMPORTING",...(done?{rows:[],decisions:[]}:{})}});return this.view(updated);
    });
  }
}
