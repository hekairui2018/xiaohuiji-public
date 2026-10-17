'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{gunzipSync}=require('node:zlib');
const {createCatalogResponseCache}=require('../adapters/http/catalog-response-cache.cjs');
function response(){return {writeHead(code,headers){this.code=code;this.headers=headers;},end(body){this.body=body;}};}
test('category switches reuse response; encoding, expiry and keys remain isolated',async()=>{
 let clock=0,calls=0;const cache=createCatalogResponseCache({now:()=>clock,ttl:30});
 const load=async()=>({value:++calls});
 const a=response();await cache({headers:{'accept-encoding':'gzip'}},a,'spec',load);
 assert.deepEqual(JSON.parse(gunzipSync(a.body)),{value:1});
 await cache({headers:{}},response(),'manual',load);
 const b=response();await cache({headers:{'accept-encoding':'gzip;q=0'}},b,'spec',load);
 assert.equal(calls,2);assert.deepEqual(JSON.parse(b.body),{value:1});assert.equal(b.headers['Content-Encoding'],undefined);
 clock=31;await cache({headers:{}},response(),'spec',load);assert.equal(calls,3);
});
test('parallel requests coalesce and failures can retry',async()=>{
 const cache=createCatalogResponseCache();let calls=0;
 await Promise.all([1,2,3].map(()=>cache({headers:{}},response(),'spec',async()=>{calls++;return {ok:true};})));
 assert.equal(calls,1);
 await assert.rejects(cache({headers:{}},response(),'pending',async()=>{throw Error('failed');}));
 const r=response();await cache({headers:{}},r,'pending',async()=>({ok:true}));assert.equal(r.code,200);
});
