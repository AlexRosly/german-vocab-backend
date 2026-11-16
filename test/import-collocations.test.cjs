const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {validate,canonical}=require('../scripts/import-collocations.cjs');
const starter=require('../data/collocations-starter-20261116.json');
test('reviewed starter contains ten distinct pairs and thirty translations',()=>{assert.equal(validate(starter).length,10);assert.equal(starter.collocations.flatMap(r=>r.translations).length,30);assert.equal(starter.collocations.find(r=>r.verb.german==='treffen').noun.german,'Entscheidung')});
test('inventory rejects duplicate pairs, self-links, unknown languages and incomplete identities',()=>{
 for(const mutate of [p=>p.collocations.push(structuredClone(p.collocations[0])),p=>p.collocations[0].verb=p.collocations[0].noun,p=>p.collocations[0].translations[0].language='zz',p=>p.collocations[0].noun.expectedUpdatedAt='invalid',p=>p.collocations[0].german='   ',p=>p.collocations[0].translations.push(p.collocations[0].translations[0])]){const p=structuredClone(starter);mutate(p);assert.throws(()=>validate(p))}
});
test('German-only phrases are valid and equality ignores translation order, not text',()=>{
 const p=structuredClone(starter);p.collocations[0].translations=[];assert.doesNotThrow(()=>validate(p));
 const r=starter.collocations[0],reverse={...r,translations:[...r.translations].reverse()};assert.equal(canonical(r),canonical(reverse));assert.notEqual(canonical(r),canonical({...r,german:r.german+' falsch'}));
});
test('CLI refuses unreviewed checksum and wrong target before connecting, without exposing credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wk-collocations-')),file=path.join(dir,'data.json');fs.writeFileSync(file,JSON.stringify(starter));
 const hash=require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),secret='COLLOCATION_FAKE_SECRET';
 try{for(const checksum of ['0'.repeat(64),hash]){const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/import-collocations.cjs'),'--file',file,'--expect-host','expected.invalid','--expect-sha256',checksum,'--apply'],{env:{...process.env,DATABASE_URL:`postgresql://test:${secret}@different.invalid/neondb`},encoding:'utf8',timeout:4000});assert.equal(result.status,1);const output=result.stdout+result.stderr;assert.ok(!output.includes(secret));assert.match(output,checksum===hash?/host\/schema differs/:/checksum differs/);}}
 finally{fs.unlinkSync(file);fs.rmdirSync(dir)}
});
