import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { WordAccessService } from "../src/words/word-access.service";
import { WordOrganizationService } from "../src/words/word-organization.service";
import { WordOrganizationController } from "../src/words/word-organization.controller";
import { makeWordsDatabase,userA,userB,admin } from "./support/words-database";
describe('Organization HTTP: private materials, validation and optimistic revisions',()=>{
 let app:INestApplication,base:string,fixture:ReturnType<typeof makeWordsDatabase>,ready:boolean;
 const tags=new Map<string,any>(),settings=new Map<string,any>();
 const key=(v:any)=>v.userId+':'+v.wordId;
 beforeEach(async()=>{
  ready=true;tags.clear();settings.clear();fixture=makeWordsDatabase();fixture.seedWord('shared');fixture.links.set('a',{userId:userA.id,wordId:'shared'});fixture.links.set('b',{userId:userB.id,wordId:'shared'});
  const model=(map:Map<string,any>,identity:(v:any)=>string,compound?:string)=>({findUnique:async({where}:any)=>map.get(identity(compound?where[compound]:where))??null,create:async({data}:any)=>{map.set(identity(data),{...data});return data},updateMany:async({where,data}:any)=>{const row=map.get(identity(where));if(!row||row.revision!==where.revision)return{count:0};Object.assign(row,data);return{count:1}},deleteMany:async({where}:any)=>{const row=map.get(identity(where));if(!row||row.revision!==where.revision)return{count:0};map.delete(identity(where));return{count:1}}});
  const db=Object.assign(fixture.db,{$queryRaw:jest.fn(async()=>[{organizationReady:ready,ready:false}]),personalWordTags:model(tags,key,'userId_wordId'),personalDictionarySettings:model(settings,(v:any)=>v.userId)});
  const m=await Test.createTestingModule({imports:[AuthModule],controllers:[WordOrganizationController],providers:[WordOrganizationService,WordAccessService,PrismaService]}).overrideProvider(PrismaService).useValue(db).overrideProvider(AuthService).useValue({authenticate:async(token:string)=>{const user=token==='a'.repeat(43)?userA:token==='b'.repeat(43)?userB:token==='c'.repeat(43)?admin:null;if(!user)throw new UnauthorizedException();return{user,sessionId:'qa'}}}).compile();
  app=m.createNestApplication();app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address()as AddressInfo).port}/api/v1`;
 });
 afterEach(async()=>app?.close());
 const request=(path='/words/shared/organization',method='GET',body?:unknown,actor='a')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${actor.repeat(43)}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const payload=()=>({books:[{title:'My book',lessonNumbers:[2,1]}],tags:['Exam'],bookRevision:null,tagsRevision:null,lessonNameUpdates:[{book:'My book',lessonNumber:1,name:'Arbeit'}],settingsRevision:null});
 it('requires authentication and current membership even for ADMIN; missing schema is explicit',async()=>{
  expect((await request(undefined,'GET',undefined,'')).status).toBe(401);expect((await request(undefined,'GET',undefined,'c')).status).toBe(404);ready=false;expect((await request()).status).toBe(503);
 });
 it('saves normalized own materials and isolates another user',async()=>{
  const r=await request(undefined,'PUT',payload());expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');const d=await r.json();expect(d.books).toEqual([{title:'My book',lessonNumbers:[1,2]}]);expect(d.tags).toEqual(['Exam']);expect(d.lessonNames[0].name).toBe('Arbeit');
  const other=await(await request(undefined,'GET',undefined,'b')).json();expect(other.books).toEqual([]);expect(other.tags).toEqual([]);expect(other.lessonNames).toEqual([]);expect((await request(undefined,'PUT',payload())).status).toBe(409);
 });
 it('rejects duplicate and invalid materials, omitted revisions and ownership fields',async()=>{
  for(const body of [{...payload(),books:[{title:12,lessonNumbers:[1]}]},{...payload(),userId:userB.id},{...payload(),books:[{title:'B',lessonNumbers:[0]}]},{...payload(),tags:['Exam','exam']},{...payload(),tags:['x'.repeat(41)]},{...payload(),bookRevision:undefined},{...payload(),lessonNameUpdates:[{book:'Elsewhere',lessonNumber:1,name:'No'}]}])expect((await request(undefined,'PUT',body)).status).toBe(400);
 });
 it('keeps color private, validates hex and rejects stale settings revisions',async()=>{
  expect((await request('/dictionary-organization/settings','PATCH',{neutralColor:'red',revision:null})).status).toBe(400);
  const r=await request('/dictionary-organization/settings','PATCH',{neutralColor:'#12AB34',revision:null});expect(r.status).toBe(200);const d=await r.json();expect(d.neutralColor).toBe('#12ab34');
  expect((await(await request('/dictionary-organization/settings','GET',undefined,'b')).json()).neutralColor).toBeNull();expect((await request('/dictionary-organization/settings','PATCH',{neutralColor:null,revision:null})).status).toBe(409);expect((await request('/dictionary-organization/settings','PATCH',{neutralColor:null,revision:d.revision})).status).toBe(200);
 });
});
