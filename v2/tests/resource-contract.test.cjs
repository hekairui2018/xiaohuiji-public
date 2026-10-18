'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {identifyDocument}=require('../domain/knowledge/document-catalog.cjs');
const {augmentProducts}=require('../domain/knowledge/local-resource-catalog.cjs');
const {createQuickService}=require('../adapters/http/quick-service.cjs');
const {createServer}=require('../adapters/http/server.cjs');
const {softwarePackages}=require('../domain/knowledge/software-packages.cjs');
const appFor=products=>({quickResources:()=>({}),quickSearch:()=>({records:[]}),quickBrowse:()=>products});
test('Source LCD folders classify individual documents, not every document belonging to the model',async()=>{
 const p={modelId:'HD-X9',displayName:'HD-X9',documents:[],firmware:[]},resources=[{name:'X9使用说明.pdf',folders:['产品资料','LCD产品资料'],sha256:'a'.repeat(64)},{name:'X9调试手册.pdf',folders:['产品资料','LED'],sha256:'b'.repeat(64)}];
 const quick=createQuickService(appFor([p]),{localCatalog:async()=>resources});const docs=(await quick.docs('manual')).docs;
 assert.equal(docs.total,2);assert.equal(docs.groups.find(g=>g.key==='lcd').fileCount,1);assert.equal(docs.groups.filter(g=>g.key!=='lcd').reduce((n,g)=>n+g.fileCount,0),1);
 const meta=identifyDocument({name:'使用指南.pdf',folders:['产品资料','产品规格书（LCD）']});assert.equal(meta.kind,'spec');assert.equal(meta.category,'lcd');
 // Directory ownership now wins over a name hint; a real content conflict is held for review.
 assert.equal(identifyDocument({name:'X9规格书.pdf',folders:['认证证书']}).kind,'other');
 assert.equal(identifyDocument({name:'X9规格书.pdf',folders:['认证证书'],documentMetadata:{kind:'spec'}}).kind,'pending');
 assert.equal(identifyDocument({name:'电池规格书.pdf',folders:['品质资料（合格证、质量报告、电池型号）','电池型号']}).kind,'spec');
 assert.equal(identifyDocument({name:'接线参考.pdf',folders:['培训资料']}).kind,'other');
 assert.deepEqual(identifyDocument({name:'17LR169 Certificate.pdf',folders:['认证证书']}).modelIds,[]);
});
test('An unversioned existing manual retains its role and remains visible beside a versioned document',async()=>{
 const p={modelId:'HD-X9',displayName:'X9',documents:[{name:'X9资料.pdf',kind:'manual',sha256:'a'.repeat(64)}]},resource={name:'X9资料.pdf',sha256:'a'.repeat(64),documentMetadata:{coverModels:['X9'],version:null,kind:null}};
 const rows=augmentProducts([p],[resource]);assert.equal(rows[0].documents[0].kind,'manual');
 const quick=createQuickService(appFor(rows));const docs=(await quick.docs('manual')).docs;assert.equal(docs.items.length,1);assert.equal(docs.items[0].versionStatus,'unknown');assert.equal(docs.items[0].documentVersion,null);
});
test('History is explicit, unknown and conflicting versions remain in current, signed data never reaches website history',async()=>{
 const products=[{modelId:'HD-X9',displayName:'X9',documents:[{name:'X9说明V1.0.pdf',kind:'manual'},{name:'X9说明V2.0.pdf',kind:'manual'},{name:'X9说明.pdf',kind:'manual'},{name:'X9签章说明V1.0.pdf',kind:'manual'},{name:'X9说明V3.0.pdf',kind:'manual',documentMetadata:{version:'V2.0'}}]}];
 const quick=createQuickService(appFor(products));const current=(await quick.docs('manual')).docs;assert.ok(current.items.some(i=>i.versionStatus==='unknown'));assert.ok(current.items.some(i=>i.versionStatus==='conflict'));
 const history=(await quick.docs('history',{websiteOnly:true})).docs;assert.deepEqual(history.items.map(i=>i.name),['X9说明V1.0.pdf']);assert.equal(history.items[0].versionStatus,'historical');
});
test('Optional pagination bounds groups and items without changing global totals or original identities',async()=>{
 const products=['X1','X2'].map((model,i)=>({modelId:'HD-'+model,displayName:model,documents:[{name:model+'说明.pdf',kind:'manual',sha256:String(i+1).repeat(64)}]})),quick=createQuickService(appFor(products));
 const page=(await quick.docs('manual',{offset:1,limit:1})).docs;assert.equal(page.total,2);assert.equal(page.pagination.total,2);assert.equal(page.items.length,1);assert.equal(page.groups.flatMap(g=>g.products).flatMap(p=>p.items).length,1);assert.equal(page.items[0].fileId,'sha256:'+'2'.repeat(64));assert.equal(page.pagination.nextOffset,null);
});
test('New indexed installer candidates enter a separate software list, duplicates collapse and old folders remain historical',()=>{
 const input=[{name:'Example.exe',resourceType:'software',sha256:'a'.repeat(64),locationId:1,folders:['软件安装包'],resourceId:'r',versionId:'v'},{name:'renamed.exe',resourceType:'software',sha256:'a'.repeat(64),locationId:2,folders:['软件安装包']},{name:'Old.apk',resourceType:'software',sha256:'b'.repeat(64),locationId:3,folders:['安装包','旧版本安装包']},{name:'helper.exe',resourceType:'software',sha256:'c'.repeat(64),locationId:4,folders:['其他']}];
 const result=softwarePackages(input);assert.equal(result.packages.length,1);assert.equal(result.historicalPackages.length,1);assert.equal(result.packages[0].resourceVersionId,'v');assert.equal(result.packages[0].documentVersion,null);assert.equal(result.packages[0].reviewRequired,true);assert.equal(result.historicalPackages[0].versionStatus,'historical-source-folder');
});
test('Unversioned local firmware stays in firmware with review metadata, not classification pending',async()=>{
 const quick=createQuickService(appFor([{modelId:'HD-X9',displayName:'X9',documents:[],firmware:[]}]),{localCatalog:async()=>[{name:'X9_FPGA.bin',resourceType:'firmware',locationId:5,resourceId:'r',versionId:'v',folders:['固件']}]});
 const pending=(await quick.docs('pending')).docs;assert.equal(pending.items.length,0);
 const firmware=(await quick.docs('firmware')).docs;assert.equal(firmware.items.length,1);assert.equal(firmware.items[0].kind,'firmware');assert.equal(firmware.items[0].versionStatus,'unknown');assert.equal(firmware.items[0].reviewRequired,true);assert.equal(firmware.firmwareCategories[0].key,'other');
});
test('Same-name binary evidence with different hashes is resolved independently, unavailable links retain a reason',async()=>{
 const http=require('node:http'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs'),seen=[];
 const upstream=http.createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const items=JSON.parse(text).items;seen.push(...items);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({results:items.map((i,n)=>i.sha256?{available:true,locationId:n+1,resourceId:'r'+n,versionId:'v'+n,sha256:i.sha256,sizeBytes:1}:{available:false,reason:'same-name-content-conflict'})}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));try{const k=createOfflineKnowledge({resourceBase:'http://127.0.0.1:'+upstream.address().port}),items=[{name:'X9.bin',url:'/old1',sha256:'a'.repeat(64)},{name:'X9.bin',url:'/old2',sha256:'b'.repeat(64)},{name:'unconfirmed.bin',url:'/old3'}],body=await k.localizeMedia({items});assert.equal(seen.length,3);assert.notEqual(body.items[0].url,body.items[1].url);assert.equal(body.items[2].url,null);assert.equal(body.items[2].unavailableReason,'same-name-content-conflict');assert.equal(body.items[2].available,false);}
 finally{upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});
test('HTTP exposes additive categories/history/pagination and rejects invalid pagination',async()=>{
 const server=createServer(appFor([]));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const cat of ['other','pending','history']){const r=await fetch(base+'/api/docs?cat='+cat+'&limit=1');assert.equal(r.status,200);assert.ok((await r.json()).docs.items.length<=1);}for(const suffix of ['limit=0','limit=201','offset=1','limit=1&offset=-1','history=bad'])assert.equal((await fetch(base+'/api/docs?cat=manual&'+suffix)).status,400);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('New local-only history and review categories do not widen public catalogue access',async()=>{
 const server=createServer(appFor([]),{accessGuard:req=>{req.v2Public=true;return true;},publicCatalog:{transform:x=>x}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const suffix of ['cat=history','cat=other','cat=pending','cat=spec&history=all','cat=firmware&history=only'])assert.equal((await fetch(base+'/api/docs?'+suffix)).status,403);assert.equal((await fetch(base+'/api/docs?cat=spec&limit=1')).status,200);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
