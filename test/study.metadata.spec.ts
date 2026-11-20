import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { StudyService } from "../src/study/study.service";
import { PrismaService } from "../src/prisma.service";
import { makeStudyDatabase } from "./support/study-database";
describe('Saved practice mode and historical schedule',()=>{
 afterEach(()=>jest.useRealTimers());
 it('persists mode and the assigned schedule without changing the common SRS',async()=>{
  jest.useFakeTimers({now:new Date('2026-11-20T12:00:00Z')});const f=makeStudyDatabase();f.seedWord('w');f.link('owner','w');
  const service=new StudyService(f.db as unknown as PrismaService);
  const body={totalWords:1,mode:'plural' as const,words:[{wordId:'w',answer:'KNOWN' as const}]};
  const first=await service.createSession('owner',body,'metadata-key-0001');
  expect(first.mode).toBe('plural');expect(first.words[0].answeredAt.toISOString()).toBe('2026-11-20T12:00:00.000Z');
  expect(first.words[0].nextReviewAt).toEqual(f.progressFor('owner','w')!.nextReviewAt);
  expect(f.progressFor('owner','w')!.currentIntervalDays).toBe(1);
  const frozen=structuredClone(first.words[0]);jest.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  await service.createSession('owner',{...body,mode:'spelling'},'metadata-key-0002');
  expect(f.progressFor('owner','w')!.currentIntervalDays).toBe(3);
  const historical=await service.getHistorySession('owner',first.id);
  expect(historical.words[0]).toEqual(frozen);
  await expect(service.getHistorySession('other',first.id)).rejects.toBeInstanceOf(NotFoundException);
  expect((await service.createSession('owner',body,'metadata-key-0001')).words[0]).toEqual(frozen);
  await expect(service.createSession('owner',{...body,mode:'forward'},'metadata-key-0001')).rejects.toBeInstanceOf(ConflictException);
 });
 it('keeps absent mode unknown and rejects invalid modes without writing',async()=>{
  const f=makeStudyDatabase();f.seedWord('w');f.link('owner','w');const service=new StudyService(f.db as unknown as PrismaService);
  const body={totalWords:1,words:[{wordId:'w',answer:'NEEDS_REVIEW' as const}]};
  expect((await service.createSession('owner',body)).mode).toBeNull();const size=f.sessions.size;
  for(const mode of [null,'wrong',1,'FORWARD'])await expect(service.createSession('owner',{...body,mode} as never)).rejects.toBeInstanceOf(BadRequestException);
  expect(f.sessions.size).toBe(size);
 });
});
