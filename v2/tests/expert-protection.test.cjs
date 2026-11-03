'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createExpertProtection}=require('../model-adapter/expert-protection.cjs');
const at=time=>Date.parse('2026-10-29T'+time+'+08:00');
test('temperature-only policy ignores low GPU and host memory',async()=>{
 const guard=createExpertProtection({now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>{throw Error('must not inspect host reserve');},probe:async()=>[{temperature:40,freeMiB:0}]});await guard.refresh();assert.equal(guard.access().available,true);assert.equal(guard.access().protection.policy,'temperature-only');assert.equal(guard.access().protection.temperatureLimit,85);guard.dispose();
});

test('authorized local test lease expires and cannot override GPU protection',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-lease-')),stateFile=path.join(dir,'state.json');let clock=at('22:00:00'),temperature=40;
 const guard=createExpertProtection({scheduleEnabled:true,stateFile,now:()=>clock,intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature,freeMiB:1500}]});
 const lease={purpose:'authorized-local-test',startedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+3600000).toISOString()};
 fs.writeFileSync(stateFile+'.test-window',JSON.stringify(lease));await guard.refresh();assert.equal(guard.access().available,true);
 clock+=3600000;assert.equal(guard.access().reason,'closed');
 clock=at('22:00:00');fs.writeFileSync(stateFile+'.test-window',JSON.stringify({...lease,expiresAt:new Date(clock+10800000).toISOString()}));assert.equal(guard.access().reason,'closed');
 fs.writeFileSync(stateFile+'.test-window',JSON.stringify(lease));temperature=86;await guard.refresh();assert.equal(guard.access().reason,'gpu-hot');
 guard.dispose();fs.rmSync(dir,{recursive:true});
});
test('daily service window has exact boundaries and does not contact model outside hours',async()=>{
 let clock=at('08:29:59'),calls=0;const guard=createExpertProtection({scheduleEnabled:true,now:()=>clock,intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:1300}]});await guard.refresh();
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
test('low free VRAM and unavailable probes do not latch; probe diagnostics remain visible',async()=>{
 for(const [probe,reason]of [[async()=>[{temperature:32,freeMiB:1350}],null],[async()=>[{temperature:32,freeMiB:0}],null]]){
  const guard=createExpertProtection({now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe});await guard.refresh();assert.equal(guard.access().reason,reason);guard.dispose();
 }
 const guard=createExpertProtection({now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>{throw Error('driver lost');}});await guard.refresh();assert.equal(guard.access().reason,null);assert.equal(guard.access().protection.probeError,'temperature-probe-unavailable');guard.dispose();
});
test('transport failures propagate without a protection latch',async()=>{
 for(const cancelled of [false,true]){const guard=createExpertProtection({now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:1200}]});await guard.refresh();const controller=new AbortController();if(cancelled)controller.abort();await assert.rejects(guard.transport(async()=>{throw Error('connection reset');})('http://localhost',{method:'POST',signal:controller.signal}));assert.equal(guard.access().reason,null);guard.dispose();}
});
test('host memory and CUDA errors do not create a GPU protection latch',async()=>{
 const settings={now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:1200}]};
 const low=createExpertProtection({...settings,hostFreeMiB:()=>500});await low.refresh();assert.equal(low.access().reason,null);low.dispose();
 const cuda=createExpertProtection(settings);await cuda.refresh();await cuda.transport(async()=>({ok:false,status:400,json:async()=>({error:'CUDA out of memory'})}))('http://localhost',{method:'POST'});assert.equal(cuda.access().reason,null);cuda.dispose();
});
test('closing window cancels queued and active requests before model reuse',async()=>{
 let clock=at('17:59:59'),aborted=false;const guard=createExpertProtection({scheduleEnabled:true,now:()=>clock,intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:1200}]});await guard.refresh();const pending=guard.wrap({answer:({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({status:'unavailable'});}))}).answer({});clock=at('18:00:00');await guard.refresh();assert.equal((await pending).error,'expert-protected');assert.equal(aborted,true);guard.dispose();
});

test('offline health probe after intentional shutdown does not prevent the next scheduled start',async()=>{
 const guard=createExpertProtection({now:()=>at('10:00:00'),intervalMs:0,hostFreeMiB:()=>8192,probe:async()=>[{temperature:40,freeMiB:11000}]});await guard.refresh();
 await assert.rejects(guard.transport(async()=>{throw Error('offline');})('http://localhost/v1/models'));
 assert.equal(guard.access().available,true);guard.dispose();
});

test('legacy non-temperature faults are retained as diagnostics instead of blocking the expert',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-temp-only-')),stateFile=path.join(dir,'state.json');try{for(const reason of ['gpu-unavailable','gpu-memory','host-memory','model-fault']){fs.writeFileSync(stateFile,JSON.stringify({fault:{reason,at:new Date(at('09:00:00')).toISOString()}}));const guard=createExpertProtection({stateFile,now:()=>at('10:00:00'),intervalMs:0,probe:async()=>[{temperature:40}]});await guard.refresh();assert.equal(guard.access().available,true);assert.equal(guard.access().protection.ignoredLegacyFault.reason,reason);guard.dispose();}}finally{fs.rmSync(dir,{recursive:true});}});

test('disabled schedule permits midnight, early morning and evening; temperature protection remains active',async()=>{
 for(const time of ['00:00:00','08:29:59','18:00:00','23:59:59']){let temperature=40;const guard=createExpertProtection({now:()=>at(time),intervalMs:0,probe:async()=>[{temperature}]});await guard.refresh();assert.equal(guard.access().available,true);assert.equal(guard.access().schedule.enabled,false);assert.equal(guard.access().schedule.closes,null);const expert=guard.wrap({answer:async()=>({status:'answer',modelCallCount:1})});assert.equal((await expert.answer({})).status,'answer');temperature=85;await guard.refresh();assert.equal(guard.access().reason,'gpu-hot');guard.dispose();}
});
