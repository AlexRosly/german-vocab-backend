import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { PrismaService } from "../src/prisma.service";
import { AuthService } from "../src/auth/auth.service";
import { AuthModule } from "../src/auth/auth.module";
import { WordAccessService } from "../src/words/word-access.service";
import { PersonalExampleTranslationsController } from "../src/words/personal-example-translations.controller";
import { PersonalExampleTranslationsService } from "../src/words/personal-example-translations.service";
import { admin, userA, userB } from "./support/words-database";

describe("Personal example translations HTTP: revisions, ownership, validation", () => {
  let app: INestApplication, base: string, ready: boolean;
  const rows = new Map<string, any>();
  const key = (k: any) => JSON.stringify([k.userId,k.exampleId,k.language]);
  beforeEach(async () => {
    rows.clear(); ready = true;
    const db: any = { $transaction: async (fn: any) => fn(db), $queryRaw: async () => [{ready}],
      wordExample: {findFirst: async ({where}:any) => where.id === 'e' && where.wordId === 'word' ? {id:'e',german:'Das Haus ist groß.',translations:[{text:'Общий перевод.'}]} : null},
      personalExampleTranslation: {
        findUnique: async ({where}:any) => rows.get(key(where.userId_exampleId_language)) ?? null,
        create: async ({data}:any) => {rows.set(key(data),{...data});return data},
        updateMany: async ({where,data}:any) => {const row=rows.get(key(where));if(!row||row.revision!==where.revision)return {count:0};Object.assign(row,data);return {count:1}},
        deleteMany: async ({where}:any) => {const row=rows.get(key(where));if(!row||row.revision!==where.revision)return {count:0};rows.delete(key(where));return {count:1}},
      }};
    const module = await Test.createTestingModule({imports:[AuthModule],controllers:[PersonalExampleTranslationsController],providers:[PersonalExampleTranslationsService,WordAccessService,PrismaService]})
      .overrideProvider(PrismaService).useValue(db).overrideProvider(AuthService).useValue({authenticate:async(token:string)=>{
        const user=token==='a'.repeat(43)?userA:token==='b'.repeat(43)?userB:token==='c'.repeat(43)?admin:null;
        if(!user)throw new UnauthorizedException();return {user,sessionId:'qa'};
      }}).compile();
    app=module.createNestApplication();app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/words`;
  });
  afterEach(async()=>app?.close());
  const request=(method='GET',body?:unknown,actor='a',suffix='/word/examples/e/personal-translations/ru')=>fetch(base+suffix,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${actor.repeat(43)}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const payload=(text='Мой большой дом',revision:string|null=null)=>({text,revision,sourceGerman:'Das Haus ist groß.'});
  it('rejects unauthenticated, invalid parameters, extra ownership fields and missing revisions',async()=>{
    expect((await request('GET',undefined,'')).status).toBe(401);
    for(const body of [{text:'x',sourceGerman:'x'},{...payload(),userId:userB.id},{...payload(),text:'x'.repeat(1001)},{...payload(),sourceGerman:''}])expect((await request('PUT',body)).status).toBe(400);
    expect((await request('GET',undefined,'a','/word/examples/e/personal-translations/xx')).status).toBe(400);
  });
  it('isolates values by account and language and prevents stale revision overwrites',async()=>{
    const first=await request('PUT',payload());expect(first.status).toBe(200);expect(first.headers.get('Cache-Control')).toBe('no-store');const value=await first.json();
    expect(value.stale).toBe(false);expect(value.sourceGerman).toBe('Das Haus ist groß.');
    for(const actor of ['b','c'])expect((await (await request('GET',undefined,actor)).json()).text).toBeNull();
    expect((await request('PUT',payload('lost update'))).status).toBe(409);
    expect((await request('PUT',{...payload('x',value.revision),sourceGerman:'Old sentence'})).status).toBe(409);
    const cleared=await request('PUT',payload(' ',value.revision));expect((await cleared.json()).text).toBeNull();expect(rows.size).toBe(0);
  });
  it('does not make missing schema or another word/example combination look like an empty translation',async()=>{
    expect((await request('GET',undefined,'a','/wrong/examples/e/personal-translations/ru')).status).toBe(404);
    ready=false;expect((await request()).status).toBe(503);expect(rows.size).toBe(0);
  });
});
