import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { UpdatePreferencesDto } from "../src/preferences/dto/update-preferences.dto";
import { PreferencesService } from "../src/preferences/preferences.service";
import { PrismaService } from "../src/prisma.service";
import { makeLanguageUsers } from "./support/language-users";
import { userA, userB } from "./support/words-database";
describe('Personal new words daily goal preferences',()=>{
 it('persists only for the owner, preserving the overall goal and unrelated updates',async()=>{
  const store=makeLanguageUsers(),service=new PreferencesService({user:store.model} as unknown as PrismaService);
  expect(await service.update(userA.id,{newWordsDailyGoal:3})).toMatchObject({newWordsDailyGoal:3,dailyGoal:10});
  expect(await service.update(userA.id,{interfaceLanguage:'de'})).toMatchObject({newWordsDailyGoal:3,dailyGoal:10});
  expect(await service.get(userB.id)).toMatchObject({newWordsDailyGoal:10,dailyGoal:10});
 });
 it('rejects malformed values at HTTP validation and service boundaries',()=>{
  const store=makeLanguageUsers(),service=new PreferencesService({user:store.model} as unknown as PrismaService);
  for(const value of [null,0,501,1.5,'10']){
   expect(validateSync(plainToInstance(UpdatePreferencesDto,{newWordsDailyGoal:value})).length).toBeGreaterThan(0);
   expect(()=>service.update(userA.id,{newWordsDailyGoal:value} as unknown as UpdatePreferencesDto)).toThrow(BadRequestException);
  }
  for(const value of [1,500])expect(validateSync(plainToInstance(UpdatePreferencesDto,{newWordsDailyGoal:value}))).toHaveLength(0);
  expect(store.model.update).not.toHaveBeenCalled();
 });
});
