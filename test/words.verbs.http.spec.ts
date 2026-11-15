import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { VerbsController } from "../src/words/verbs.controller";
import { VerbsService } from "../src/words/verbs.service";
import { PersonalTranslationsService } from "../src/words/personal-translations.service";
import { WordAccessService } from "../src/words/word-access.service";
import { admin, makeWordsDatabase, userA, userB } from "./support/words-database";
const form={praeteritum:"ging",participle2:"gegangen",auxiliary:"SEIN",reflexive:false,usage:null};

describe("Verb reference HTTP (real services, in-memory persistence, no production DB)",()=>{
 let app:INestApplication,base:string,fixture:ReturnType<typeof makeWordsDatabase>;
 function seed(id:string,german:string,verbForms:any[]=[form],extra:Record<string,unknown>={}) {
  fixture.seedWord(id,{german,translation:german,article:"none",grammaticalNumber:"not_applicable",verbForms,...extra});
  fixture.translations.set(id+"-ru",{id:id+"-ru",wordId:id,language:"ru",text:german});
 }
 beforeEach(async()=>{
  fixture=makeWordsDatabase();
  seed("gehen","gehen");
  seed("umziehen","umziehen",[{...form,praeteritum:"zog um",participle2:"umgezogen",usage:"Wohnort"},{...form,praeteritum:"zog um",participle2:"umgezogen",auxiliary:"HABEN",reflexive:true,usage:"Kleidung"}]);
  seed("schreiben","schreiben",[{...form,praeteritum:"schrieb",participle2:"geschrieben",auxiliary:"HABEN"}]);
  seed("own","lernen",[{...form,praeteritum:"lernte",participle2:"gelernt",auxiliary:"HABEN"}],{publicationStatus:"PENDING_REVIEW",createdByUserId:userA.id});
  seed("foreign","schlafen",[{...form,praeteritum:"schlief",participle2:"geschlafen",auxiliary:"HABEN"}],{publicationStatus:"PENDING_REVIEW",createdByUserId:userB.id});
  seed("nonverb","heute",[]);
  for(const [userId,wordIds] of [[userA.id,["gehen","own"]],[userB.id,["schreiben","foreign"]]] as const)for(const wordId of wordIds)fixture.links.set(userId+wordId,{id:userId+wordId,userId,wordId});
  fixture.privateTranslations.set("a-private",{userId:userA.id,wordId:"gehen",language:"ru",text:"PERSONAL_A_ONLY"});
  fixture.privateTranslations.set("b-private",{userId:userB.id,wordId:"schreiben",language:"ru",text:"PERSONAL_B_SECRET"});
  const original=fixture.db.word.findMany.getMockImplementation()!;
  fixture.db.word.findMany.mockImplementation(async(args:any={})=>{
   const rows=await original(args);
   if(args.take===undefined)return rows;
   rows.sort((a:any,b:any)=>a.german.localeCompare(b.german,"de")||a.id.localeCompare(b.id));
   return rows.slice(args.skip??0,(args.skip??0)+args.take);
  });
  const db={...fixture.db,word:{...fixture.db.word,count:async(args:any)=>(await original(args)).length},$queryRaw:async()=>[{enabled:true}],$transaction:async(work:any)=>work(db)};
  const module=await Test.createTestingModule({imports:[AuthModule],controllers:[VerbsController],providers:[PrismaService,VerbsService,PersonalTranslationsService,WordAccessService]})
   .overrideProvider(PrismaService).useValue(db).overrideProvider(AuthService).useValue({authenticate:async(token:string)=>{
    const user=token==="a".repeat(43)?userA:token==="b".repeat(43)?userB:token==="c".repeat(43)?admin:token==="e".repeat(43)?{...userA,translationLanguage:"en"}:null;
    if(!user)throw new UnauthorizedException();return {user,sessionId:"test"};
   }}).compile();
  app=module.createNestApplication();app.setGlobalPrefix("api/v1");app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,"127.0.0.1");base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/verbs`;
 });
 afterEach(async()=>app?.close());
 function request(path="",actor="a"){return fetch(base+path,{headers:actor?{Authorization:`Bearer ${actor.repeat(43)}`}:{}})}
 it("requires auth on config, list and detail, and rejects invalid filters before reads",async()=>{
  for(const path of ["","/config","/gehen"])expect((await request(path,"")).status).toBe(401);
  for(const path of ["?scope=all","?q=%00","?page=0","?page=1.5","?page=1000001","?page=no","?auxiliary=BOTH","?q="+"a".repeat(101),"?scope=mine&admin=true"])expect((await request(path)).status).toBe(400);
  expect(fixture.db.word.findMany).not.toHaveBeenCalled();
 });
 it("lists only published verbs, pairs forms and exposes no dictionary links or other personal translations",async()=>{
  const response=await request();expect(response.headers.get("cache-control")).toBe("no-store");const page=await response.json();
  expect(page.total).toBe(3);expect(page.pageSize).toBe(30);expect(page.hasNext).toBe(false);
  expect(page.items.map((word:any)=>word.id)).toEqual(["gehen","schreiben","umziehen"]);
  expect(page.items.find((word:any)=>word.id==="gehen").selectedTranslation.text).toBe("PERSONAL_A_ONLY");
  expect(page.items.find((word:any)=>word.id==="schreiben").selectedTranslation.text).toBe("schreiben");
  expect(page.items.find((word:any)=>word.id==="umziehen").verbForms.map((f:any)=>[f.auxiliary,f.reflexive])).toEqual([["SEIN",false],["HABEN",true]]);
  expect(JSON.stringify(page)).not.toMatch(/PERSONAL_B_SECRET|user-b|userWords|createdByUserId/);
  expect((await (await request("","c")).json()).total).toBe(3);
 });
 it("keeps each dictionary separate, including own pending verbs, without Russian substitution",async()=>{
  expect((await (await request("?scope=mine")).json()).items.map((word:any)=>word.id)).toEqual(["gehen","own"]);
  expect((await (await request("?scope=mine","b")).json()).items.map((word:any)=>word.id)).toEqual(["foreign","schreiben"]);
  const en=await (await request("?q=gehen","e")).json();expect(en.items[0].selectedTranslation).toEqual({language:"en",text:null});
 });
 it("searches both past forms and filters auxiliary without removing a verb's other variants",async()=>{
  expect((await (await request("?q=%20GING%20")).json()).items.map((w:any)=>w.id)).toEqual(["gehen"]);
  expect((await (await request("?q=geschrieben")).json()).items.map((w:any)=>w.id)).toEqual(["schreiben"]);
  const sein=await (await request("?auxiliary=SEIN&q=umgezogen")).json();expect(sein.total).toBe(1);expect(sein.items[0].verbForms).toHaveLength(2);
  expect((await (await request("?q=NO_MATCH")).json()).total).toBe(0);
 });
 it("returns stable bounded pages without duplicate rows",async()=>{
  for(let n=0;n<35;n++)seed("page-"+n,"verb-"+String(n).padStart(2,"0"));
  const first=await (await request()).json(),second=await (await request("?page=2")).json();
  expect(first.total).toBe(38);expect(first.items).toHaveLength(30);expect(first.hasNext).toBe(true);expect(second.items).toHaveLength(8);expect(second.hasNext).toBe(false);
  expect(new Set([...first.items,...second.items].map((word:any)=>word.id)).size).toBe(38);
  expect((await (await request()).json()).items.map((word:any)=>word.id)).toEqual(first.items.map((word:any)=>word.id));
  expect((await (await request("?page=3")).json()).items).toEqual([]);
 });
 it("guards direct cards and never mutates words or progress",async()=>{
  expect((await request("/foreign")).status).toBe(404);expect((await request("/nonverb")).status).toBe(404);expect((await request("/missing")).status).toBe(404);
  expect((await request("/own")).status).toBe(200);expect((await request("/foreign","c")).status).toBe(200);
  expect(fixture.db.word.create).not.toHaveBeenCalled();expect(fixture.db.word.update).not.toHaveBeenCalled();expect(fixture.db.word.updateMany).not.toHaveBeenCalled();
 });
});
