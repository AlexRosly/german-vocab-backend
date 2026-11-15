#!/usr/bin/env node
// Adds only reviewed form rows. No updates to words, translations, publication or personal data.
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const canonical = forms => JSON.stringify(forms.map(({praeteritum,participle2,auxiliary,reflexive,usage}) => ({praeteritum,participle2,auxiliary,reflexive:reflexive??false,usage:usage||null})));
const timestamp = value => value instanceof Date ? value.getTime() : Date.parse(typeof value === 'string' && !/(Z|[+-]\d\d:\d\d)$/.test(value) ? value+'Z' : value);

function validate(payload) {
  if (payload?.version !== 1 || !Array.isArray(payload.words) || !payload.words.length || payload.words.length > 2000) throw Error('Invalid verb inventory');
  const ids = new Set();
  for (const word of payload.words) {
    if (typeof word.wordId !== 'string' || !word.wordId || ids.has(word.wordId) || typeof word.german !== 'string' || !word.german || !Number.isFinite(timestamp(word.expectedUpdatedAt))) throw Error('Invalid or duplicate inventory card');
    ids.add(word.wordId);
    if (!Array.isArray(word.verbForms) || word.verbForms.length < 1 || word.verbForms.length > 4) throw Error('Invalid form count');
    for (const form of word.verbForms) {
      for (const key of ['praeteritum','participle2']) if (typeof form[key] !== 'string' || !form[key].trim() || form[key].length > 200 || /[\p{Cc}]/u.test(form[key])) throw Error('Invalid form text');
      if (!['HABEN','SEIN'].includes(form.auxiliary) || typeof form.reflexive !== 'boolean' || (form.usage != null && (typeof form.usage !== 'string' || form.usage.length > 300))) throw Error('Invalid form metadata');
    }
    if (new Set(word.verbForms.map(form=>canonical([form]))).size !== word.verbForms.length) throw Error('Duplicate variant');
  }
  return payload.words;
}

async function importForms(tx, payload, apply = false) {
  const words = validate(payload);
  const current = await tx.$queryRawUnsafe(`SELECT w."id",w."german",w."article",w."grammaticalNumber",w."pluralForm",to_char(w."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "updatedAt",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('praeteritum',f."praeteritum",'participle2',f."participle2",'auxiliary',f."auxiliary",'reflexive',f."reflexive",'usage',f."usage") ORDER BY f."position") FROM word_verb_forms f WHERE f."wordId"=w."id"),'[]'::jsonb) AS forms
    FROM words w WHERE w."id" = ANY($1::text[])${apply ? ' FOR UPDATE OF w' : ''}`, words.map(word=>word.wordId));
  const byId = new Map(current.map(word=>[word.id,word]));
  const insert = [];
  let unchanged = 0, cards = 0;
  for (const word of words) {
    const saved = byId.get(word.wordId);
    if (!saved || saved.german !== word.german || saved.article !== 'none' || saved.grammaticalNumber !== 'not_applicable' || saved.pluralForm) throw Error('Inventory card missing or category changed: '+word.wordId);
    if (saved.forms.length) {
      if (canonical(saved.forms) !== canonical(word.verbForms)) throw Error('Existing forms differ; manual review required: '+word.wordId);
      unchanged++; continue;
    }
    if (timestamp(saved.updatedAt) !== timestamp(word.expectedUpdatedAt)) throw Error('Card changed since inventory: '+word.wordId);
    cards++;
    word.verbForms.forEach((form,position)=>insert.push({id:randomUUID(),wordId:word.wordId,position,praeteritum:form.praeteritum,participle2:form.participle2,auxiliary:form.auxiliary,reflexive:form.reflexive,usage:form.usage??null}));
  }
  if (apply && insert.length) await tx.$executeRawUnsafe(`INSERT INTO word_verb_forms ("id","wordId","position","praeteritum","participle2","auxiliary","reflexive","usage","updatedAt")
    SELECT id,"wordId",position,praeteritum,"participle2",auxiliary::"VerbAuxiliary",reflexive,usage,CURRENT_TIMESTAMP
    FROM jsonb_to_recordset($1::jsonb) AS f(id text,"wordId" text,position integer,praeteritum text,"participle2" text,auxiliary text,reflexive boolean,usage text)`, JSON.stringify(insert));
  return { applied:apply, cardsToAdd:cards, variantsToAdd:insert.length, unchangedCards:unchanged };
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
      return importForms(tx,payload,options.apply===true);
    },{isolationLevel:options.apply?'Serializable':'RepeatableRead',maxWait:10000,timeout:60000});
    console.log(JSON.stringify(result)); return result;
  } finally {await prisma.$disconnect()}
}
module.exports={validate,importForms,canonical,main};
if(require.main===module)main().catch(error=>{console.error('Verb import failed: '+String(error.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[DATABASE_URL]'));process.exitCode=1});
