#!/usr/bin/env node
// Read-only application backup. Private output must live outside this checkout.
const fs=require('node:fs'),path=require('node:path');
const {createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..');
const tables=['users','accounts','auth_sessions','google_auth_challenges','words','word_translations','word_examples','word_example_translations','user_words','study_sessions','study_session_words','word_progress','personal_word_notes','personal_word_translations','personal_word_books','word_relations','word_corrections','_prisma_migrations'];
const hash=value=>createHash('sha256').update(value).digest('hex');
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value}
const tableHash=rows=>hash(rows.map(row=>JSON.stringify(canonical(row))).sort().join('\n'));
const ident=value=>'"'+value.replace(/"/g,'""')+'"';
function outsideCheckout(directory){
 const relative=path.relative(repo,directory);
 if(relative===''||!(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)))return false;
 for(let current=directory;;){if(fs.existsSync(path.join(current,'.git')))return false;const parent=path.dirname(current);if(parent===current)return true;current=parent}
}
function sqlBackup(snapshot,schema){
 if(/^\s*(BEGIN|COMMIT)\s*;/mi.test(schema))throw new Error('Unexpected transaction in generated schema');
 let sql='-- PRIVATE: includes account password hashes. Restore ONLY into a new empty database.\nBEGIN;\n';
 sql+="DO $wk_guard$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public') THEN RAISE EXCEPTION 'Restore requires an empty public schema'; END IF; END $wk_guard$;\n";
 sql+=schema+'\nCREATE TABLE "public"."_prisma_migrations" ("id" VARCHAR(36) PRIMARY KEY,"checksum" VARCHAR(64) NOT NULL,"finished_at" TIMESTAMPTZ,"migration_name" VARCHAR(255) NOT NULL,"logs" TEXT,"rolled_back_at" TIMESTAMPTZ,"started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),"applied_steps_count" INTEGER NOT NULL DEFAULT 0);\n';
 for(const c of snapshot.checks)sql+=`ALTER TABLE "public".${ident(c.table_name)} ADD CONSTRAINT ${ident(c.name)} ${c.definition};\n`;
 if(Object.prototype.hasOwnProperty.call(snapshot.data,'word_corrections'))sql+='CREATE UNIQUE INDEX "word_corrections_one_open_per_reporter" ON "public"."word_corrections"("reporterId","wordId") WHERE "status" = \'OPEN\';\n';
 for(const table of tables){const rows=snapshot.data[table];if(!rows.length)continue;const json=JSON.stringify(rows),delimiter='$wk_'+hash(table+json).slice(0,20)+'$';if(json.includes(delimiter))throw new Error('JSON delimiter collision');sql+=`INSERT INTO "public".${ident(table)} SELECT * FROM jsonb_populate_recordset(NULL::"public".${ident(table)},${delimiter}${json}${delimiter}::jsonb);\n`}
 return sql+'COMMIT;\n';
}
async function main(argv=process.argv.slice(2)){
 const options={};for(let i=0;i<argv.length;i++){if(!['--directory','--expect-host'].includes(argv[i])||!argv[i+1])throw new Error('Usage: node --env-file=.env scripts/backup-database.cjs --directory OUTSIDE_CHECKOUT --expect-host HOST');options[argv[i]]=argv[++i]}
 if(!options['--directory']||!options['--expect-host'])throw new Error('Both --directory and --expect-host are required');
 let target;try{target=new URL(process.env.DATABASE_URL)}catch{throw new Error('DATABASE_URL is missing or malformed; its value was not printed')}
 if(!['postgres:','postgresql:'].includes(target.protocol)||target.hostname!==options['--expect-host']||(target.searchParams.get('schema')||'public')!=='public')throw new Error('Database host/schema differs from the requested backup target');
 const destination=path.resolve(options['--directory']);if(!outsideCheckout(destination))throw new Error('Choose an output directory outside the Git checkout');
 if(fs.existsSync(destination))throw new Error('Output directory already exists; refusing to overwrite a backup');
 fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
 if(!outsideCheckout(path.join(fs.realpathSync(path.dirname(destination)),path.basename(destination))))throw new Error('Output resolves inside the checkout');
 const schemaResult=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',path.join(repo,'prisma/schema.prisma'),'--script'],{cwd:repo,env:process.env,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
 if(schemaResult.error||schemaResult.status!==0||!schemaResult.stdout.includes('CREATE TABLE'))throw new Error('Could not generate schema SQL; install the locked Prisma CLI dev dependency');
 const {PrismaClient}=require('@prisma/client');const prisma=new PrismaClient();
 let snapshot;
 try{snapshot=await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const found=await tx.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  if(JSON.stringify(found.map(r=>r.tablename).sort())!==JSON.stringify([...tables].sort()))throw new Error('Public table list differs from this application schema; inspect before backup');
  const data={};for(const table of tables){const rows=await tx.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM public.${ident(table)} t`);data[table]=rows.map(r=>r.row)}
  const checks=await tx.$queryRaw`SELECT t.relname AS table_name,c.conname AS name,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND c.contype='c' ORDER BY t.relname,c.conname`;
  const columns=await tx.$queryRaw`SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`;
  return {version:1,createdAt:new Date().toISOString(),host:target.hostname,readOnly:true,data,checks,columns};
 },{isolationLevel:'RepeatableRead',maxWait:10000,timeout:90000})}finally{await prisma.$disconnect()}
 const json=JSON.stringify(snapshot,null,2),sql=sqlBackup(snapshot,schemaResult.stdout);
 fs.mkdirSync(destination,{mode:0o700});
 for(const [name,value]of [['snapshot.json',json],['schema.sql',schemaResult.stdout],['restore-empty-database.sql',sql]])fs.writeFileSync(path.join(destination,name),value,{flag:'wx',mode:0o600});
 const manifest={version:1,createdAt:snapshot.createdAt,host:target.hostname,readOnly:true,containsAuthenticationHashes:true,restorationTested:false,files:{'snapshot.json':hash(json),'schema.sql':hash(schemaResult.stdout),'restore-empty-database.sql':hash(sql)},tables:Object.fromEntries(tables.map(name=>[name,{count:snapshot.data[name].length,sha256:tableHash(snapshot.data[name])}]))};
 const parsed=JSON.parse(fs.readFileSync(path.join(destination,'snapshot.json'),'utf8'));if(tables.some(name=>tableHash(parsed.data[name])!==manifest.tables[name].sha256))throw new Error('Written JSON verification failed');
 fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({directory:destination,host:target.hostname,tables:Object.fromEntries(tables.map(name=>[name,manifest.tables[name].count])),jsonAndFilesVerified:true,restorationTested:false}));
 return {destination,manifest};
}
module.exports={main,sqlBackup,tableHash,hash,tables};
if(require.main===module)main().catch(error=>{console.error('Backup failed: '+String(error.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[DATABASE_URL]'));process.exitCode=1});
