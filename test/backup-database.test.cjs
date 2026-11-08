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
