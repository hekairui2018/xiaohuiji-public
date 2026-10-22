'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {directoryItems,groupSourceDirectories}=require('../domain/knowledge/source-directory.cjs');
const row=(name,id,sha,folders=['产品资料'])=>({name,locationId:id,sha256:sha,versionId:'ver-'+id,folders,sourceDrive:'G:',availabilityState:'present',searchContent:'file-metadata-only'});
const flat=tree=>tree.flatMap(n=>[...n.items,...flat(n.children)]);
test('One content identity creates one file entry and keeps all registered source paths',()=>{
 const input=directoryItems([row('A5规格书V1.0.pdf',1,'a'.repeat(64)),row('A5规格书V1.0副本.pdf',2,'a'.repeat(64),['其他备份'])]);
 const body=groupSourceDirectories(input),items=flat(body.directoryTree);assert.equal(body.total,1);assert.equal(body.sourceLocationCount,2);assert.equal(body.removedDuplicateLocations,1);assert.equal(items[0].sourceLocations.length,2);assert.equal(items[0].sourceDirectories.length,2);
});
test('Same name with different hashes or unverified versions does not collapse',()=>{
 const body=groupSourceDirectories(directoryItems([row('R712.bin',1,'a'.repeat(64)),row('R712.bin',2,'b'.repeat(64)),row('R712.bin',3,null),row('R712.bin',4,null)]));assert.equal(body.total,4);
});
test('Older specifications and manuals remain in their original directories',()=>{
 const body=groupSourceDirectories(directoryItems([row('A5规格书V1.0.pdf',1,'a'.repeat(64)),row('A5规格书V2.0.pdf',2,'b'.repeat(64))]));const items=flat(body.directoryTree);assert.equal(items.length,2);assert.equal(items[0].folders[0],'产品资料');assert(items.some(r=>r.versionSelection==='historical'));
});
test('A restricted copy cannot be laundered through another directory before deduplication',()=>{
 const items=directoryItems([row('普通.pdf',1,'a'.repeat(64)),row('内部副本.pdf',2,'a'.repeat(64),['私密'])]);assert(items.every(r=>r.accessRestricted));
});
test('Registered binary identity has metadata-only semantics and no fabricated full-text content',()=>{
 const body=groupSourceDirectories(directoryItems([row('固件.img',1,null,['固件'])]));const item=flat(body.directoryTree)[0];assert.equal(item.searchContent,'file-metadata-only');assert.equal(item.downloadUrl,'/v2/offline/file?id=1&download=1');assert.equal(item.text,undefined);
});

test('Public callers cannot obtain directory data by invoking the other-documents endpoint',async()=>{
 const {createServer}=require('../adapters/http/server.cjs');let calls=0;
 const app={quickResources:()=>({}),quickSearch:()=>({records:[]}),quickBrowse:()=>[]};
 const server=createServer(app,{offlineKnowledge:{handle:async()=>false,directoryCatalog:async()=>{calls++;return {cat:'other',docs:groupSourceDirectories([])};}},publicCatalog:{transform:b=>b},accessGuard:req=>{if(req.headers['x-test-public']==='1')req.v2Public=true;return true;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{const denied=await fetch(base+'/api/docs?cat=other',{headers:{'x-test-public':'1'}});assert.equal(denied.status,403);assert.equal(calls,0);const local=await fetch(base+'/api/docs?cat=other');assert.equal(local.status,200);assert.equal(calls,1);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('Only G-drive sources enter the directory; development and unknown roots never appear',()=>{
 const g=row('资料.pdf',1,'a'.repeat(64)),e={...row('测试.pdf',2,'b'.repeat(64)),sourceDrive:'E:',folders:['开发项目','xiaohuiji','tmp']},unknown={...row('不明.pdf',3,null),sourceDrive:null};
 const items=directoryItems([g,e,unknown]);assert.deepEqual(items.map(r=>r.locationId),[1]);assert.deepEqual(groupSourceDirectories(items).directoryTree.map(n=>n.label),['G:']);
});

test('Prepared directory caching preserves per-request permissions and blocks restricted hash aliases',async()=>{
 const http=require('node:http'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');let calls=0;
 const resources=[row('正常.pdf',1,'a'.repeat(64)),row('仅内部.pdf',2,'b'.repeat(64),['私密']),row('同内容普通.pdf',3,'b'.repeat(64))];
 const index=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/directory-catalog'){calls++;res.end(JSON.stringify({directoryCatalogVersion:1,resources}));}else res.end(JSON.stringify({resources:[]}));});await new Promise(r=>index.listen(0,'127.0.0.1',r));
 try{const api=createOfflineKnowledge({resourceBase:'http://127.0.0.1:'+index.address().port,authorizeRestrictedResource:req=>req.staff===true});
 const staff=await api.directoryCatalog({staff:true});assert.equal(staff.docs.total,2);const privateDirectory=staff.docs.directoryPage.entries.find(e=>e.label==='私密');assert(privateDirectory);
 const guest=await api.directoryCatalog({staff:false});assert.equal(guest.docs.total,1);assert.equal(guest.docs.sourceLocationCount,1);assert.equal(calls,1);assert(!JSON.stringify(guest).includes('仅内部'));assert(!JSON.stringify(guest).includes('私密'));await assert.rejects(()=>api.directoryCatalog({staff:false},{directory:privateDirectory.id}),/directory-not-found/);
 const again=await api.directoryCatalog({staff:true});assert.equal(again.docs.total,2);assert.equal(calls,1);
 await assert.rejects(()=>api.directoryCatalog({v2Public:true}),/public-route-not-enabled/);
 }finally{index.closeAllConnections();await new Promise(r=>index.close(r));}
});

test('Expired metadata cache reuses the prepared index when unchanged and refreshes it when registrations change',async()=>{
 const http=require('node:http'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs'),module=require('../domain/knowledge/source-directory.cjs');
 const originalPrepare=module.directoryItems,originalNow=Date.now;let clock=originalNow(),reads=0,prepares=0;const resources=[row('原名.pdf',1,null)];
 const index=http.createServer((req,res)=>{reads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({directoryCatalogVersion:1,resources}));});await new Promise(r=>index.listen(0,'127.0.0.1',r));
 try{Date.now=()=>clock;module.directoryItems=(...args)=>{prepares++;return originalPrepare(...args);};const api=createOfflineKnowledge({resourceBase:'http://127.0.0.1:'+index.address().port});
 await api.directoryCatalog({});assert.equal(prepares,1);clock+=31000;await api.directoryCatalog({});assert.equal(reads,2);assert.equal(prepares,1);
 resources[0].name='改名.pdf';clock+=31000;const refreshed=await api.directoryCatalog({});assert.equal(prepares,2);const folder=refreshed.docs.directoryPage.entries[0];const child=await api.directoryCatalog({},{directory:folder.id});assert.equal(child.docs.directoryPage.entries[0].name,'改名.pdf');
 }finally{module.directoryItems=originalPrepare;Date.now=originalNow;index.closeAllConnections();await new Promise(r=>index.close(r));}
});
