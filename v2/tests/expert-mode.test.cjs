'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const {createOfflineSessions}=require('../adapters/http/offline-session.cjs');
test('Guest and normal sessions retain backend questions and model replies with explicit type',()=>{
 const fs=require('fs'),os=require('os'),path=require('path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-guest-session-'));
 try{let s=createOfflineSessions(dir);for(const type of ['normal','guest']){s.update(type+'-test',{message:'R708',conversationType:type});s.recordAnswer(type+'-test',{reply:'synthetic reply',model:'synthetic',status:'answer'});}s=createOfflineSessions(dir);for(const type of ['normal','guest']){const r=s.get(type+'-test');assert.equal(r.conversationType,type);assert.deepEqual(r.messages.map(m=>m.role),['user','assistant']);assert.match(fs.readFileSync(path.join(dir,type+'-test.history.jsonl'),'utf8'),/synthetic reply/);}assert.throws(()=>s.update('bad-session',{message:'x',conversationType:'invalid'}));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Closing guest releases usable context without deleting backend archive or closing normal conversations',()=>{
 const s=createOfflineSessions();s.update('guest-release',{message:'original',conversationType:'guest'});s.recordAnswer('guest-release',{reply:'answer'});assert.equal(s.closeGuest('guest-release').contextReleased,true);assert.equal(s.get('guest-release').messages.length,2);assert.ok(s.get('guest-release').closedAt);assert.throws(()=>s.update('guest-release',{message:'must not resume'}),/session-closed/);s.update('normal-stays',{message:'keep',conversationType:'normal'});assert.throws(()=>s.closeGuest('normal-stays'),/not-guest/);
});
test('Expert inference disables persistent prompt cache and aborts when the conversation closes',async()=>{
 const controller=new AbortController();let seen=false;const expert=createEvidenceExpert({transport:async(url,options)=>{if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};assert.equal(JSON.parse(options.body).cache_prompt,false);seen=true;controller.abort();options.signal.throwIfAborted();}});const r=await expert.answer({message:'x',sessionState:{},execute:async()=>({}),signal:controller.signal});assert.equal(seen,true);assert.equal(r.status,'unavailable');
});
function fake(outputs){let calls=0;return {transport:async(url,options)=>{if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic-local-model'}]})};calls++;return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(outputs.shift())}}],usage:{prompt_tokens:10,completion_tokens:5}})};},calls:()=>calls};}
test('Expert really executes read-only retrieval and binds final claims to provided evidence',async()=>{
 const f=fake([{action:'search',query:'Z9',kind:'text'},{action:'read',blockId:2},{action:'answer',claims:[{text:'原文记录',evidenceIds:['block-2']}],question:''}]);const seen=[];
 const r=await createEvidenceExpert(f).answer({message:'请查资料',sessionState:{messages:[],facts:{modelIds:['Z9']},checks:[]},execute:async(name,args)=>{seen.push(name);return {evidence:[{evidenceId:'block-2',blockId:2,text:'原文记录'}]};}});
 assert.equal(r.actualMode,'expert');assert.equal(r.status,'answer');assert.equal(f.calls(),3);assert.deepEqual(seen,['search_evidence','read_document']);assert.equal(r.claims[0].evidenceIds[0],'block-2');
});
test('Missing or invented citations fail explicitly and do not silently fall back',async()=>{
 const f=fake([{action:'search',query:'Z9',kind:'text'},{action:'answer',claims:[{text:'虚构结论',evidenceIds:['fake-id']}],question:''}]);const r=await createEvidenceExpert(f).answer({message:'问题',sessionState:{},execute:async()=>({evidence:[]})});assert.equal(r.error,'expert-invalid-citation');assert.equal(r.status,'unavailable');assert.equal(r.actualMode,'expert');assert.ok(!r.reply.includes('虚构结论'));
});
test('Offline model does not load weights or pretend to answer',async()=>{
 const model=createEvidenceExpert({transport:async()=>{throw Error('offline');}});assert.equal((await model.status()).available,false);const r=await model.answer({message:'x',sessionState:{},execute:async()=>{throw Error('must not execute');}});assert.equal(r.error,'expert-model-offline');
 assert.throws(()=>createEvidenceExpert({baseUrl:'https://external.example'}));
});
test('Empty facts retain confirmed prior model; explicit correction and clearing stay distinguishable',()=>{
 const s=createOfflineSessions();s.update('test-session',{message:'第一轮',facts:{modelIds:['R712']}});s.update('test-session',{message:'第二轮',facts:{modelIds:[]}});assert.deepEqual(s.get('test-session').facts.modelIds,['R712']);
 s.update('test-session',{message:'修正',facts:{modelIds:['R716']}});assert.deepEqual(s.get('test-session').facts.modelIds,['R716']);s.update('test-session',{message:'撤回',clearFacts:['modelIds']});assert.equal(s.get('test-session').facts.modelIds,undefined);
});

test('HTTP guest close is reachable, archives messages and refuses resuming closed context',async()=>{
 const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-close-route-'));const api=require('../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({sessionDirectory:dir,expert:{answer:async()=>({status:'answer',reply:'synthetic answer'})}});const server=http.createServer((req,res)=>api.handle(req,res).then(handled=>{if(!handled){res.statusCode=404;res.end();}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{const input={sessionId:'guest-http-test',message:'synthetic',conversationType:'guest',mode:'expert'};assert.equal((await post('/api/ai/chat',input)).status,200);assert.equal((await post('/v2/offline/session/close',{sessionId:input.sessionId})).status,200);const state=await fetch(base+'/v2/offline/session?id='+input.sessionId).then(r=>r.json());assert.ok(state.closedAt);assert.equal(state.messages.length,2);assert.equal((await post('/api/ai/chat',input)).status,400);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

