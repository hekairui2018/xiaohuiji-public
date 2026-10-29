'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createExpertProtection}=require('../model-adapter/expert-protection.cjs');
const at=time=>Date.parse('2026-10-29T'+time+'+08:00');
test('daily service window has exact boundaries and does not contact model outside hours',async()=>{
 let clock=at('08:29:59'),calls=0;const guard=createExpertProtection({now:()=>clock,intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:1300}]});await guard.refresh();
 const expert=guard.wrap({status:async()=>{calls++;return {available:true};},answer:async()=>{calls++;return {status:'answer'};}});
 assert.equal((await expert.status()).available,false);assert.equal((await expert.answer({})).modelCallCount,0);assert.equal(calls,0);
 clock=at('08:30:00');await guard.refresh();assert.equal((await expert.status()).available,true);
 clock=at('17:59:59');await guard.refresh();assert.equal(guard.access().available,true);
 clock=at('18:00:00');await guard.refresh();assert.equal(guard.access().reason,'closed');guard.dispose();
});
test('hot GPU cancels in-flight work and persistent latch blocks restart retries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-guard-')),stateFile=path.join(dir,'state.json');let temperature=40;
 const settings={now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,stateFile,probe:async()=>[{temperature,freeMiB:1200}]},guard=createExpertProtection(settings);await guard.refresh();
 let aborted=false;const expert=guard.wrap({answer:({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({status:'unavailable',modelCallCount:1});},{once:true}))});
 const answer=expert.answer({});temperature=86;await guard.refresh();const output=await answer;assert.equal(aborted,true);assert.equal(output.error,'expert-protected');assert.equal(guard.access().reason,'gpu-hot');guard.dispose();
 temperature=30;const restarted=createExpertProtection(settings);await restarted.refresh();assert.equal(restarted.access().reason,'gpu-hot');restarted.dispose();fs.rmSync(dir,{recursive:true});
});
test('reserved model VRAM alone does not trip; low free VRAM and missing metrics do',async()=>{
 for(const [probe,reason]of [[async()=>[{temperature:32,freeMiB:1350}],null],[async()=>[{temperature:32,freeMiB:200}],'gpu-memory']]){
  const guard=createExpertProtection({now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe});await guard.refresh();assert.equal(guard.access().reason,reason);guard.dispose();
 }
 const guard=createExpertProtection({now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>{throw Error('driver lost');}});await guard.refresh();assert.equal(guard.access().reason,'gpu-unavailable');guard.dispose();
});
test('transport failure latches but customer cancellation does not',async()=>{
 for(const cancelled of [false,true]){const guard=createExpertProtection({now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:1200}]});await guard.refresh();const controller=new AbortController();if(cancelled)controller.abort();await assert.rejects(guard.transport(async()=>{throw Error('connection reset');})('http://localhost',{signal:controller.signal}));assert.equal(guard.access().reason,cancelled?null:'model-fault');guard.dispose();}
});
test('host memory exhaustion and CUDA errors trip protection',async()=>{
 const settings={now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:1200}]};
 const low=createExpertProtection({...settings,hostFreeMiB:()=>500});await low.refresh();assert.equal(low.access().reason,'host-memory');low.dispose();
 const cuda=createExpertProtection(settings);await cuda.refresh();await cuda.transport(async()=>({ok:false,status:400,json:async()=>({error:'CUDA out of memory'})}))('http://localhost');assert.equal(cuda.access().reason,'model-fault');cuda.dispose();
});
test('closing window cancels queued and active requests before model reuse',async()=>{
 let clock=at('17:59:59'),aborted=false;const guard=createExpertProtection({now:()=>clock,intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:1200}]});await guard.refresh();const pending=guard.wrap({answer:({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({status:'unavailable'});}))}).answer({});clock=at('18:00:00');await guard.refresh();assert.equal((await pending).error,'expert-protected');assert.equal(aborted,true);guard.dispose();
});
