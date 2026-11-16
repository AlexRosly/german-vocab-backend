#!/usr/bin/env node
// Reviewed bootstrap data only: inserts pairs and translations, never rewrites words or progress.
const fs=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const normalize=value=>value.normalize('NFC').trim().replace(/\s+/gu,' ');
const key=value=>normalize(value).toLocaleLowerCase('de');
const timestamp=value=>value instanceof Date?value.getTime():Date.parse(typeof value==='string'&&!/(Z|[+-]\d\d:\d\d)$/.test(value)?value+'Z':value);
const canonical=row=>JSON.stringify({german:row.german,grammarNote:row.grammarNote??null,translations:[...row.translations].sort((a,b)=>a.language.localeCompare(b.language)).map(({language,text})=>({language,text}))});
function validate(payload){
 if(payload?.version!==1||!Array.isArray(payload.collocations)||!payload.collocations.length||payload.collocations.length>1000)throw Error('Invalid collocation inventory');
 const keys=new Set();
 for(const row of payload.collocations){
  for(const part of ['noun','verb']){const word=row[part];if(!word||typeof word.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/.test(word.id)||typeof word.german!=='string'||!word.german.trim()||!Number.isFinite(timestamp(word.expectedUpdatedAt)))throw Error('Invalid inventory word');}
  if(row.noun.id===row.verb.id||typeof row.german!=='string'||!row.german.trim()||row.german!==normalize(row.german)||row.german.length>500||/[\p{Cc}]/u.test(row.german)||(row.grammarNote!=null&&(typeof row.grammarNote!=='string'||row.grammarNote.length>300||/[\p{Cc}]/u.test(row.grammarNote))))throw Error('Invalid phrase');
  const identity=JSON.stringify([row.noun.id,row.verb.id,key(row.german)]);if(keys.has(identity))throw Error('Duplicate phrase');keys.add(identity);
  if(!Array.isArray(row.translations)||row.translations.length>11||new Set(row.translations.map(t=>t?.language)).size!==row.translations.length)throw Error('Invalid translations');
  for(const t of row.translations)if(!t||!['ru','en','uk','de','pl','es','fr','it','pt','tr','ar'].includes(t.language)||typeof t.text!=='string'||!t.text.trim()||t.text.length>1000||/[\p{Cc}]/u.test(t.text))throw Error('Invalid translation');
 }
 return payload.collocations;
}
async function importCollocations(tx,payload,apply=false){
 const inventory=validate(payload),ids=[...new Set(inventory.flatMap(row=>[row.noun.id,row.verb.id]))].sort();
 const words=await tx.$queryRawUnsafe(`SELECT w.id,w.german,w.article,w."grammaticalNumber",w."publicationStatus",to_char(w."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "updatedAt",EXISTS(SELECT 1 FROM word_verb_forms f WHERE f."wordId"=w.id) AS "isVerb" FROM words w WHERE w.id=ANY($1::text[]) ORDER BY w.id${apply?' FOR UPDATE OF w':''}`,ids);
 const byId=new Map(words.map(w=>[w.id,w]));
 const existing=await tx.$queryRawUnsafe(`SELECT c.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('language',t.language,'text',t.text) ORDER BY t.language) FROM word_collocation_translations t WHERE t."collocationId"=c.id),'[]'::jsonb) AS translations FROM word_collocations c WHERE c."nounWordId"=ANY($1::text[])`,ids);
 const inserts=[];let unchanged=0;
 for(const row of inventory){
  for(const part of ['noun','verb']){
   const expected=row[part],saved=byId.get(expected.id);
   if(!saved||saved.german!==expected.german||saved.publicationStatus!=='PUBLISHED'||(part==='noun'?saved.isVerb||!['der','das','die'].includes(saved.article)||!['singular','plural'].includes(saved.grammaticalNumber):!saved.isVerb))throw Error('Word missing or category/publication changed: '+expected.id);
  }
  const previous=existing.find(c=>c.nounWordId===row.noun.id&&c.verbWordId===row.verb.id&&c.phraseKey===key(row.german));
  if(previous){if(canonical(previous)!==canonical(row))throw Error('Existing phrase differs; manual review required');unchanged++;continue;}
  for(const part of ['noun','verb'])if(timestamp(byId.get(row[part].id).updatedAt)!==timestamp(row[part].expectedUpdatedAt))throw Error('Word changed since inventory: '+row[part].id);
  inserts.push(row);
 }
 if(apply)for(const row of inserts){
  const id=randomUUID();await tx.$executeRawUnsafe(`INSERT INTO word_collocations (id,"nounWordId","verbWordId",german,"phraseKey","grammarNote",revision,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,id,row.noun.id,row.verb.id,row.german,key(row.german),row.grammarNote??null,randomUUID());
  for(const t of row.translations)await tx.$executeRawUnsafe(`INSERT INTO word_collocation_translations (id,"collocationId",language,text,"updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)`,randomUUID(),id,t.language,t.text);
 }
 return {applied:apply,phrasesToAdd:inserts.length,translationsToAdd:inserts.reduce((n,row)=>n+row.translations.length,0),unchangedPhrases:unchanged};
}

async function main(argv=process.argv.slice(2)) {
  const options = {};
  for (let i=0;i<argv.length;i++) {
    if (argv[i]==='--apply') { if(options.apply)throw Error('Duplicate apply flag'); options.apply=true; continue; }
    if (!['--file','--expect-host','--expect-sha256'].includes(argv[i]) || !argv[i+1]) throw Error('Usage: --file JSON --expect-host HOST --expect-sha256 SHA256 [--apply]');
    if (options[argv[i]]) throw Error('Duplicate argument');
    options[argv[i]]=argv[++i];
  }
  if (!options['--file'] || !options['--expect-host'] || !/^[a-f0-9]{64}$/.test(options['--expect-sha256']||'')) throw Error('File, host and reviewed SHA256 are required');
  const input=fs.readFileSync(options['--file']);
  if(createHash('sha256').update(input).digest('hex')!==options['--expect-sha256'])throw Error('Inventory checksum differs');
  const payload=JSON.parse(input);validate(payload);
  let url;try{url=new URL(process.env.DATABASE_URL)}catch{throw Error('DATABASE_URL is missing or malformed')}
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==options['--expect-host']||(url.searchParams.get('schema')||'public')!=='public')throw Error('Database host/schema differs');
  const {PrismaClient}=require('@prisma/client'); const prisma=new PrismaClient();
  try {
    const result=await prisma.$transaction(async tx=>{
      if(!options.apply)await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return importCollocations(tx,payload,options.apply===true);
    },{isolationLevel:options.apply?'Serializable':'RepeatableRead',maxWait:10000,timeout:60000});
    console.log(JSON.stringify(result)); return result;
  } finally {await prisma.$disconnect()}
}
module.exports={validate,importCollocations,canonical,main};
if(require.main===module)main().catch(error=>{console.error('Collocation import failed: '+String(error.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[DATABASE_URL]'));process.exitCode=1});
