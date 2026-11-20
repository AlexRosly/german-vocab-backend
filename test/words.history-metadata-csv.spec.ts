import { Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { exportHistory } from "../src/dictionary-export/study-history-csv";
describe('Historical metadata CSV compatibility',()=>{
 it('appends mode and the saved next date, leaving unknown legacy values blank',async()=>{
  const when=new Date('2026-11-20T12:00:00Z'),next=new Date('2026-11-21T12:00:00Z');
  const sessions=[{id:'old',startedAt:when,completedAt:when,totalWords:1,knownCount:1,needsReviewCount:0,mode:null},{id:'new',startedAt:when,completedAt:when,totalWords:1,knownCount:1,needsReviewCount:0,mode:'spelling'}];
  const answers=sessions.map((session,n)=>({id:'a'+n,wordId:'w',answer:'KNOWN',answeredAt:when,nextReviewAt:n?next:null,session}));
  const tx={studySession:{count:async()=>2,findMany:async()=>sessions},studySessionWord:{count:async()=>2,findMany:async()=>answers},word:{findMany:async()=>[{id:'w',german:'Haus',article:'das'}]}} as unknown as Prisma.TransactionClient;
  const read=(csv:string)=>parse(csv,{bom:true,delimiter:';',columns:true}) as Record<string,string>[];
  const summary=read((await exportHistory(tx,'owner','sessions',{})).csv);
  expect(summary.map(row=>row.mode)).toEqual(['','spelling']);
  const rows=read((await exportHistory(tx,'owner','answers',{})).csv);
  expect(rows[0]).toMatchObject({mode:'',next_review_at_utc:''});
  expect(rows[1]).toMatchObject({mode:'spelling',next_review_at_utc:next.toISOString(),answered_at_utc:when.toISOString(),answer:'KNOWN'});
 });
});
