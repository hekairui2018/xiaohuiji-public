'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
async function fixture(run,actions){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-expert-documents-')),config=path.join(dir,'rag.json');
 fs.writeFileSync(config,JSON.stringify({baseUrl:'http://127.0.0.1:9',apiKey:'synthetic-only',documents:[],datasetIds:[]}));
 const seen={models:0,resourceRequests:[]};
 const api=createOfflineKnowledge({ragflowConfigFile:config,sessionDirectory:path.join(dir,'sessions'),
  expert:require('../model-adapter/evidence-expert.cjs').createEvidenceExpert({transport:async(url)=>{
   if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
   if(url.pathname==='/tokenize')return {ok:false};
   if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
   seen.models++;assert(actions.length,'unexpected generation');const action=actions.shift();
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:typeof action==='string'?action:JSON.stringify(action)}}]})};
  }}),
  resourceAnswer:async(message,{request})=>{seen.resourceRequests.push({message,public:!!request.v2Public});if(require('../domain/knowledge/resource-query.cjs').planResourceQuery(message).social)return {status:'answer',intent:'social',reply:'你好！',model:'v2-offline-search',modelCallCount:0,results:[]};return {status:message.includes('R999')?'not-found':'answer',intent:'resources',reply:message.includes('R999')?'未找到该型号文件':'找到以下资料：测试原件.pdf',model:'v2-offline-search',modelCallCount:0,contextUsed:false,results:message.includes('R999')?[]:[{evidenceId:'synthetic-doc',name:'测试原件.pdf',kind:'spec',resourceOnly:true,download:'/registered/original.pdf'}]};}
 });
 const server=http.createServer((req,res)=>{req.v2Public=req.headers['x-test-public']==='1';api.handle(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end();}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const post=async(message,{sessionId='w-'+crypto.randomUUID(),publicRequest=false}={})=>fetch(base+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json',...(publicRequest?{'X-Test-Public':'1'}:{})},body:JSON.stringify({message,mode:'expert',sessionId,requestId:crypto.randomUUID()})}).then(r=>r.json());
 try{await run({post,seen,base});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
}
const fileRequests=['VP1620规格书发我一份','K12规格书','D16说明书','HDSet操作说明书','给我R716英文规格书','A3L规格书和说明书'];
const plainAnswer=text=>({action:'answer',claims:[],generalAdvice:[text],question:''});
test('Expert chooses quick file delivery, retaining file actions and session archive; missing files return to expert',()=>fixture(async({post,seen,base})=>{
 for(const message of ['VP1620规格书发我一份','K12规格书','D16说明书','HDSet操作说明书','给我R716英文规格书','A3L规格书和说明书']){
  const sessionId='w-'+crypto.randomUUID(),r=await post(message,{sessionId});assert.equal(r.status,'answer',message);assert.equal(r.actualMode,'expert');assert.equal(r.delegatedTo,'quick');assert.equal(r.modelCallCount,1);assert.equal(r.results[0].download,'/registered/original.pdf');assert(!r.reply.includes('摘要'));
  const state=await fetch(base+'/v2/offline/session?id='+sessionId).then(r=>r.json());assert.deepEqual(state.messages.map(m=>m.role),['user','assistant']);assert.equal(state.messages[1].content,r.reply);
 }
 assert.equal(seen.models,6);assert.equal(seen.resourceRequests.length,6);
 const unknown=await post('R999规格书');assert.equal(unknown.status,'answer');assert.match(unknown.reply,/未找到/);assert.equal(unknown.results.length,0);assert.equal(unknown.modelCallCount,2);assert.equal(seen.models,8);
},[...fileRequests.map(query=>({action:'quick',query,respondDirectly:true})),{action:'quick',query:'R999规格书',respondDirectly:true},plainAnswer('当前目录未找到已确认的R999规格书。')]));
test('Document content and parameter requests keep expert generation; public scope cannot enter the private shortcut',()=>fixture(async({post,seen})=>{
 for(const message of ['VP1620规格书里的带载是多少','A3L规格书和输入电源多少','R712灰阶多少']){const r=await post(message);assert.equal(r.reply,'正文专家回答');assert.equal(r.modelCallCount,1);}
 assert.equal(seen.models,3);
 const before=seen.resourceRequests.length;await post('K12规格书',{publicRequest:true});assert.equal(seen.models,4);assert.equal(seen.resourceRequests.length,before);
},Array.from({length:4},()=>plainAnswer('正文专家回答'))));
test('Expert handles greetings without retrieval and owns the following document task',()=>fixture(async({post,seen,base})=>{
 const sessionId='w-'+crypto.randomUUID();for(const message of ['你好','谢谢','您好']){const r=await post(message,{sessionId});assert.equal(r.modelCallCount,1);assert.equal(r.status,'answer');assert.equal(r.actualMode,'expert');}
 assert.equal(seen.resourceRequests.length,0);
 const file=await post('你好，R712规格书',{sessionId});assert.equal(file.delegatedTo,'quick');assert(file.results.length);assert.equal(seen.models,4);assert.equal(seen.resourceRequests.length,1);
 const state=await fetch(base+'/v2/offline/session?id='+sessionId).then(r=>r.json());assert.equal(state.messages.length,8);assert.equal(state.messages[6].content,'你好，R712规格书');
},['你好！','不客气。','你好！',{action:'quick',query:'R712规格书',respondDirectly:true}]));
