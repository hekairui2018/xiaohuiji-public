'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../frontend/directory-page-cache.js');
test('directory pages coalesce in-flight requests, isolate callers and expire',async()=>{
 let calls=0,time=0;const cache=create({now:()=>time,ttl:10,load:async()=>{calls++;return {entries:[{name:'original'}]};}});
 const [a,b]=await Promise.all([cache.get({directory:'a'}),cache.get({directory:'a'})]);assert.equal(calls,1);a.entries[0].name='mutated';assert.equal(b.entries[0].name,'original');assert.equal((await cache.get({directory:'a'})).entries[0].name,'original');assert.equal(calls,1);time=11;await cache.get({directory:'a'});assert.equal(calls,2);
});
test('failed pages retry and a refreshed root version invalidates stale children',async()=>{
 let version='one',calls=0,time=0,fail=true;const cache=create({now:()=>time,ttl:10,load:async args=>{calls++;if(args.directory==='bad'&&fail){fail=false;throw Error('offline');}return {catalogVersion:version,entries:[]};}});
 await assert.rejects(cache.get({directory:'bad'}));await cache.get({directory:'bad'});await cache.get();await cache.get({directory:'child'});time=11;version='two';await cache.get();const before=calls;await cache.get({directory:'child'});assert.equal(calls,before+1);
});
