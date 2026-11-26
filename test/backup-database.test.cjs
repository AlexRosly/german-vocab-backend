const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const script=path.resolve(__dirname,'../scripts/backup-database.cjs');
const secret='FAKE_CREDENTIAL_MUST_NOT_BE_PRINTED';
function run(args,url=`postgresql://test:${secret}@backup-test.invalid/neondb`){
 const result=spawnSync(process.execPath,[script,...args],{env:{...process.env,DATABASE_URL:url},encoding:'utf8',timeout:4000});
 assert.equal(result.error,undefined);assert.equal(result.status,1);
 const output=result.stdout+result.stderr;assert.ok(!output.includes(secret));return output;
}
test('wrong host is refused without opening a datasource or leaking credentials',()=>{
 assert.match(run(['--expect-host','other.invalid','--directory',os.tmpdir()]),/differs from/);
});
test('malformed connection URL is rejected without disclosing its contents',()=>{
 assert.match(run(['--expect-host','backup-test.invalid','--directory',os.tmpdir()],`invalid ${secret}`),/missing or malformed/);
});
test('private backup output inside the checkout is refused before any DB access',()=>{
 assert.match(run(['--expect-host','backup-test.invalid','--directory',path.resolve(__dirname,'../private-backup')]),/outside the Git checkout/);
});
test('an existing output directory cannot be overwritten',()=>{
 assert.match(run(['--expect-host','backup-test.invalid','--directory',os.tmpdir()]),/refusing to overwrite/);
});
test('private output inside a different Git checkout is refused too',()=>{
 const other=fs.mkdtempSync(path.join(os.tmpdir(),'wk-backup-other-repo-'));
 const marker=path.join(other,'.git');fs.writeFileSync(marker,'gitdir: fixture');
 try{assert.match(run(['--expect-host','backup-test.invalid','--directory',path.join(other,'private-backup')]),/outside the Git checkout/)}
 finally{fs.unlinkSync(marker);fs.rmdirSync(other)}
});


test('private example translations are included in data backup and restore SQL',()=>{
 const {tables,sqlBackup}=require('../scripts/backup-database.cjs');
 assert.equal(tables.filter(t=>t==='personal_example_translations').length,1);
 const row={userId:'synthetic-user',exampleId:'synthetic-example',language:'ru',text:'Private example text',sourceGerman:'Ich lerne.',revision:'test'};
 const sql=sqlBackup({data:{personal_example_translations:[row]},checks:[]},'-- Synthetic schema');
 assert.ok(sql.includes('INSERT INTO "public"."personal_example_translations"'));
 assert.ok(sql.includes('Private example text'));
});

test('personal tags and dictionary settings survive database SQL backup',()=>{
 const {tables,sqlBackup}=require('../scripts/backup-database.cjs');
 for(const name of ['personal_word_tags','personal_dictionary_settings'])assert.equal(tables.filter(t=>t===name).length,1);
 const sql=sqlBackup({data:{personal_word_tags:[{userId:'synthetic-user',wordId:'synthetic-word',titles:['Exam'],revision:'test'}],personal_dictionary_settings:[{userId:'synthetic-user',lessonNames:[{book:'Book',lessonNumber:2,name:'Work'}],neutralColor:'#123456',revision:'test'}]},checks:[]},'-- Synthetic schema');
 assert(sql.includes('INSERT INTO "public"."personal_word_tags"'));assert(sql.includes('INSERT INTO "public"."personal_dictionary_settings"'));assert(sql.includes('Exam'));assert(sql.includes('#123456'));
});

test('audit data and executable definitions are restored in the correct order',()=>{
 const {tables,sqlBackup}=require('../scripts/backup-database.cjs');assert.equal(tables.filter(t=>t==='word_audit_events').length,1);
 const sql=sqlBackup({data:{word_audit_events:[{id:'event',wordId:'word',wordGerman:'Haus',entity:'words',action:'UPDATE',transactionId:'1'}]},checks:[],auditDefinitions:['CREATE FUNCTION synthetic_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$','CREATE TRIGGER synthetic_trigger AFTER UPDATE ON words FOR EACH ROW EXECUTE FUNCTION synthetic_audit()']},'-- Synthetic schema');
 assert(sql.indexOf('INSERT INTO "public"."word_audit_events"')<sql.indexOf('CREATE FUNCTION synthetic_audit'));assert(sql.indexOf('CREATE FUNCTION synthetic_audit')<sql.indexOf('CREATE TRIGGER synthetic_trigger'));assert(sql.endsWith('COMMIT;\n'));
});


test('image metadata and image audit trigger survive database SQL backup',()=>{
 const {tables,sqlBackup}=require('../scripts/backup-database.cjs');assert.equal(tables.filter(t=>t==='word_images').length,1);
 const row={wordId:'w',storageKey:'12345678-1234-4234-9234-123456789abc.webp',sha256:'a'.repeat(64),bytes:30,width:40,height:40,revision:'12345678-1234-4234-9234-123456789abc'};
 const sql=sqlBackup({data:{word_images:[row]},checks:[],auditDefinitions:['CREATE TRIGGER wk_audit_word_images AFTER INSERT ON word_images FOR EACH ROW EXECUTE FUNCTION wortkarten_audit_word_change()']},'-- Synthetic schema');
 assert(sql.includes('INSERT INTO "public"."word_images"'));assert(sql.includes(row.storageKey));assert(sql.includes('CREATE TRIGGER wk_audit_word_images'));
});
