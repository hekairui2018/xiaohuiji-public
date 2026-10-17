'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../adapters/http/server.cjs');
test('Wiki is the V2 entry everywhere; legacy page is removed and internal API alias remains compatible',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const [route,target] of [['/','/wiki'],['/wiki/?q=R712','/wiki?q=R712']]){const r=await fetch(base+route,{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),target);}
  assert.equal((await fetch(base+'/quick?cat=manual&q=A4',{redirect:'manual'})).status,404);
  const page=await fetch(base+'/wiki');assert.equal(page.status,200);
  const script=await fetch(base+'/app.js').then(r=>r.text());assert.match(script,/quick: "\/wiki"/);assert.ok(!/["']\/quick["']/.test(script));
  assert.equal((await fetch(base+'/huiai')).status,200);
  const body=JSON.stringify({schemaVersion:'2.0',modelId:'HD-R712'}),options={method:'POST',headers:{'Content-Type':'application/json'},body};
  assert.deepEqual(await fetch(base+'/v2/wiki/products',options).then(r=>r.json()),await fetch(base+'/v2/quick/products',options).then(r=>r.json()));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
