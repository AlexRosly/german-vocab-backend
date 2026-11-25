import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { GoogleAuthService } from "../src/auth/google-auth.service";
import { AccountArchiveService } from "../src/auth/account-archive.service";
import { PrismaService } from "../src/prisma.service";
describe('Account archive HTTP boundary',()=>{
 let app:INestApplication,base:string,service:any,google:any,auth:any;
 const user={id:'a',email:'a@example.test',emailVerified:null,role:'USER',interfaceLanguage:'ru',translationLanguage:'ru'},nonce='n'.repeat(43),token='a'.repeat(43),identity={subject:'google-a',email:user.email,authoritativeEmail:true};
 beforeEach(async()=>{
  service={config:jest.fn().mockResolvedValue({enabled:true,password:true,google:true}),archive:jest.fn().mockResolvedValue(undefined)};
  google={config:()=>({enabled:true}),issue:jest.fn().mockResolvedValue({enabled:true,clientId:'123-test.apps.googleusercontent.com',nonce,expiresAt:new Date(Date.now()+600000)}),verify:jest.fn().mockResolvedValue(identity)};
  auth={authenticate:jest.fn(async(t:string)=>{if(t!==token)throw new UnauthorizedException();return{user,sessionId:'s'}}),login:jest.fn().mockResolvedValue({user,accessToken:token,refreshToken:'r'.repeat(43),accessExpiresAt:new Date(Date.now()+600000),refreshExpiresAt:new Date(Date.now()+600000)}),signInWithGoogle:jest.fn().mockResolvedValue({user,accessToken:token,refreshToken:'r'.repeat(43),accessExpiresAt:new Date(Date.now()+600000),refreshExpiresAt:new Date(Date.now()+600000)})};
  const module=await Test.createTestingModule({imports:[AuthModule]}).overrideProvider(PrismaService).useValue({}).overrideProvider(AuthService).useValue(auth).overrideProvider(GoogleAuthService).useValue(google).overrideProvider(AccountArchiveService).useValue(service).compile();app=module.createNestApplication();app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address()as AddressInfo).port}/api/v1`;
 });
 afterEach(async()=>app?.close());
 const request=(path:string,method='GET',body?:unknown,headers:Record<string,string>={})=>fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 it('requires an authenticated owner and never accepts a target user ID',async()=>{
  expect((await request('/auth/account/archive-config','GET',undefined,{Authorization:''})).status).toBe(401);
  const r=await request('/auth/account/archive-config');expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(service.config).toHaveBeenCalledWith('a');
  expect((await request('/auth/account/archive','POST',{confirmation:'ARCHIVE',method:'password',password:'password',userId:'b'})).status).toBe(400);expect(service.archive).not.toHaveBeenCalled();
 });
 it('validates explicit confirmation and clears sign-in cookies only after success',async()=>{
  for(const body of [{confirmation:'DELETE',method:'password',password:'password'},{confirmation:'ARCHIVE',method:'password'},{confirmation:'ARCHIVE',method:'google',credential:'invalid'}])expect((await request('/auth/account/archive','POST',body)).status).toBe(400);
  const dto={confirmation:'ARCHIVE',method:'password',password:'password'};const r=await request('/auth/account/archive','POST',dto);expect(r.status).toBe(204);expect(service.archive).toHaveBeenCalledWith('a',dto,undefined);expect(r.headers.get('set-cookie')).toContain('wortkarten_refresh=;');
 });
 it('uses a separate one-time Google archive purpose bound to the current owner',async()=>{
  const challenge=await request('/auth/account/archive-challenge','POST');expect(challenge.status).toBe(200);expect(google.issue).toHaveBeenCalledWith('archive','a');
  const dto={confirmation:'ARCHIVE',method:'google',credential:'a.b.c'};expect((await request('/auth/account/archive','POST',dto,{Cookie:'wortkarten_google_nonce='+nonce})).status).toBe(204);expect(google.verify).toHaveBeenCalledWith('a.b.c',nonce,'archive','a');expect(service.archive).toHaveBeenCalledWith('a',dto,identity);
 });
 it('restoration is a distinct explicit authenticated-by-proof route, not registration',async()=>{
  const dto={email:'a@example.test',password:'Synthetic password 123!'};expect((await request('/auth/restore','POST',dto,{Authorization:''})).status).toBe(200);expect(auth.login).toHaveBeenCalledWith(dto,true);
  expect((await request('/auth/google/restore-challenge','POST',undefined,{Authorization:''})).status).toBe(200);expect(google.issue).toHaveBeenCalledWith('restore',undefined);
  expect((await request('/auth/google/restore','POST',{credential:'a.b.c'},{Authorization:'',Cookie:'wortkarten_google_nonce='+nonce})).status).toBe(200);expect(google.verify).toHaveBeenCalledWith('a.b.c',nonce,'restore');expect(auth.signInWithGoogle).toHaveBeenCalledWith(identity,true);
 });
 it('rejects a foreign browser origin before any archive action',async()=>{expect((await request('/auth/account/archive','POST',{confirmation:'ARCHIVE',method:'password',password:'password'},{Origin:'https://untrusted.test'})).status).toBe(403);expect(service.archive).not.toHaveBeenCalled()});
});
