'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {catalogList}=require('../adapters/http/catalog-list.cjs');
const {createCatalogResponseCache}=require('../adapters/http/catalog-response-cache.cjs');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const response=()=>({writeHead(code,headers){this.headers=headers;},end(body){this.body=body;}});
test('light list preserves identities, ordering, version rules and links without repeating file payloads',()=>{
 const item={name:'X1 完整名称 V2.pdf',url:'/v2/offline/file?id=1',downloadUrl:'/v2/offline/file?id=1&download=1',documentVersion:'V2',versionBasis:'original',scopeEvidence:['HW1'],classificationEvidence:['large evidence'],available:true};
 const source={docs:{total:1,items:[item],flatGroups:[{}],groups:[{key:'receiver',label:'接收卡',products:[{model:'X1',items:[item]}]}]}};
 const compact=catalogList(source);assert.equal(compact.docs.items,undefined);assert.equal(compact.docs.flatGroups,undefined);
 const row=compact.docs.groups[0].products[0].items[0];for(const key of ['name','url','downloadUrl','documentVersion','versionBasis','scopeEvidence','available'])assert.deepEqual(row[key],item[key]);
 assert.equal(source.docs.items.length,1);assert.equal(row.classificationEvidence,undefined);
});
test('expired warm response returns last result during one refresh, updates on success, and has a hard stale bound',async()=>{
 let now=0,done,calls=0;const cache=createCatalogResponseCache({ttl:10,staleMs:20,now:()=>now});
 await cache.prepare('x',async()=>({value:1}));now=11;
 const refresh=()=>{calls++;return new Promise(r=>done=r);};
 const a=response(),b=response();await cache({headers:{}},a,'x',refresh);await cache({headers:{}},b,'x',refresh);assert.equal(calls,1);assert.equal(JSON.parse(a.body).value,1);assert.equal(JSON.parse(b.body).value,1);
 done({value:2});await new Promise(r=>setTimeout(r,10));const c=response();await cache({headers:{}},c,'x',refresh);assert.equal(JSON.parse(c.body).value,2);
 now=100;const pending=cache.prepare('x',async()=>({value:3}));await pending;const d=response();await cache({headers:{}},d,'x',refresh);assert.equal(JSON.parse(d.body).value,3);
});
test('simultaneous catalogue loads share one index request; unchanged refresh keeps association source identity',async()=>{
 const originalNow=Date.now;let clock=100,calls=0,version=1;Date.now=()=>clock;
 const server=http.createServer((_req,res)=>{calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({resources:[{name:'X1.pdf',versionId:version}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const api=createOfflineKnowledge({knowledge:{products:()=>[],cases:()=>[],evidenceDocuments:()=>[]},resourceBase:'http://127.0.0.1:'+server.address().port});
 const [a,b]=await Promise.all([api.localCatalog(),api.localCatalog()]);assert.equal(calls,1);assert.equal(a,b);
 clock+=31000;assert.equal(await api.localCatalog(),a);assert.equal(calls,2);
 clock+=31000;version=2;assert.notEqual(await api.localCatalog(),a);assert.equal(calls,3);
 }finally{Date.now=originalNow;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
