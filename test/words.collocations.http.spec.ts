import "reflect-metadata";
import {INestApplication,UnauthorizedException,ValidationPipe} from "@nestjs/common";
import {Test} from "@nestjs/testing";
import type {AddressInfo} from "node:net";
import {AuthModule} from "../src/auth/auth.module";
import {AuthService} from "../src/auth/auth.service";
import {PrismaService} from "../src/prisma.service";
import {WordAccessService} from "../src/words/word-access.service";
import {WordsService} from "../src/words/words.service";
import {PersonalTranslationsService} from "../src/words/personal-translations.service";
import {WordsController} from "../src/words/words.controller";
import {CollocationsConfigController,CollocationsController} from "../src/words/collocations.controller";
import {CollocationsService} from "../src/words/collocations.service";
import {admin,userA,userB} from "./support/words-database";
import {makeCollocationsDatabase} from "./support/collocations-database";
const body={verbWordId:'verb',german:'mit dem Arbeitgeber sprechen',grammarNote:'mit + Dativ',translations:[{language:'ru',text:'говорить с работодателем'},{language:'en',text:'speak with the employer'}]};
describe('Noun–verb combinations HTTP (real services, mocked persistence)',()=>{
 let app:INestApplication,base:string,fixture:ReturnType<typeof makeCollocationsDatabase>;
 beforeEach(async()=>{
  fixture=makeCollocationsDatabase();fixture.seedWord('noun',{german:'Arbeitgeber'});
  fixture.seedWord('private-noun',{german:'Chef',publicationStatus:'PENDING_REVIEW',createdByUserId:userB.id});
  fixture.seedWord('verb',{german:'sprechen',article:'none',grammaticalNumber:'not_applicable',verbForms:[{praeteritum:'sprach',participle2:'gesprochen',auxiliary:'HABEN',reflexive:false,usage:null}]});
  fixture.seedWord('other-verb',{german:'reden',article:'none',grammaticalNumber:'not_applicable',verbForms:[{praeteritum:'redete',participle2:'geredet',auxiliary:'HABEN',reflexive:false,usage:null}]});
  fixture.seedWord('private-verb',{german:'fragen',article:'none',grammaticalNumber:'not_applicable',verbForms:[{praeteritum:'fragte',participle2:'gefragt',auxiliary:'HABEN',reflexive:false,usage:null}],publicationStatus:'PENDING_REVIEW',createdByUserId:userB.id});
  fixture.seedWord('adverb',{german:'heute',article:'none',grammaticalNumber:'not_applicable'});
  const module=await Test.createTestingModule({imports:[AuthModule],controllers:[WordsController,CollocationsController,CollocationsConfigController],providers:[WordsService,PersonalTranslationsService,WordAccessService,PrismaService,CollocationsService]})
   .overrideProvider(PrismaService).useValue(fixture.db).overrideProvider(AuthService).useValue({authenticate:async(token:string)=>{const user=token==='a'.repeat(43)?userA:token==='b'.repeat(43)?userB:token==='c'.repeat(43)?admin:token==='e'.repeat(43)?{...userA,translationLanguage:'en'}:null;if(!user)throw new UnauthorizedException();return {user,sessionId:'test'}}}).compile();
  app=module.createNestApplication();app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
 });
 afterEach(async()=>app?.close());
 const route=(noun='noun',id?:string)=>`/words/${noun}/collocations${id?'/'+id:''}`;
 function request(path=route(),method='GET',data?:unknown,actor='a'){return fetch(base+path,{method,headers:{'content-type':'application/json',...(actor?{authorization:`Bearer ${actor.repeat(43)}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});}
 async function create(data:unknown=body,noun='noun'){const response=await request(route(noun),'POST',data,'c');expect(response.status).toBe(201);return response.json();}
 it('requires authorization and allows writes only to ADMIN',async()=>{
  for(const [path,method,data]of [['/collocations/config','GET',undefined],[route(),'GET',undefined],[route(),'POST',body],[route('noun','id'),'PATCH',{revision:'x'}],[route('noun','id'),'DELETE',{revision:'x'}]]as const)expect((await request(path,method,data,'')).status).toBe(401);
  expect((await request(route(),'POST',body)).status).toBe(403);expect((await request(route('noun','id'),'PATCH',{revision:'x'})).status).toBe(403);expect((await request(route('noun','id'),'DELETE',{revision:'x'})).status).toBe(403);
  expect(fixture.collocations.size).toBe(0);expect(fixture.db.word.updateMany).not.toHaveBeenCalled();
 });
 it('normalizes a phrase, keeps both links and translations, and permits German-only combinations',async()=>{
  const row=await create({...body,german:'  mit  dem Arbeitgeber sprechen  '});expect(row.german).toBe(body.german);expect(row.noun.id).toBe('noun');expect(row.verb.id).toBe('verb');expect(row.selectedTranslation.text).toBe(body.translations[0].text);
  const noun=await request();expect(noun.headers.get('cache-control')).toBe('no-store');expect((await noun.json()).items[0].id).toBe(row.id);
  const inverse=await (await request(route('verb'))).json();expect(inverse.kind).toBe('verb');expect(inverse.items[0].id).toBe(row.id);
  const onlyGerman=await create({verbWordId:'verb',german:'mit einem Arbeitgeber sprechen'});expect(onlyGerman.selectedTranslation.text).toBeNull();expect(onlyGerman.translations).toEqual([]);
 });
 it('filters both endpoints on every read and never substitutes Russian for a missing selected language',async()=>{
  await create();await create({...body,verbWordId:'private-verb',german:'den Arbeitgeber fragen'});await create(body,'private-noun');
  expect((await (await request()).json()).total).toBe(1);expect((await (await request(route(),'GET',undefined,'b')).json()).total).toBe(2);expect((await request(route('private-noun'))).status).toBe(404);
  const privateList=await (await request(route('private-noun'),'GET',undefined,'b')).json();expect(privateList.total).toBe(1);
  const publicRow=await (await request()).json();const id=publicRow.items[0].id;
  fixture.collocationTranslations.forEach((row,key)=>{if(row.language==='en')fixture.collocationTranslations.delete(key)});
  const en=await (await request(route('noun',id),'GET',undefined,'e')).json();expect(en.selectedTranslation).toEqual({language:'en',text:null});
  fixture.words.get('verb')!.publicationStatus='REJECTED';expect((await (await request()).json()).total).toBe(0);
 });
 it('rejects bad types, malformed bodies and case/space duplicates without leaving partial writes',async()=>{
  for(const data of [{...body,german:''},{...body,german:'a'.repeat(501)},{...body,german:'x\u0000y'},{...body,verbWordId:'noun'},{...body,verbWordId:'adverb'},{...body,translations:null},{...body,translations:[{language:'zz',text:'bad'}]},{...body,translations:[{language:'ru',text:'one'},{language:'ru',text:'two'}]}])expect((await request(route(),'POST',data,'c')).status).toBe(400);
  expect((await request(route('adverb'),'POST',body,'c')).status).toBe(400);expect(fixture.collocations.size).toBe(0);
  await create();const saved=structuredClone([...fixture.words]);
  expect((await request(route(),'POST',{...body,german:'MIT DEM  ARBEITGEBER SPRECHEN'},'c')).status).toBe(409);expect(fixture.collocations.size).toBe(1);expect([...fixture.words]).toEqual(saved);
 });
 it('preserves unrelated languages, rejects stale edits and safely reloads the current row',async()=>{
  const row=await create();const response=await request(route('noun',row.id),'PATCH',{revision:row.revision,translations:[{language:'en',text:'talk with the employer'}]},'c');expect(response.status).toBe(200);const changed=await response.json();expect(changed.revision).not.toBe(row.revision);expect(changed.selectedTranslation.text).toBe(body.translations[0].text);
  const saved=structuredClone([...fixture.words]);expect((await request(route('noun',row.id),'PATCH',{revision:row.revision,german:'wrong'},'c')).status).toBe(409);expect([...fixture.words]).toEqual(saved);
  expect((await (await request(route('noun',row.id))).json()).revision).toBe(changed.revision);
  const removed=await (await request(route('noun',row.id),'PATCH',{revision:changed.revision,translations:[{language:'ru',text:null}]},'c')).json();expect(removed.selectedTranslation.text).toBeNull();expect(removed.translations).toEqual([{language:'en',text:'talk with the employer'}]);
 });
 it('protects word classification, invalidates moderation timestamps, and deletes only the selected combination',async()=>{
  const before=fixture.words.get('noun')!.updatedAt;await new Promise(resolve=>setTimeout(resolve,2));const row=await create();expect(fixture.words.get('noun')!.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  expect((await request('/words/noun','PATCH',{article:'none',grammaticalNumber:'not_applicable'},'c')).status).toBe(400);
  expect((await request('/words/verb','PATCH',{isVerb:false},'c')).status).toBe(400);
  expect((await request(route('noun',row.id),'DELETE',{revision:'stale'},'c')).status).toBe(409);
  expect((await request(route('verb',row.id),'DELETE',{revision:row.revision},'c')).status).toBe(404);
  expect((await request(route('noun',row.id),'DELETE',{revision:row.revision},'c')).status).toBe(200);expect(fixture.collocations.size).toBe(0);expect(fixture.collocationTranslations.size).toBe(0);expect(fixture.words.size).toBe(6);
  expect((await request('/words/verb','PATCH',{isVerb:false},'c')).status).toBe(200);
 });
 it('paginates and reports unavailable schema without changing content',async()=>{
  for(let n=0;n<21;n++)await create({...body,german:'mit dem Arbeitgeber sprechen '+n});
  const first=await (await request()).json(),second=await (await request(route()+'?page=2')).json();expect(first.total).toBe(21);expect(first.items).toHaveLength(20);expect(first.hasNext).toBe(true);expect(second.items).toHaveLength(1);
  expect((await request(route()+'?page=0')).status).toBe(400);
  fixture.db.$queryRaw.mockResolvedValueOnce([{enabled:false}]);expect((await request()).status).toBe(503);
 });
});
