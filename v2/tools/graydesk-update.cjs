'use strict';
// Local authenticated administration: this CLI never modifies the GrayDesk client.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{parseArgs}=require('node:util');
const {atomic,store}=require('../external-services/graydesk-updates.cjs');
async function main(){
 const {values:v}=parseArgs({options:Object.fromEntries(['action','config','directory','source-root','origin','file','version','notes','expected-sha256','confirm-version'].map(k=>[k,{type:'string'}]))});
 if(!v.config)throw Error('explicit-config-required');const file=path.resolve(v.config);
 if(v.action==='init'){
  if(fs.existsSync(file)||!v.directory||!v['source-root'])throw Error('already-configured-or-missing-paths');
  atomic(file,{directory:path.resolve(v.directory),sourceRoot:path.resolve(v['source-root']),publicOrigin:v.origin||null,adminToken:crypto.randomBytes(32).toString('base64url')});console.log(JSON.stringify({initialized:true,configFile:file,publicRelease:false}));return;
 }
 const service=store(file);if(v.action==='status'){const c=service.config(),s=service.read(c);console.log(JSON.stringify({latest:s.latest,registered:s.releases.map(r=>({version:r.version,size:r.size,sha256:r.sha256,published:!!r.publishedAt})),httpsConfigured:!!c.publicOrigin},null,2));return;}
 console.log(JSON.stringify(await service.mutate(v.action,{file:v.file,version:v.version,releaseNotes:v.notes,expectedSHA256:v['expected-sha256'],confirmVersion:v['confirm-version'],edition:'standard',arch:'win-x64'})));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
