import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { userA, userB } from "./support/words-database";
import { makeStudyDatabase } from "./support/study-database";
describe("Archived personal words in study HTTP",()=>{
 let app:INestApplication,url:string,fixture:ReturnType<typeof makeStudyDatabase>;
 beforeEach(async()=>{
  fixture=makeStudyDatabase();fixture.seedWord("shared");fixture.link(userA.id,"shared");fixture.link(userB.id,"shared");
  const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(fixture.db)
   .overrideProvider(AuthService).useValue({authenticate:async(token:string)=>{const user=token==="a".repeat(43)?userA:token==="b".repeat(43)?userB:null;if(!user)throw new UnauthorizedException();return {user,sessionId:user.id};}}).compile();
  app=module.createNestApplication();app.setGlobalPrefix("api/v1");app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  await app.listen(0,"127.0.0.1");url=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/study`;
 });
 afterEach(async()=>{await app?.close();});
 const get=(path:string,actor="a")=>fetch(url+path,{headers:{Authorization:`Bearer ${actor.repeat(43)}`}}).then(r=>r.json());
 const save=(key:string)=>fetch(url+"/sessions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${"a".repeat(43)}`,"Idempotency-Key":key},body:JSON.stringify({totalWords:1,words:[{wordId:"shared",answer:"KNOWN"}]})});
 const entry=()=>[...fixture.links.values()].find(row=>row.userId===userA.id)!;
 it("excludes archived fresh words only for their owner; favorite alone never changes the queue",async()=>{
  entry().isFavorite=true;expect((await get("/new")).count).toBe(1);
  entry().isArchived=true;expect((await get("/new")).count).toBe(0);expect((await get("/new","b")).count).toBe(1);
  expect(fixture.links.size).toBe(2);expect(fixture.words.size).toBe(1);
 });
 it("hides archived due words and active counters, retaining history, progress and schedule for restore",async()=>{
  const response=await save("archive-history");expect(response.status).toBe(201);const session=await response.json();
  fixture.progressFor(userA.id,"shared")!.nextReviewAt=new Date(0);const before=structuredClone(fixture.progressFor(userA.id,"shared"));
  entry().isArchived=true;
  expect((await get("/due")).dueCount).toBe(0);const progress=await get("/progress");expect(progress.totalWordsInDictionary).toBe(0);expect(progress.wordsWithProgress).toBe(0);expect(progress.totalSessions).toBe(1);
  const history=await get(`/history/${session.id}`);expect(history.words).toHaveLength(1);expect(history.knownCount).toBe(1);
  expect(fixture.progressFor(userA.id,"shared")).toEqual(before);entry().isArchived=false;
  expect((await get("/due")).dueCount).toBe(1);expect((await get("/progress")).wordsWithProgress).toBe(1);expect(fixture.progressFor(userA.id,"shared")).toEqual(before);
 });
 it("allows a session already started on another device to finish after archival and remains idempotent",async()=>{
  entry().isArchived=true;const response=await save("archive-late-save");expect(response.status).toBe(201);const first=await response.json();
  const again=await (await save("archive-late-save")).json();expect(again.id).toBe(first.id);expect(fixture.sessions.size).toBe(1);expect(fixture.progressFor(userA.id,"shared")!.knownCount).toBe(1);
  expect((await get("/new")).count).toBe(0);expect((await get("/new","b")).count).toBe(1);
 });
});
