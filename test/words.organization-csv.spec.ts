import { csvHeader,csvLine,EXPORT_COLUMNS,wordRow } from '../src/dictionary-export/dictionary-csv';
import { parseDictionaryCsv } from '../src/dictionary-import/dictionary-csv-reader';
import { savedRow } from '../src/dictionary-import/import-materials';
describe('organization CSV compatibility',()=>{
 it('round-trips unknown and not-applicable article separately without inventing an article',()=>{
  for(const number of ['singular','not_applicable','plural']){
   const data:any={id:'unknown',german:'Wort',article:'none',grammaticalNumber:number,pluralForm:null,level:null,sourceBook:null,lessonNumber:null,notes:null,translation:'',translations:[],verbForms:[],examples:[],bookSources:[],userWords:[{isArchived:false,isFavorite:false}],personalNotes:[],personalTranslations:[],personalBooks:[],personalTags:[{titles:['Exam']}],personalLessonNames:[]};
   const parsed=parseDictionaryCsv(Buffer.from(csvHeader(EXPORT_COLUMNS)+csvLine(EXPORT_COLUMNS,wordRow(data))))[0];expect(parsed.errors).toEqual([]);expect(parsed.article).toBe('none');expect(parsed.number).toBe(number);expect(savedRow(parsed).card.grammaticalNumber).toBe(number);expect(savedRow(parsed).personal.tags).toEqual(['Exam']);
  }
 });
 it('still rejects noun articles on non-nouns and a verb with noun number',()=>{
  for(const row of [{german:'Test',word_type:'other',article:'der',grammatical_number:'singular'},{german:'gehen',word_type:'verb',article:'none',grammatical_number:'singular'}])expect(parseDictionaryCsv(Buffer.from(csvHeader(EXPORT_COLUMNS)+csvLine(EXPORT_COLUMNS,row)))[0].errors).toContain('word_type');
 });
});
