import "reflect-metadata";
import { Controller, Get, INestApplication, UnauthorizedException, UseGuards, ValidationPipe } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AuthModule } from "../src/auth/auth.module";
import { AuthService } from "../src/auth/auth.service";
import { AuthGuard } from "../src/auth/auth.guard";
import { PrismaService } from "../src/prisma.service";
import { WordAuditController } from "../src/audit/word-audit.controller";
import { WordAuditService } from "../src/audit/word-audit.service";
import { auditActor, AuditActorInterceptor } from "../src/audit/audit-context";
@Controller('audit-context-test') @UseGuards(AuthGuard)
class ContextController { @Get() async get(){const first=auditActor.getStore();await new Promise(resolve=>setTimeout(resolve,5));return{first,current:auditActor.getStore()}} }
describe('Shared audit HTTP access and request attribution',()=>{
 let app:INestApplication,base:string,service:any;
 beforeEach(async()=>{service={ready:jest.fn().mockResolvedValue(true),list:jest.fn().mockResolvedValue({page:1,pageSize:25,total:0,items:[]})};const module=await Test.createTestingModule({imports:[AuthModule],controllers:[WordAuditController,ContextController],providers:[{provide:WordAuditService,useValue:service},{provide:APP_INTERCEPTOR,useClass:AuditActorInterceptor}]}).overrideProvider(PrismaService).useValue({}).overrideProvider(AuthService).useValue({authenticate:async(token:string)=>{const id=token==='a'.repeat(43)?'a':token==='b'.repeat(43)?'b':null;if(!id)throw new UnauthorizedException();return{user:{id,role:id==='a'?'ADMIN':'USER'},sessionId:'session'}}}).compile();app=module.createNestApplication();app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${(app.getHttpServer().address()as AddressInfo).port}/api/v1`});
 afterEach(async()=>app?.close());
 const get=(path='/word-audit',actor='a')=>fetch(base+path,{headers:actor?{Authorization:'Bearer '+actor.repeat(43)}:{}});
 it('restricts config and history to ADMIN and avoids caching',async()=>{expect((await get('/word-audit','')).status).toBe(401);expect((await get('/word-audit/config','b')).status).toBe(403);expect((await get('/word-audit','b')).status).toBe(403);const r=await get('/word-audit?page=1&search=Haus');expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(service.list).toHaveBeenCalledWith({page:1,search:'Haus'})});
 it('rejects unbounded pagination, foreign owner selectors and malformed word IDs',async()=>{for(const q of ['page=0','page=10001','userId=b','wordId=../x'])expect((await get('/word-audit?'+q)).status).toBe(400);expect(service.list).not.toHaveBeenCalled()});
 it('keeps simultaneous actor contexts isolated without trusting a payload actor',async()=>{const [a,b]=await Promise.all([get('/audit-context-test','a'),get('/audit-context-test','b')]);expect(await a.json()).toEqual({first:{id:'a',role:'ADMIN'},current:{id:'a',role:'ADMIN'}});expect(await b.json()).toEqual({first:{id:'b',role:'USER'},current:{id:'b',role:'USER'}});expect(auditActor.getStore()).toBeUndefined()});
});
