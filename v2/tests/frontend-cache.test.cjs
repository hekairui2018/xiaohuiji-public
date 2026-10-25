'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {serveStatic}=require('../adapters/http/static-service.cjs');
test('Chat entry bypasses stale HTML and mutable scripts require cache validation',async()=>{
 const server=http.createServer((req,res)=>{if(!serveStatic(req,res,undefined,{offlineKnowledge:true})){res.statusCode=404;res.end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/huiai'),html=await response.text();
  assert.equal(response.headers.get('cache-control'),'no-store');
  for(const name of ['chat-controller.js','offline-client.js','styles.css']){
   const versioned=html.match(new RegExp(name.replace('.','\\.')+'[?]v=[^"\\s]+'))?.[0];assert.ok(versioned,name);
   const asset=await fetch(base+'/'+versioned);assert.equal(asset.status,200);assert.equal(asset.headers.get('cache-control'),'no-cache');
  }
 }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
});
