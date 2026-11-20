import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateStudySessionDto } from '../src/study/dto/create-study-session.dto';
describe('History mode input',()=>{
 const base={totalWords:1,words:[{wordId:'w',answer:'KNOWN'}]};
 it('allows five known modes and legacy absence while rejecting mode/schedule injection',()=>{
  for(const mode of ['forward','reverse','article','plural','spelling'])expect(validateSync(plainToInstance(CreateStudySessionDto,{...base,mode}))).toHaveLength(0);
  expect(validateSync(plainToInstance(CreateStudySessionDto,base))).toHaveLength(0);
  for(const mode of [null,'FORWARD','other',4])expect(validateSync(plainToInstance(CreateStudySessionDto,{...base,mode})).length).toBeGreaterThan(0);
  expect(validateSync(plainToInstance(CreateStudySessionDto,{...base,words:[{...base.words[0],nextReviewAt:'2030-01-01T00:00:00Z'}]}),{whitelist:true,forbidNonWhitelisted:true}).length).toBeGreaterThan(0);
 });
});
