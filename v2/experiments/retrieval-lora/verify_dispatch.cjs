'use strict';
// Exercise existing read-only V2 tools in an ephemeral application, never the live expert.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../../..'),work=path.join(root,'tmp/retrieval-lora-20261020');
const input=JSON.parse(fs.readFileSync(path.join(work,'results/interface-verification.json'),'utf8'));
const {loadKnowledge}=require('../../adapters/data/load-knowledge.cjs'),{createApp}=require('../../app/bootstrap.cjs');
const knowledge=loadKnowledge(path.join(root,'v2/data/knowledge-next'),{manifestFile:'candidate-manifest.json'}),app=createApp({knowledge});
const actions=input.requests.filter(r=>r.status===200&&r.action.action==='search');
const receipts=[];
(async()=>{
 const child=require('node:child_process').spawn(process.env.XHJ_EXPERIMENT_SYSTEM_PYTHON||'python',[path.join(root,'v2/resource-index/server.py'),'--work',path.join(root,'tmp/resource-index-stage1-20261016'),'--port','0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const resourceBase=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('temporary index readiness timeout')),20000);child.once('error',reject);child.once('exit',code=>reject(Error('temporary index exited '+code)));child.stdout.on('data',chunk=>{text+=chunk;const match=/http:\/\/127\.0\.0\.1:(\d+)/.exec(text);if(match){clearTimeout(timer);resolve(match[0]);}});child.stderr.on('data',chunk=>process.stderr.write(chunk));});
 try{
 for(const [index,item] of actions.entries()){
  const api=require('../../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({app,knowledge,resourceBase,expert:{answer:async({execute})=>{
   const result=await execute('search_evidence',item.action);
   const handle=result.evidence?.find(e=>e.readAvailable&&e.blockId);
   let read=null;if(handle)read=await execute('read_document',{action:'read',blockId:handle.blockId});
   receipts.push({message:item.message,action:item.action,retrievalSucceeded:true,evidenceCount:result.evidence?.length||0,readPerformed:!!read,readEvidenceCount:read?.evidence?.length||0});
   return {status:'answer',reply:'isolated tool compatibility check',results:[]};
  }}});
  const server=http.createServer((req,res)=>api.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:item.message,mode:'expert',sessionId:'lora-compatibility-'+index})});
   const result=await response.json();if(response.status!==200||result.status!=='answer')throw Error(JSON.stringify(result));
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 }
 fs.writeFileSync(path.join(work,'results/dispatch-verification.json'),JSON.stringify({passed:true,modelCalls:0,temporaryApp:true,readOnlyIndex:resourceBase,temporaryReadOnlyIndex:true,productionConfigChanged:false,receipts},null,2));
 console.log(JSON.stringify({passed:true,actions:actions.length,receipts}));
 }finally{child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
