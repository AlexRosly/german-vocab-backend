#!/usr/bin/env node
// Restore only our fixed Drive backup into a disposable local Docker container.
// This tool never loads .env, accepts a datasource URL or connects to Neon.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process'),{randomBytes,createHash}=require('node:crypto');
const {pipeline}=require('node:stream/promises'),{Writable}=require('node:stream');
const REMOTE='wortkarten-drive-own:WortkartenBackups-own/production';
const DOCKER_HOST='unix:///var/run/docker.sock';
// pg_attver compatibility landed in 18.7; a cached floating :18 may still be 18.6.
const RESTORE_IMAGE='postgres:18.7';
const MIN_SERVER_VERSION=180007;
const required=['users','words','word_examples','word_translations','user_words','study_sessions','study_session_words','word_progress','_prisma_migrations'];
const verifySql=`DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY[${required.map(t=>"'"+t+"'").join(',')}] LOOP
    IF to_regclass('public.'||name) IS NULL THEN RAISE EXCEPTION 'Required application table missing'; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM public.words) OR NOT EXISTS(SELECT 1 FROM public.users) THEN RAISE EXCEPTION 'Application data missing'; END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND NOT c.convalidated) THEN RAISE EXCEPTION 'Invalid constraint'; END IF;
  IF EXISTS(SELECT 1 FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) THEN RAISE EXCEPTION 'Unfinished migration'; END IF;
END $$;
SELECT json_build_object('words',(SELECT count(*) FROM public.words),'examples',(SELECT count(*) FROM public.word_examples),'users',(SELECT count(*) FROM public.users),'dictionaryEntries',(SELECT count(*) FROM public.user_words),'sessions',(SELECT count(*) FROM public.study_sessions),'answers',(SELECT count(*) FROM public.study_session_words),'progress',(SELECT count(*) FROM public.word_progress),'migrations',(SELECT count(*) FROM public._prisma_migrations));`;

function configuration(home=os.homedir()) {
  const rclone=path.join(home,'.local/bin/rclone'),config=path.join(home,'.config/rclone/rclone.conf');
  for(const p of [rclone,config])if(!fs.statSync(p).isFile())throw Error('restore_configuration_invalid');
  if(process.getuid){const s=fs.statSync(config);if(s.uid!==process.getuid()||(s.mode&0o077))throw Error('restore_private_config_required');}
  return {home,rclone,config};
}
function selectBackup(list) {
  if(!Array.isArray(list)||list.length>10000)throw Error('restore_backup_list_invalid');
  const files=list.filter(x=>!x.IsDir&&typeof x.Name==='string'&&/^db-neon-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.dump$/.test(x.Name));
  const unique=new Set(files.map(x=>x.Name));if(!files.length||unique.size!==files.length)throw Error('restore_backup_list_invalid');
  files.sort((a,b)=>b.Name.localeCompare(a.Name));
  const file=files[0];if(!Number.isSafeInteger(file.Size)||file.Size<5||file.Size>1024**3)throw Error('restore_backup_size_invalid');
  return file;
}
async function digest(file){const hash=createHash('sha256');await pipeline(fs.createReadStream(file),new Writable({write(chunk,_enc,next){hash.update(chunk);next();}}));return hash.digest('hex');}
function execute(command,args,options={}){return spawnSync(command,args,{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,...options});}

async function runRestore(config,{run=execute,checkOnly=false,notify=()=>{}}={}){
  const childEnv={PATH:process.env.PATH,HOME:config.home,LANG:'C.UTF-8'};
  let step='configuration',directory,container,nonce,cleaned=false;
  const call=(command,args,extra={})=>{
    const result=run(command,args,{env:childEnv,...extra});
    if(result.error||result.status!==0){if(directory)fs.writeFileSync(path.join(directory,step+'.error.log'),String(result.stderr||result.stdout||'Command failed'),{mode:0o600});throw Error('restore_failed_'+step);}
    return String(result.stdout||'').trim();
  };
  const docker=(...args)=>call('docker',['--host',DOCKER_HOST,...args]);
  const rclone=(...args)=>call(config.rclone,['--config',config.config,'--contimeout','10s','--timeout','60s','--retries','1','--low-level-retries','1',...args]);
  const json=(text)=>{try{return JSON.parse(text);}catch{throw Error('restore_invalid_'+step);}};
  try{
    step='python';call('python3',['--version']);step='docker_image';docker('image','inspect',RESTORE_IMAGE);step='remote_configuration';
    if(!rclone('listremotes').split(/\r?\n/).includes('wortkarten-drive-own:'))throw Error('restore_remote_missing');
    if(checkOnly)return {configurationReady:true,downloaded:false,restored:false};
    const base=path.join(config.home,'backups','wortkarten-restore-checks');fs.mkdirSync(base,{recursive:true,mode:0o700});
    const realHome=fs.realpathSync(config.home),realBase=fs.realpathSync(base),relative=path.relative(realHome,realBase);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('restore_private_path_invalid');
    directory=fs.mkdtempSync(path.join(base,'run-'));fs.chmodSync(directory,0o700);
    step='listing';notify(step);
    const source=selectBackup(json(rclone('lsjson',REMOTE+'/database','--files-only','--max-depth','1')));
    const stamp=source.Name.slice('db-neon-'.length,-'.dump'.length),projectName='project-'+stamp+'.tar.gz';
    const projectList=json(rclone('lsjson',REMOTE+'/project','--files-only','--max-depth','1'));
    if(!Array.isArray(projectList))throw Error('restore_backup_list_invalid');
    const projects=projectList.filter(x=>!x.IsDir&&x.Name===projectName);
    if(projects.length!==1||!Number.isSafeInteger(projects[0].Size)||projects[0].Size<1||projects[0].Size>1024**3)throw Error('restore_project_pair_missing');
    if(fs.statfsSync){const disk=fs.statfsSync(base);if(disk.bavail*disk.bsize<source.Size+projects[0].Size+2*1024**3)throw Error('restore_free_space_required');}

    const downloaded={};
    for(const [kind,name,size]of [['database',source.Name,source.Size],['project',projectName,projects[0].Size]]){
      step='download_'+kind;notify(step);const folder=path.join(directory,kind);fs.mkdirSync(folder,{mode:0o700});const file=path.join(folder,name);
      rclone('copyto',REMOTE+'/'+kind+'/'+name,file,'--immutable');
      if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size!==size)throw Error('restore_download_size_mismatch');
      fs.chmodSync(file,0o600);
      const comparison=path.join(directory,kind+'-comparison.txt');
      rclone('check',REMOTE+'/'+kind,folder,'--include','/'+name,'--one-way','--download','--combined',comparison);
      fs.chmodSync(comparison,0o600);
      const checked=fs.readFileSync(comparison,'utf8').trim().split(/\r?\n/);if(checked.length!==1||checked[0]!=='= '+name)throw Error('restore_exact_comparison_required');
      downloaded[kind]={file,sha256:await digest(file)};
    }
    step='project_restore';notify(step);
    const project=json(call('python3',[path.resolve(__dirname,'../deploy/backup/restore-project-check.py'),downloaded.project.file,path.join(directory,'project-restored')]));
    if(!Number.isSafeInteger(project.projectFilesRestored)||project.projectFilesRestored<2)throw Error('restore_project_invalid');
    const fd=fs.openSync(downloaded.database.file,'r'),magic=Buffer.alloc(5);try{fs.readSync(fd,magic,0,5,0);}finally{fs.closeSync(fd);}if(magic.toString()!=='PGDMP')throw Error('restore_dump_format_invalid');
    step='database_restore';notify(step);nonce=randomBytes(16).toString('hex');container='wortkarten-restore-check-'+nonce;
    const password=randomBytes(32).toString('hex');
    const id=call('docker',['--host',DOCKER_HOST,'run','--detach','--rm','--name',container,'--label','wortkarten.restore-check='+nonce,'--network','none','--memory','768m','--cpus','1','--pids-limit','128','--env','POSTGRES_DB=wortkarten_restore','--env','POSTGRES_PASSWORD',RESTORE_IMAGE],{env:{...childEnv,POSTGRES_PASSWORD:password}});
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('restore_container_invalid');
    const own=()=>{if(docker('inspect','--format','{{index .Config.Labels "wortkarten.restore-check"}}',container)!==nonce)throw Error('restore_container_identity_changed');};own();
    let ready=false;
    for(let i=0;i<60;i++){const r=run('docker',['--host',DOCKER_HOST,'exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','wortkarten_restore'],{env:childEnv,timeout:5000});if(!r.error&&r.status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}
    if(!ready)throw Error('restore_container_not_ready');
    own();
    const version=docker('exec',container,'psql','--host','/var/run/postgresql','--username','postgres','--dbname','wortkarten_restore','-X','-qAt','--set','ON_ERROR_STOP=1','--command',"SELECT current_setting('server_version_num')::integer");
    if(!/^\d+$/.test(version)||Number(version)<MIN_SERVER_VERSION||Number(version)>=190000)throw Error('restore_server_version_incompatible');
    const serverVersion=Number(version);
    docker('cp',downloaded.database.file,container+':/tmp/database.dump');
    docker('exec',container,'pg_restore','--host','/var/run/postgresql','--username','postgres','--dbname','wortkarten_restore','--clean','--if-exists','--no-owner','--no-acl','--exit-on-error','--single-transaction','/tmp/database.dump');
    step='verification';notify(step);own();
    const output=docker('exec',container,'psql','--host','/var/run/postgresql','--username','postgres','--dbname','wortkarten_restore','-X','-qAt','--set','ON_ERROR_STOP=1','--command',verifySql);
    const counts=json(output);for(const k of ['words','examples','users','dictionaryEntries','sessions','answers','progress','migrations'])if(!Number.isSafeInteger(counts[k])||counts[k]<0)throw Error('restore_counts_invalid');
    if(!counts.words||!counts.users)throw Error('restore_data_missing');
    const hasImages=docker('exec',container,'psql','--host','/var/run/postgresql','--username','postgres','--dbname','wortkarten_restore','-X','-qAt','--set','ON_ERROR_STOP=1','--command',"SELECT to_regclass('public.word_images') IS NOT NULL");
    if(!['t','f'].includes(hasImages))throw Error('restore_image_schema_invalid');
    let imageFilesVerified=0;
    if(hasImages==='t'){
      step='image_verification';
      const references=docker('exec',container,'psql','--host','/var/run/postgresql','--username','postgres','--dbname','wortkarten_restore','-X','-qAt','--set','ON_ERROR_STOP=1','--command',`SELECT COALESCE(json_agg(json_build_object('key',"storageKey",'bytes',bytes,'sha256',sha256)),'[]'::json) FROM public.word_images`);
      imageFilesVerified=json(call('python3',[path.resolve(__dirname,'../deploy/backup/verify-image-files.py'),path.join(directory,'project-restored')],{input:references})).imageFilesVerified;
      if(!Number.isSafeInteger(imageFilesVerified)||imageFilesVerified<0)throw Error('restore_images_invalid');
    }
    const report={restored:true,restoreImage:RESTORE_IMAGE,serverVersion,imageFilesVerified,completedAt:new Date().toISOString(),backup:source.Name,cloudDownloadVerified:true,sha256:{database:downloaded.database.sha256,project:downloaded.project.sha256},...project,counts};
    own();step='cleanup';docker('rm','--force','--volumes',container);cleaned=true;
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
    return {...report,directory};
  }catch(error){if(directory)fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify({restored:false,step,container:container||null,reason:['restore_server_version_incompatible'].includes(error.message)?error.message:'command_or_verification_failed',message:'Restore check did not finish; inspect private logs.'}),{mode:0o600});throw Error('Restore check failed at '+step+(directory?'; private directory: '+directory:'')+(step==='docker_image'?'; install official image: docker pull '+RESTORE_IMAGE:error.message==='restore_server_version_incompatible'?'; PostgreSQL 18.7 or newer 18.x is required':''));}
  finally{
    if(container&&!cleaned){const identity=run('docker',['--host',DOCKER_HOST,'inspect','--format','{{index .Config.Labels "wortkarten.restore-check"}}',container],{env:childEnv});if(identity.status===0&&String(identity.stdout).trim()===nonce)run('docker',['--host',DOCKER_HOST,'rm','--force','--volumes',container],{env:childEnv});}
  }
}
module.exports={configuration,selectBackup,runRestore,REMOTE,DOCKER_HOST};
if(require.main===module){
  if(!['--run','--check-config'].includes(process.argv[2])||process.argv.length!==3){console.error('Usage: node scripts/check-drive-restore.cjs --check-config | --run');process.exitCode=1;}
  else if(process.platform!=='linux'||process.getuid?.()===0){console.error('Run as the wortkarten user on Linux, not root.');process.exitCode=1;}
  else Promise.resolve().then(()=>runRestore(configuration(),{checkOnly:process.argv[2]==='--check-config',notify:step=>console.log('Restore check: '+step)})).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
