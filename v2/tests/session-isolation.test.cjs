'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createOfflineSessions}=require('../adapters/http/offline-session.cjs');
test('Idle recovery keeps records and explicit facts, bounds old context, and protects active work',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-isolation-'));let now=Date.now();
 const s=createOfflineSessions(dir,{now:()=>now});
 try{
  for(let i=0;i<20;i++){s.update('client-a',{message:'A'+i,facts:{modelIds:['R712']}});now++;s.recordAnswer('client-a',{reply:'reply'+i});now++;}
  s.update('client-b',{message:'B'});s.begin('client-b');now+=300001;s.sweep();
  s.update('client-b',{message:'still running'});assert.equal(s.expertState('client-b').messages.length,2);s.end('client-b');
  s.update('client-a',{message:'continue'});const restored=s.expertState('client-a');
  assert.equal(restored.messages.length,13);assert.deepEqual(restored.facts.modelIds,['R712']);assert.ok(restored.messages.every(m=>!m.content.startsWith('B')));
  const archive=fs.readFileSync(path.join(dir,'client-a.history.jsonl'),'utf8');assert.match(archive,/A0/);assert.equal(archive.trim().split('\n').length,41);
 }finally{s.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});
test('HTTP same-session concurrency is rejected before mutation; closing another session cannot cancel its peer',async()=>{
 const pending=new Map(),signals=new Map();
 const api=require('../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({expert:{answer:({sessionState,signal})=>new Promise(resolve=>{
  signals.set(sessionState.id,signal);pending.set(sessionState.id,()=>resolve({status:'answer',reply:sessionState.messages.map(m=>m.content).join('|')}));
  signal.addEventListener('abort',()=>resolve({status:'unavailable',reply:'cancelled'}),{once:true});
 })}});
 const server=http.createServer((req,res)=>api.handle(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const wait=async id=>{for(let i=0;i<100&&!pending.has(id);i++)await new Promise(r=>setTimeout(r,5));assert.ok(pending.has(id));};
 try{
  const a=post('/api/ai/chat',{sessionId:'client-a',message:'A only',mode:'expert',conversationType:'guest'});await wait('client-a');
  const b=post('/api/ai/chat',{sessionId:'client-b',message:'B only',mode:'expert',conversationType:'guest'});await wait('client-b');
  const duplicate=await post('/api/ai/chat',{sessionId:'client-a',message:'must not append',mode:'expert'});assert.equal(duplicate.status,409);
  assert.equal((await post('/v2/offline/session/close',{sessionId:'client-a'})).status,200);
  assert.equal(signals.get('client-a').aborted,true);assert.equal(signals.get('client-b').aborted,false);
  pending.get('client-b')();assert.equal((await (await b).json()).reply,'B only');await a;
  const state=await fetch(base+'/v2/offline/session?id=client-a').then(r=>r.json());assert.ok(!JSON.stringify(state).includes('must not append'));assert.ok(!JSON.stringify(state).includes('B only'));
 }finally{for(const release of pending.values())release();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Long-running requests become idle only after completion, and equal timestamps cannot restore discarded context',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-idle-clock-'));let now=Date.now();const s=createOfflineSessions(dir,{now:()=>now});
 try{
  for(let i=0;i<20;i++){s.update('same-timestamp',{message:'turn'+i});s.recordAnswer('same-timestamp',{reply:'reply'+i});}
  now+=300001;s.update('same-timestamp',{message:'resume'});assert.equal(s.expertState('same-timestamp').messages.length,13);
  s.begin('same-timestamp');now+=600000;s.sweep();s.recordAnswer('same-timestamp',{reply:'completed'});s.end('same-timestamp');
  s.update('same-timestamp',{message:'immediate followup'});assert.equal(s.expertState('same-timestamp').messages.length,15);
  assert.match(fs.readFileSync(path.join(dir,'same-timestamp.history.jsonl'),'utf8'),/turn0/);
 }finally{s.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});
