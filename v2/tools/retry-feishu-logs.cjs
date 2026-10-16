'use strict';
const path=require('node:path'),{createFeishuLogs}=require('../external-services/feishu-logs.cjs');
(async()=>{const directory=path.resolve(process.argv.slice(2).find(a=>!a.startsWith('--'))||'tmp/v2-offline-runtime'),logs=createFeishuLogs({directory:path.join(directory,'logs'),configFile:path.join(directory,'feishu.env'),autoStart:false});
 try{if(process.argv.includes('--send'))await logs.drain();console.log(JSON.stringify(logs.status(),null,2));}finally{logs.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
