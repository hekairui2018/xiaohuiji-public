'use strict';
const {parseArgs}=require('node:util'),fs=require('node:fs');
const {mutate}=require('../external-services/assistant-updates.cjs');
async function main(){const {values}=parseArgs({options:Object.fromEntries([...['config','key','channel','action','file','build','display-version','notes-file','size','sha256'].map(k=>[k,{type:'string'}]),['approve-stable',{type:'boolean',default:false}]])});
 const result=await mutate(values.config,values.key,values.channel||'test',values.action,{file:values.file,build:values.build,displayVersion:values['display-version'],notes:values['notes-file']?fs.readFileSync(values['notes-file'],'utf8'):undefined,size:values.size?Number(values.size):undefined,sha256:values.sha256,approveStable:values['approve-stable']});
 console.log(JSON.stringify({ok:true,keyId:result.keyId,payload:JSON.parse(Buffer.from(result.payload,'base64'))},null,2));}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
