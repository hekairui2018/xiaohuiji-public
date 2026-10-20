'use strict';
// Separate Xiaohuiji trial, reuses the running read-only resource service.
const path=require('node:path'),fs=require('node:fs');
async function start({port=8631,lanAddress=process.env.XHJ_LAN_ADDRESS}={}){
 const root=path.resolve(__dirname,'../..'),data=path.join(root,'tmp/qwen-fast-xhj-trial-20261020');fs.mkdirSync(data,{recursive:true});
 const knowledge=require('../adapters/data/load-knowledge.cjs').loadKnowledge(path.join(root,'v2/data/knowledge-next'),{manifestFile:'candidate-manifest.json'});
 const app=require('../app/bootstrap.cjs').createApp({knowledge});
 const expert=require('../model-adapter/qwen-fast-trial.cjs').createQwenFastTrial({onDiagnostic:entry=>fs.appendFileSync(path.join(data,'model-calls.private.jsonl'),JSON.stringify({at:new Date().toISOString(),...entry})+'\n')});
 const offlineKnowledge=require('../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({app,knowledge,resourceBase:'http://127.0.0.1:8521',sessionDirectory:path.join(data,'sessions'),expert});
 const lan=require('../adapters/http/lan-access.cjs'),network=lan.lanConfiguration(lanAddress);
 const server=require('../adapters/http/server.cjs').createServer({...app,health:()=>({...app.health(),trial:{model:'Qwen3.5-0.8B-BF16',contextTokens:16384,maxHistoryRounds:5,maxConcurrentCustomers:5,pid:process.pid}})},{offlineKnowledge,accessGuard:lan.createLanGuard({...network,port})});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve)});
 const runtime={pid:process.pid,port,url:'http://'+network.address+':'+port+'/huiai',loopback:'http://127.0.0.1:'+port+'/huiai',resourcePort:8521};
 fs.writeFileSync(path.join(data,'runtime.json'),JSON.stringify(runtime,null,2));console.log(JSON.stringify(runtime));
 return {server,expert};
}
if(require.main===module)start().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={start};
