'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createSectionSearch}=require('../adapters/http/section-search.cjs');
test('section bridge passes only the explicit query with its private capability',async()=>{
 const observed=[];const upstream=http.createServer((req,res)=>{observed.push({url:req.url,token:req.headers['x-internal-token'],purpose:req.headers['x-internal-purpose']});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({results:[],retrievalBackend:'sections-sql-bm25-vector'}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 try{const bridge=createSectionSearch({resourceBase:'http://127.0.0.1:'+upstream.address().port,internalToken:'test-capability'});const result=await bridge.search('X100 电源');assert.equal(result.retrievalBackend,'sections-sql-bm25-vector');assert.equal(new URL(observed[0].url,'http://localhost').searchParams.get('q'),'X100 电源');assert.equal(observed[0].purpose,'fulltext');assert.equal(observed[0].token,'test-capability');
 let status;await bridge.serve({}, {writeHead(n){status=n;},end(){}},'../../private');assert.equal(status,404);assert.equal(observed.length,1);
 }finally{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});
