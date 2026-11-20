import { StudyService } from "../src/study/study.service";
import { PrismaService } from "../src/prisma.service";
import { makeStudyDatabase } from "./support/study-database";
describe("Personal daily new-word plan",()=>{
 afterEach(()=>jest.useRealTimers());
 it("counts first saved answers in the account day, not repeated answers, other users or future data",async()=>{
  jest.useFakeTimers({now:new Date('2026-11-20T12:00:00Z')});const f=makeStudyDatabase();
  f.db.user.findUnique.mockResolvedValue({timeZone:'Europe/Berlin',dailyGoal:20,newWordsDailyGoal:1});
  for(const id of ['old','new','edge','other','future']){f.seedWord(id);f.link('a',id)}
  const seed=(id:string,userId:string,wordId:string,date:string)=>{f.sessions.set(id,{id,userId,startedAt:new Date(date)});f.answers.set(id,{id,sessionId:id,wordId,answeredAt:new Date(date),answer:'KNOWN'})};
  seed('old-first','a','old','2026-11-18T12:00:00Z');seed('old-repeat','a','old','2026-11-20T10:00:00Z');
  seed('new-first','a','new','2026-11-20T10:00:00Z');seed('new-repeat','a','new','2026-11-20T11:00:00Z');
  seed('edge-first','a','edge','2026-11-19T23:00:00Z');seed('other-first','b','other','2026-11-20T10:00:00Z');seed('future-first','a','future','2026-11-21T10:00:00Z');
  f.unlink('a','new');const study=new StudyService(f.db as unknown as PrismaService);
  expect(await study.getProgress('a')).toMatchObject({newWordsDailyGoal:1,newWordsStudiedToday:2,studyDate:'2026-11-20'});
  expect(f.db.wordProgress.upsert).not.toHaveBeenCalled();
  f.db.user.findUnique.mockResolvedValue({timeZone:'UTC',dailyGoal:20,newWordsDailyGoal:1});
  expect(await study.getProgress('a')).toMatchObject({newWordsStudiedToday:1});
 });
 it("allows studying beyond the personal plan and idempotent replay does not inflate the count",async()=>{
  jest.useFakeTimers({now:new Date('2026-11-20T12:00:00Z')});const f=makeStudyDatabase();f.db.user.findUnique.mockResolvedValue({timeZone:'UTC',dailyGoal:20,newWordsDailyGoal:1});
  for(const id of ['a','b']){f.seedWord(id);f.link('owner',id)}
  const study=new StudyService(f.db as unknown as PrismaService),body={totalWords:2,words:[{wordId:'a',answer:'KNOWN' as const},{wordId:'b',answer:'NEEDS_REVIEW' as const}]};
  await study.createSession('owner',body,'personal-plan-01');await study.createSession('owner',body,'personal-plan-01');
  expect(await study.getProgress('owner')).toMatchObject({newWordsDailyGoal:1,newWordsStudiedToday:2,totalSessions:1});
 });
});
