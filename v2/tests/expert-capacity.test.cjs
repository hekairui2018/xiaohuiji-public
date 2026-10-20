'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const {createExpertContext}=require('../model-adapter/expert-context.cjs');
function local(actions,requests=[]){return async(url,init)=>{
 if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic-local'}]})};
 if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
 if(url.pathname==='/tokenize')return {ok:true,json:async()=>({tokens:Array(Math.ceil(JSON.parse(init.body).content.length/2)).fill(1)})};
 const body=JSON.parse(init.body);requests.push(body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(actions.shift())},finish_reason:'stop'}],usage:{prompt_tokens:500,completion_tokens:30}})};
};}
const answer={action:'answer',claims:[],generalAdvice:['按现场条件逐项核对，原因待验证。'],question:''};
test('Expert retains more than six messages and 32000 characters when the running capacity permits',async()=>{
 const requests=[],history=Array.from({length:40},(_,i)=>({role:i%2?'assistant':'user',content:'现场条件'+i+'：'+('甲'.repeat(1000))}));
 const r=await createEvidenceExpert({transport:local([answer],requests)}).answer({message:'还是这样',sessionState:{messages:history}});
 assert.equal(r.status,'answer');const input=JSON.parse(requests[0].messages[1].content);assert.equal(input.history.length,40);assert.match(input.history[0].content,/现场条件0/);assert.ok(r.modelCalls[0].contextUsage.serializedCharacters>32000);assert.equal(r.modelCalls[0].contextUsage.capacityTokens,131072);
});
test('Seven distinct retrieval goals remain available beyond the former 4-tool/5-model ceiling',async()=>{
 const actions=Array.from({length:7},(_,i)=>({action:'search',query:'条件'+i,kind:'text',concepts:['条件'+i],goals:['核实不同条件'],reason:'核实不同的缺失证据'}));let tools=0;
 const r=await createEvidenceExpert({transport:local([...actions,answer])}).answer({message:'核对现场',execute:async()=>{tools++;return {evidence:[]};}});
 assert.equal(r.status,'answer');assert.equal(tools,7);assert.equal(r.modelCallCount,8);assert.equal(r.toolCallCount,7);
});
test('Identical cached requests cannot loop forever or cause repeated underlying retrieval',async()=>{
 const search={action:'search',query:'相同问题',kind:'text'};let tools=0;
 const r=await createEvidenceExpert({transport:local(Array(5).fill(search))}).answer({message:'核对现场',execute:async()=>{tools++;return {evidence:[]};}});
 assert.equal(r.error,'expert-repeated-tool');assert.equal(tools,1);assert.equal(r.modelCallCount,3);
});
test('Capacity pressure evicts old exchanges only, preserving current evidence and explicit conditions',async()=>{
 const c=createExpertContext({base:new URL('http://localhost'),transport:async(url,init)=>({ok:true,json:async()=>url.pathname==='/props'?{default_generation_settings:{n_ctx:16000}}:{tokens:Array(JSON.parse(init.body).content.length).fill(1)}})});
 const input={message:'当前问题',facts:{model:'C16L'},history:Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'旧条件'+i+'甲'.repeat(1000)}))};
 const messages=[{role:'system',content:'source safety'},{role:'user',content:''},{role:'user',content:'已读原文：保留当前证据'}];
 const r=await c.prepare(messages,input,null,8192);assert.ok(r.droppedHistoryMessages>0);assert.ok(r.inputTokens+r.reservedOutputTokens+r.templateSafetyTokens<=16000);assert.equal(input.facts.model,'C16L');assert.match(messages[2].content,/保留当前证据/);
});
test('Expert reconstructs older archived turns without changing the quick session window; closed guests stay closed',()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'expert-history-'));
 try{const sessions=require('../adapters/http/offline-session.cjs').createOfflineSessions(dir);for(let i=0;i<22;i++){sessions.update('history-test',{message:'现场条件'+i});sessions.recordAnswer('history-test',{reply:'核查回复'+i});}
 assert.equal(sessions.get('history-test').messages.length,30);const full=sessions.expertState('history-test');assert.equal(full.messages.length,44);assert.equal(full.messages[0].content,'现场条件0');sessions.update('guest-test',{message:'现场',conversationType:'guest'});sessions.closeGuest('guest-test');assert.throws(()=>sessions.expertState('guest-test'),/session-closed/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Local inference transport preserves cancellation while waiting for response headers',async()=>{
 const http=require('http'),{localModelTransport}=require('../model-adapter/local-model-transport.cjs');
 const server=http.createServer(()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const controller=new AbortController(),pending=localModelTransport(new URL('http://127.0.0.1:'+server.address().port),{signal:controller.signal});setTimeout(()=>controller.abort(),20);await assert.rejects(pending,error=>error.name==='AbortError');}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
