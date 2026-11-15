const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate,importForms}=require('../scripts/import-verb-forms.cjs');
const form={praeteritum:'ging',participle2:'gegangen',auxiliary:'SEIN',reflexive:false,usage:null};
const inventory=()=>({version:1,words:[{wordId:'qa-verb',german:'gehen',expectedUpdatedAt:'2026-11-15T12:00:00.123',verbForms:[{...form}]}]});
function fixture(){
 const word={id:'qa-verb',german:'gehen',article:'none',grammaticalNumber:'not_applicable',pluralForm:null,updatedAt:'2026-11-15T12:00:00.123',forms:[]};
 let writes=0;
 return {word,get writes(){return writes},tx:{
  $queryRawUnsafe:async()=>[structuredClone(word)],
  $executeRawUnsafe:async(_sql,json)=>{writes++;word.forms=JSON.parse(json).map(({praeteritum,participle2,auxiliary,reflexive,usage})=>({praeteritum,participle2,auxiliary,reflexive,usage}));return word.forms.length},
 }};
}
test('dry run writes nothing; apply adds only form rows and rerun is idempotent',async()=>{
 const f=fixture(), before=structuredClone(f.word);
 assert.deepEqual(await importForms(f.tx,inventory()),{applied:false,cardsToAdd:1,variantsToAdd:1,unchangedCards:0});
 assert.equal(f.writes,0);assert.deepEqual(f.word,before);
 await importForms(f.tx,inventory(),true);assert.equal(f.writes,1);
 assert.deepEqual({...f.word,forms:[]},before);
 assert.equal((await importForms(f.tx,inventory(),true)).unchangedCards,1);assert.equal(f.writes,1);
});
test('changed cards, wrong categories and different existing forms stop before writes',async()=>{
 for(const patch of [{updatedAt:'2026-11-15T12:00:00.124'},{german:'fahren'},{article:'der'},{pluralForm:'Gänge'},{forms:[{...form,participle2:'WRONG'}]}]){
  const f=fixture();Object.assign(f.word,patch);
  await assert.rejects(importForms(f.tx,inventory(),true));assert.equal(f.writes,0);
 }
});
test('inventory rejects malformed forms and duplicate cards',()=>{
 for(const modify of [p=>p.words.push(p.words[0]),p=>p.words[0].verbForms=[],p=>p.words[0].verbForms[0].auxiliary='BOTH',p=>p.words[0].verbForms[0].participle2='',p=>p.words[0].verbForms.push(p.words[0].verbForms[0])]){
  const payload=inventory();modify(payload);assert.throws(()=>validate(payload));
 }
});
