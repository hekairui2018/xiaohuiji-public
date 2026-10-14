'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../adapters/http/server.cjs');
test('Independent quick/dialogue HTTP adapters run without AI and reject cross-route payloads',async()=>{
 const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const quick=await post('/v2/quick/products',{modelId:'VP620A'});assert.equal(quick.status,200);assert.equal((await quick.json()).status,'found');
  const chat=await post('/v2/dialogue',{schemaVersion:'2.0',operation:'consultation',providedDevices:[{modelId:'VP620A'}]});assert.equal(chat.status,200);assert.equal((await chat.json()).operation,'consultation');
  assert.equal((await post('/v2/dialogue',{modelId:'VP620A'})).status,400);
  assert.equal((await post('/v2/quick/products',{schemaVersion:'2.0',operation:'ordering'})).status,400);
  const invalid=await fetch(base+'/v2/dialogue',{method:'POST',body:'{'});assert.equal(invalid.status,400);
  assert.equal((await fetch(base+'/health').then(r=>r.json())).aiEnabled,false);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
