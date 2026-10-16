'use strict';
const fs=require('node:fs'),path=require('node:path');
(async()=>{const directory=path.resolve(process.argv[2]||'tmp/v2-offline-runtime'),runtime=JSON.parse(fs.readFileSync(path.join(directory,'runtime.json'),'utf8'));
 if(runtime.instance!=='v2-offline'||runtime.host!=='127.0.0.1'||!Number.isInteger(runtime.port)||[3789,3790,3791,4389,4499,4510,4512,8080].includes(runtime.port))throw Error('Not an isolated V2 runtime');
 const health=await fetch('http://127.0.0.1:'+runtime.port+'/health',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());
 if(health.trial?.instance!=='v2-offline'||health.trial.pid!==runtime.pid||health.trial.indexPid!==runtime.indexPid)throw Error('Runtime identity mismatch; nothing was stopped');
 process.kill(runtime.pid);try{process.kill(runtime.indexPid);}catch(e){if(e.code!=='ESRCH')throw e;}
 console.log('Stopped verified local V2 only. V1 and source files unchanged.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
