'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const original=path.resolve(__dirname,'../model-adapter/evidence-expert.cjs');
let createEvidenceExpert;
if(process.env.XHJ_EXPERT_CANDIDATE){const m=new Module(original,module);m.filename=original;m.paths=Module._nodeModulePaths(path.dirname(original));m._compile(fs.readFileSync(process.env.XHJ_EXPERT_CANDIDATE,'utf8'),original);({createEvidenceExpert}=m.exports);}else({createEvidenceExpert}=require(original));
const tags=['SESSION_ALPHA','SESSION_BRAVO','SESSION_CHARLIE','SESSION_DELTA'];
function harness(t,maxConcurrent=3){
 const calls=[],pending=new Map(),diagnostics=[];
 const expert=createEvidenceExpert({maxConcurrent,onDiagnostic:entry=>diagnostics.push(entry),transport:async(url,options)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'bonsai',owned_by:'ninfer'}]})};
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:16384}})};
  if(url.pathname==='/tokenize')return {ok:false};
  const payload=JSON.parse(options.body),body=JSON.stringify(payload),found=tags.filter(tag=>body.includes(tag));
  assert.equal(found.length,1,'A model request must contain only its own session history/evidence');
  const tag=found[0];calls.push({tag,payload});
  await new Promise((resolve,reject)=>{const abort=()=>{pending.delete(tag);reject(options.signal.reason);};options.signal?.addEventListener('abort',abort,{once:true});pending.set(tag,()=>{pending.delete(tag);options.signal?.removeEventListener('abort',abort);resolve();});});
  return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'answer',claims:[{text:tag+' documentation',evidenceIds:['s1']}]})}}]})};
 }});
 t.after(()=>{for(const done of pending.values())done();});
 const ask=(tag,signal)=>expert.answer({message:'请总结本会话测试资料',sessionState:{id:tag,messages:[{role:'user',content:tag+' confidential synthetic history'}],facts:{},checks:[]},route:{intent:'technical'},preparedEvidence:[{evidenceId:'proof-'+tag,name:tag,text:tag+' documentation',readPerformed:true,modelIds:[]}],signal,execute:async()=>{throw Error('Unexpected tool round');}});
 const wait=async(n)=>{for(let i=0;i<100;i++){if(pending.size===n)return;await new Promise(r=>setTimeout(r,5));}throw Error('Expected '+n+' simultaneous model requests, got '+pending.size);};
 return {expert,calls,pending,ask,wait,diagnostics};
}
test('Three sessions overlap; their histories, evidence and replies stay isolated; duplicates refused and fourth request queues',async t=>{
 const h=harness(t),runs=tags.slice(0,3).map(tag=>h.ask(tag));await h.wait(3);
 assert.equal((await h.ask(tags[0])).error,'session-request-active');
 const fourth=h.ask(tags[3]);await new Promise(r=>setTimeout(r,15));assert.equal(h.calls.length,3);
 for(const done of h.pending.values())done();
 await h.wait(1);assert.equal(h.calls.at(-1).tag,tags[3]);h.pending.get(tags[3])();assert.equal((await fourth).status,'answer');
 const results=await Promise.all(runs);
 for(let i=0;i<3;i++){const r=results[i];assert.equal(r.status,'answer');assert.equal(r.modelCallCount,1);assert.ok(r.reply.includes(tags[i]));assert.deepEqual(r.claims[0].evidenceIds,['proof-'+tags[i]]);for(const other of tags.filter(tag=>tag!==tags[i]))assert.ok(!JSON.stringify(r).includes(other));}
});
test('Cancelling one session releases only its slot; other sessions finish and a new session is admitted',async t=>{
 const h=harness(t),cancel=new AbortController(),a=h.ask(tags[0],cancel.signal),b=h.ask(tags[1]),c=h.ask(tags[2]);await h.wait(3);
 cancel.abort(new DOMException('Test caller closed','AbortError'));
 assert.equal((await a).error,'expert-cancelled');assert.equal(h.pending.size,2);
 const d=h.ask(tags[3]);await h.wait(3);
 for(const done of h.pending.values())done();
 for(const r of await Promise.all([b,c,d]))assert.equal(r.status,'answer');
});
test('Concurrency is bounded and the one-request setting retains its behavior',async t=>{
 assert.throws(()=>createEvidenceExpert({maxConcurrent:0}),/concurrency/);assert.throws(()=>createEvidenceExpert({maxConcurrent:6}),/concurrency/);
 const h=harness(t,1),a=h.ask(tags[0]);await h.wait(1);const b=h.ask(tags[1]);await new Promise(r=>setTimeout(r,15));assert.equal(h.calls.length,1);h.pending.get(tags[0])();assert.equal((await a).status,'answer');await h.wait(1);h.pending.get(tags[1])();assert.equal((await b).status,'answer');
});

test('Cancelling a queued request prevents generation and does not consume a later slot',async t=>{
 const h=harness(t),runs=tags.slice(0,3).map(tag=>h.ask(tag));await h.wait(3);const cancel=new AbortController(),queued=h.ask(tags[3],cancel.signal);await new Promise(r=>setTimeout(r,15));cancel.abort(new DOMException('Cancel queued','AbortError'));assert.equal((await queued).error,'expert-cancelled');assert.equal(h.calls.length,3);for(const done of h.pending.values())done();await Promise.all(runs);const next=h.ask(tags[3]);await h.wait(1);h.pending.get(tags[3])();assert.equal((await next).status,'answer');
});

test('Admission wait is attributed to its own session, with zero wait for an idle slot',async t=>{
 const h=harness(t,1),a=h.ask(tags[0]);await h.wait(1);
 const b=h.ask(tags[1]);await new Promise(r=>setTimeout(r,25));
 h.pending.get(tags[0])();await a;await h.wait(1);h.pending.get(tags[1])();await b;
 const first=h.diagnostics.find(d=>d.sessionId===tags[0]);
 const second=h.diagnostics.find(d=>d.sessionId===tags[1]);
 assert.equal(first.queueWaitMs,0);assert.ok(second.queueWaitMs>=20);
});
