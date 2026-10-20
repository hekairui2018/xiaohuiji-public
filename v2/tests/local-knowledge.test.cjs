'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createServer}=require('../adapters/http/server.cjs'),{createLocalKnowledge}=require('../adapters/http/local-knowledge.cjs');
const listen=async s=>{await new Promise(r=>s.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.address().port;};
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r);});
test('Local integration is opt-in, preserves both existing pages and ordinary quick routes',async()=>{
 const s=createServer(),base=await listen(s);
 try{for(const page of ['/wiki','/huiai']){const t=await(await fetch(base+page)).text();assert.ok(t.includes('aiInput'));assert.ok(!t.includes('/v2/local-knowledge/client.js'));}assert.equal((await fetch(base+'/v2/local-knowledge/cases')).status,404);assert.ok((await(await fetch(base+'/api/search?q=A3L')).json()).results.length);}finally{await close(s);}
});
test('Optional client bridge uses only loopback and does not expose upstream absolute paths',async()=>{
 assert.throws(()=>createLocalKnowledge({toolBase:'https://example.com'}),/loopback/);
 const fake=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url.startsWith('/search'))return res.end(JSON.stringify({elapsedMs:1,results:[{name:'A3L.pdf',resourceId:'res-unit',versionId:'ver-unit',locations:[{path:'G:\\private\\original.pdf'}],locator:{page:1,cells:['author-secret']},text:'x',versions:['V1.0'],locationId:1}]}));res.end(JSON.stringify({cases:[]}));});
 const source=await listen(fake),s=createServer(undefined,{localKnowledge:createLocalKnowledge({resourceBase:source,toolBase:source})}),base=await listen(s);
 try{const html=await(await fetch(base+'/huiai')).text();assert.match(html,/<body data-client="local"/);assert.match(html,/<script src="local-knowledge\.js\?v=[^"]+"><\/script>/);const asset=await fetch(base+'/local-knowledge.js');assert.equal(asset.status,200);assert.match(await asset.text(),/LocalKnowledgeClient/);assert.equal((await fetch(base+'/v2/local-knowledge/client.js')).status,200);const r=await(await fetch(base+'/v2/local-knowledge/search?q=A3L')).json();assert.equal(r.results[0].resourceId,'res-unit');assert.ok(!JSON.stringify(r).includes('G:'));assert.ok(!JSON.stringify(r).includes('author-secret'));assert.equal((await fetch(base+'/v2/local-knowledge/read?block=../../secrets')).status,400);assert.equal((await fetch(base+'/v2/local-knowledge/cases',{headers:{Origin:'https://example.com'}})).status,403);}finally{await close(s);await close(fake);}
});
test('Model-unavailable envelope stays local and does not route ordinary quick through a model',async()=>{
 let calls=0;const fake=http.createServer(async(req,res)=>{calls++;let body='';for await(const b of req)body+=b;const x=JSON.parse(body);assert.equal(x.modelDisabled,true);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'model-disconnected-for-local-test',answer:'模型连接已关闭',modelCalls:[]}));});
 const source=await listen(fake),s=createServer(undefined,{localKnowledge:createLocalKnowledge({toolBase:source})}),base=await listen(s);
 try{await fetch(base+'/api/search?q=A3L');assert.equal(calls,0);const r=await(await fetch(base+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json','X-V2-Local-Knowledge':'1'},body:JSON.stringify({message:'x',localSession:'test-unit-customer',modelDisabled:true})})).json();assert.equal(r.localTrace.modelCalls.length,0);assert.match(r.reply,/已关闭/);assert.equal(calls,1);}finally{await close(s);await close(fake);}
});
