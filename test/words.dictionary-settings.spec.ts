import "reflect-metadata";
import { INestApplication, UnauthorizedException, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { AddressInfo } from "node:net";
import { AppModule } from "../src/app.module";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma.service";
import { makeWordsDatabase, userA, userB, admin } from "./support/words-database";
describe("Personal dictionary settings HTTP", () => {
  let app: INestApplication, url: string, fixture: ReturnType<typeof makeWordsDatabase>;
  beforeEach(async () => {
    fixture=makeWordsDatabase(); fixture.seedWord("shared"); fixture.seedWord("private",{createdByUserId:userA.id,publicationStatus:"PENDING_REVIEW"});
    const module=await Test.createTestingModule({imports:[AppModule]}).overrideProvider(PrismaService).useValue(fixture.db)
      .overrideProvider(AuthService).useValue({authenticate:async(token:string)=>{
        const user=token==="a".repeat(43)?userA:token==="b".repeat(43)?userB:token==="c".repeat(43)?admin:null;
        if(!user)throw new UnauthorizedException();return {user,sessionId:`session-${user.id}`};
      }}).compile();
    app=module.createNestApplication();app.setGlobalPrefix("api/v1");app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    await app.listen(0,"127.0.0.1");url=`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/words`;
  });
  afterEach(async()=>{await app?.close();});
  const request=(path:string,method="GET",body?:unknown,actor="a")=>fetch(url+path,{method,headers:{"Content-Type":"application/json",...(actor?{Authorization:`Bearer ${actor.repeat(43)}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const endpoint=(id="shared")=>`/${id}/dictionary-settings`;
  const link=async(actor="a",id="shared")=>expect((await request(`/${id}/dictionary`,"POST",undefined,actor)).status).toBe(200);
  const state=async(actor="a",id="shared")=>{const r=await request(endpoint(id),"GET",undefined,actor);expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");return r.json();};
  const save=(revision:string,patch:object,actor="a",id="shared")=>request(endpoint(id),"PUT",{revision,...patch},actor);
  it("requires authentication, active own membership and visibility even for ADMIN",async()=>{
    for(const method of ["GET","PUT"])expect((await request(endpoint(),method,method==="PUT"?{revision:"r",isFavorite:true}:undefined,"")).status).toBe(401);
    for(const actor of ["a","b","c"]){expect((await request(endpoint(),"GET",undefined,actor)).status).toBe(404);expect((await save("r",{isArchived:true},actor)).status).toBe(404);}
    fixture.links.set("bad",{id:"bad",userId:admin.id,wordId:"private"});expect((await request(endpoint("private"),"GET",undefined,"c")).status).toBe(404);
    expect(fixture.db.userWord.updateMany).not.toHaveBeenCalled();
  });
  it("isolates flags per user and exposes only the caller's settings in mine",async()=>{
    for(const actor of ["a","b","c"])await link(actor);
    const a=await state();expect(a).toEqual({wordId:"shared",isFavorite:false,isArchived:false,revision:expect.any(String)});
    expect((await save(a.revision,{isFavorite:true})).status).toBe(200);
    expect((await state("b")).isFavorite).toBe(false);expect((await state("c")).isFavorite).toBe(false);
    const mine=await (await request("/mine")).json();expect(mine[0].dictionaryEntry).toEqual({isFavorite:true,isArchived:false,revision:expect.any(String)});
    expect(mine[0]).not.toHaveProperty("userWords");expect(JSON.stringify(mine)).not.toContain('"user-b"');
    for(const path of ["","/shared"])expect(JSON.stringify(await (await request(path)).json())).not.toContain("dictionaryEntry");
  });
  it("archives and restores without modifying shared data, personal translations or favorite",async()=>{
    await link();const original=structuredClone(fixture.words.get("shared"));
    fixture.privateTranslations.set("private-a",{userId:userA.id,wordId:"shared",language:"ru",text:"KEEP_PRIVATE",revision:"private-rev"});
    const before=await state();const archived=await (await save(before.revision,{isFavorite:true,isArchived:true})).json();
    expect(archived).toMatchObject({isFavorite:true,isArchived:true});expect(archived.revision).not.toBe(before.revision);
    const mine=await (await request("/mine")).json();expect(mine).toHaveLength(1);expect(mine[0].dictionaryEntry.isArchived).toBe(true);expect(mine[0].selectedTranslation.text).toBe("KEEP_PRIVATE");
    const restored=await (await save(archived.revision,{isArchived:false})).json();expect(restored).toMatchObject({isFavorite:true,isArchived:false});
    expect(fixture.words.get("shared")).toEqual(original);expect(fixture.privateTranslations.size).toBe(1);
  });
  it("does not silently restore an archived entry when library add is repeated",async()=>{
    await link();const before=await state();await save(before.revision,{isArchived:true});const archived=await state();await link();expect(await state()).toEqual(archived);
  });
  it("rejects stale writes and conditional-write races rather than overwriting another tab",async()=>{
    await link();const before=await state();const updated=await (await save(before.revision,{isFavorite:true})).json();
    expect((await save(before.revision,{isArchived:true})).status).toBe(409);expect(await state()).toEqual(updated);
    fixture.db.userWord.updateMany.mockResolvedValueOnce({count:0});expect((await save(updated.revision,{isFavorite:false})).status).toBe(409);expect(await state()).toEqual(updated);
  });
  it("validates booleans, revision and owner injection before writes",async()=>{
    await link();const before=await state();
    for(const body of [{},{revision:before.revision},{isFavorite:true},{revision:null,isFavorite:true},{revision:before.revision,isFavorite:"false"},{revision:before.revision,isArchived:null},{revision:before.revision,isArchived:true,userId:userB.id},{revision:before.revision,isFavorite:true,role:"ADMIN"}])expect((await request(endpoint(),"PUT",body)).status).toBe(400);
    expect(fixture.db.userWord.updateMany).not.toHaveBeenCalled();
  });
  it("allows own pending cards and rejects hidden foreign cards without publishing",async()=>{
    await link("a","private");const before=await state("a","private");expect((await save(before.revision,{isArchived:true},"a","private")).status).toBe(200);
    expect(fixture.words.get("private")!.publicationStatus).toBe("PENDING_REVIEW");
    await link("b");fixture.words.get("shared")!.publicationStatus="REJECTED";expect((await request(endpoint(),"GET",undefined,"b")).status).toBe(404);
  });
});
