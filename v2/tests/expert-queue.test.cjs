'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createExpertQueue}=require('../model-adapter/expert-queue.cjs');
test('Five distinct sessions enter; the sixth waits until one releases',async()=>{
 const queue=createExpertQueue({maxConcurrent:5}),releases=[];
 for(let i=0;i<5;i++)releases.push(await queue.acquire({session:'five-'+i}));
 let entered=false;const sixth=queue.acquire({session:'sixth'}).then(release=>{entered=true;return release;});
 await Promise.resolve();assert.equal(entered,false);
 releases[0]();const releaseSixth=await sixth;assert.equal(entered,true);
 releaseSixth();for(const release of releases)release();
});
test('FIFO queue reserves session identity, advances position and bounds total waiting requests',async()=>{
 const queue=createExpertQueue({maxConcurrent:1,maxWaiting:2}),releaseA=await queue.acquire({session:'A'}),order=[],positions=[];
 const b=queue.acquire({session:'B',onQueued:p=>positions.push(['B',p])}).then(release=>{order.push('B');return release;});
 const c=queue.acquire({session:'C',onQueued:p=>positions.push(['C',p])}).then(release=>{order.push('C');return release;});
 await assert.rejects(()=>queue.acquire({session:'B'}),/session-request-active/);await assert.rejects(()=>queue.acquire({session:'D'}),/queue-full/);
 releaseA();const releaseB=await b;assert.deepEqual(order,['B']);assert.ok(positions.some(([s,p])=>s==='C'&&p===1));releaseB();const releaseC=await c;assert.deepEqual(order,['B','C']);releaseC();releaseC();
 const release=await queue.acquire({session:'A'});release();
});
test('Aborted waiters leave capacity and other session cancellations untouched',async()=>{
 const queue=createExpertQueue({maxConcurrent:1}),releaseA=await queue.acquire({session:'A'}),controller=new AbortController();
 const b=queue.acquire({session:'B',signal:controller.signal});controller.abort(new DOMException('Only B','AbortError'));await assert.rejects(()=>b,{name:'AbortError'});releaseA();const releaseB=await queue.acquire({session:'B'});releaseB();
});

test('three sessions run and fourth queues without crossing session ownership',async()=>{
 const queue=require('../model-adapter/expert-queue.cjs').createExpertQueue({maxConcurrent:3}),releases=[];
 for(const session of ['a','b','c'])releases.push(await queue.acquire({session}));
 let entered=false;const fourth=queue.acquire({session:'d'}).then(release=>{entered=true;return release;});
 await Promise.resolve();assert.equal(entered,false);releases[0]();const release=await fourth;assert.equal(entered,true);release();releases.forEach(release=>release());
});
