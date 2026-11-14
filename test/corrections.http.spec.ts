import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { WordAccessService } from "../src/words/word-access.service";
import { CorrectionsService } from "../src/corrections/corrections.service";
import { CorrectionsController } from "../src/corrections/corrections.controller";
import { makeWordsDatabase, userA, userB, admin } from "./support/words-database";

describe("Correction HTTP boundary (real services, test persistence)",()=>{
 let app:INestApplication,base:string,fixture:ReturnType<typeof makeWordsDatabase>,db:any,reports:Map<string,any>,enabled:boolean,sequence:number;
 const matches=(row:any,where:any={})=>Object.entries(where).every(([k,v])=>row[k]===v);
 const project=(row:any,select:any)=>row?structuredClone(Object.fromEntries(Object.keys(select).filter(k=>select[k]).map(k=>[k,row[k]]))):null;
 beforeEach(async()=>{
  fixture=makeWordsDatabase();fixture.seedWord("published",{notes:"Shared note"});fixture.seedWord("private",{publicationStatus:"PENDING_REVIEW",createdByUserId:userB.id});db=fixture.db;reports=new Map();sequence=0;enabled=true;
  db.word.findUnique=db.word.findFirst;
  db.$queryRaw=jest.fn(async()=>[{enabled}]);
  const first=(args:any)=>project([...reports.values()].find(r=>matches(r,args.where)),args.select);
  db.wordCorrection={
   findFirst:jest.fn(async(args:any)=>first(args)),findUnique:jest.fn(async(args:any)=>first(args)),findUniqueOrThrow:jest.fn(async(args:any)=>{const r=first(args);if(!r)throw Error("missing");return r;}),
   create:jest.fn(async(args:any)=>{const r={id:`report-${++sequence}`,status:"OPEN",revision:`revision-${sequence}`,reviewComment:null,reviewedAt:null,reviewerId:null,createdAt:new Date(),updatedAt:new Date(),suggestion:null,...args.data};reports.set(r.id,r);return project(r,args.select);}),
   findMany:jest.fn(async(args:any)=>[...reports.values()].filter(r=>matches(r,args.where)).slice(args.skip,args.skip+args.take).map(r=>project(r,args.select))),
   count:jest.fn(async(args:any)=>[...reports.values()].filter(r=>matches(r,args.where)).length),
   updateMany:jest.fn(async(args:any)=>{let count=0;for(const r of reports.values())if(matches(r,args.where)){Object.assign(r,args.data,{updatedAt:new Date()});count++;}return {count};}),
  };
  db.$transaction=jest.fn(async(work:any)=>{const before=structuredClone([...reports]);try{return await work(db);}catch(e){reports.clear();for(const [id,r]of before)reports.set(id,r);throw e;}});
  const module=await Test.createTestingModule({imports:[AuthModule],controllers:[CorrectionsController],providers:[PrismaService,WordAccessService,CorrectionsService]})
   .overrideProvider(PrismaService).useValue(db).overrideProvider(AuthService).useValue({authenticate:async(token:string)=>{const user=token==="a".repeat(43)?userA:token==="b".repeat(43)?userB:token==="c".repeat(43)?admin:null;if(!user)throw new UnauthorizedException();return {user,sessionId:"session-"+user.id};}}).compile();
  app=module.createNestApplication();app.setGlobalPrefix("api/v1");app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,"127.0.0.1");base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
 });
 afterEach(async()=>{await app?.close();});
 const payload={category:"TRANSLATION",description:"The translation needs a correction.",suggestion:"A better translation"};
 const req=(path:string,method="GET",body?:unknown,actor="a")=>fetch(base+path,{method,headers:{"Content-Type":"application/json",...(actor?{Authorization:`Bearer ${actor.repeat(43)}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const create=async(actor="a")=>{const r=await req("/words/published/corrections","POST",payload,actor);expect(r.status).toBe(201);return r.json();};
 it("protects all routes and rejects non-admin moderation before reading reports",async()=>{
  for(const [path,method]of [["/corrections/config","GET"],["/words/published/corrections","POST"],["/corrections/mine","GET"],["/corrections/mine/report-1","GET"],["/moderation/corrections","GET"],["/moderation/corrections/report-1","GET"],["/moderation/corrections/report-1","PATCH"]])expect((await req(path,method,undefined,"")).status).toBe(401);
  for(const [path,method]of [["/moderation/corrections","GET"],["/moderation/corrections/report-1","GET"],["/moderation/corrections/report-1","PATCH"]])expect((await req(path,method,method==='PATCH'?payload:undefined)).status).toBe(403);
  expect(db.wordCorrection.findMany).not.toHaveBeenCalled();
 });
 it("captures only the common card and never changes it or dictionary settings",async()=>{
  const before=JSON.stringify([...fixture.words]);const result=await create();
  expect(result).toMatchObject({wordId:"published",status:"OPEN",snapshot:{german:"Tisch",notes:"Shared note"}});
  expect(result).not.toHaveProperty("reporterId");expect(result).not.toHaveProperty("reviewerId");
  expect(JSON.stringify([...fixture.words])).toBe(before);expect(fixture.links.size).toBe(0);expect(db.word.update).not.toHaveBeenCalled();
  expect(db.wordRelation.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({leftWord:{publicationStatus:"PUBLISHED"},rightWord:{publicationStatus:"PUBLISHED"}})}));
  expect((await req("/words/private/corrections","POST",payload)).status).toBe(404);
 });
 it("validates categories, text, identifiers, pagination and prevents status/identity/snapshot injection",async()=>{
  for(const data of [{...payload,category:"BAD"},{...payload,description:"short"},{...payload,description:"x".repeat(2001)},{...payload,suggestion:null},{...payload,description:null},...['reporterId','status','snapshot','reviewerId'].map(key=>({...payload,[key]:"injected"}))])expect((await req("/words/published/corrections","POST",data)).status).toBe(400);
  for(const query of ['page=-1','page=1.5','status=BAD','status=all','status=ALL&status=OPEN','reporterId=user-b','page=1&page=2'])expect((await req('/corrections/mine?'+query)).status).toBe(400);
  expect(db.wordCorrection.create).not.toHaveBeenCalled();
 });
 it("isolates personal history while administrators see both reporters",async()=>{
  const a=await create(),b=await create("b");
  expect((await (await req('/corrections/mine')).json()).items.map((r:any)=>r.id)).toEqual([a.id]);
  expect((await req('/corrections/mine/'+b.id)).status).toBe(404);
  expect((await (await req('/moderation/corrections','GET',undefined,'c')).json()).total).toBe(2);
  const detail=await (await req('/moderation/corrections/'+a.id,'GET',undefined,'c')).json();expect(detail.cardChanged).toBe(false);expect(detail.current.german).toBe('Tisch');
 });
 it("lists every status without exposing another reporter and keeps OPEN as the default",async()=>{
  const rejected=await create();
  expect((await req('/moderation/corrections/'+rejected.id,'PATCH',{status:'REJECTED',expectedRevision:rejected.revision,comment:'Test rejected'},'c')).status).toBe(200);
  const resolved=await create();
  expect((await req('/moderation/corrections/'+resolved.id,'PATCH',{status:'RESOLVED',expectedRevision:resolved.revision,comment:'Test resolved'},'c')).status).toBe(200);
  const open=await create(),foreign=await create('b');
  const list=async(path:string,actor='a')=>{const response=await req(path,'GET',undefined,actor);expect(response.status).toBe(200);return response.json();};
  const mine=await list('/corrections/mine?status=ALL&page=0');
  expect(mine).toMatchObject({total:3,page:0,pageSize:30});
  expect(mine.items.map((r:any)=>r.id)).toEqual([rejected.id,resolved.id,open.id]);
  expect(mine.items.map((r:any)=>r.status)).toEqual(['REJECTED','RESOLVED','OPEN']);
  expect((await list('/corrections/mine?status=ALL','b')).items.map((r:any)=>r.id)).toEqual([foreign.id]);
  expect((await list('/moderation/corrections?status=ALL','c')).total).toBe(4);
  expect((await req('/moderation/corrections?status=ALL')).status).toBe(403);
  expect((await list('/corrections/mine')).items.map((r:any)=>r.id)).toEqual([open.id]);
  expect((await list('/corrections/mine?status=RESOLVED')).items.map((r:any)=>r.id)).toEqual([resolved.id]);
  expect(await list('/corrections/mine?status=ALL&page=1')).toMatchObject({items:[],total:3,page:1,pageSize:30});
  expect((await req('/moderation/corrections/'+open.id,'PATCH',{status:'ALL',expectedRevision:open.revision,comment:'Not a decision'},'c')).status).toBe(400);
 });
 it("prevents a second open report and closes only with an administrator comment",async()=>{
  const report=await create();expect((await req('/words/published/corrections','POST',payload)).status).toBe(409);
  const path='/moderation/corrections/'+report.id;
  for(const body of [{status:'OPEN',expectedRevision:report.revision,comment:'test'},{status:'RESOLVED',expectedRevision:report.revision,comment:'x'},{status:'RESOLVED',expectedRevision:report.revision,comment:'fixed',reviewerId:'other'}])expect((await req(path,'PATCH',body,'c')).status).toBe(400);
  const decision={status:'RESOLVED',expectedRevision:report.revision,comment:'Corrected the translation'};
  expect((await req(path,'PATCH',decision)).status).toBe(403);
  expect((await req(path,'PATCH',{...decision,expectedRevision:'outdated'},'c')).status).toBe(409);
  const response=await req(path,'PATCH',decision,'c');expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'RESOLVED',reviewComment:decision.comment});
  expect((await req(path,'PATCH',decision,'c')).status).toBe(409);
  expect((await (await req('/corrections/mine?status=RESOLVED')).json()).items[0].reviewComment).toBe(decision.comment);
  await create();expect(reports.size).toBe(2);
 });
 it("retains the submitted snapshot when a card changes and hides unpublished current content from its reporter",async()=>{
  const report=await create();fixture.words.get('published')!.german='Changed';
  let detail=await (await req('/corrections/mine/'+report.id)).json();expect(detail.snapshot.german).toBe('Tisch');expect(detail.current.german).toBe('Changed');expect(detail.cardChanged).toBe(true);
  fixture.words.get('published')!.publicationStatus='REJECTED';detail=await (await req('/corrections/mine/'+report.id)).json();expect(detail.current).toBeNull();
  expect((await (await req('/moderation/corrections/'+report.id,'GET',undefined,'c')).json()).current.german).toBe('Changed');
 });
 it("keeps the feature disabled before the migration without touching the missing table",async()=>{
  enabled=false;expect(await (await req('/corrections/config')).json()).toEqual({enabled:false});
  expect((await req('/words/published/corrections','POST',payload)).status).toBe(503);expect((await req('/corrections/mine')).status).toBe(503);expect(db.wordCorrection.create).not.toHaveBeenCalled();
 });
});
