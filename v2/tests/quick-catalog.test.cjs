'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createApp}=require('../app/bootstrap.cjs'),{createQuickService}=require('../adapters/http/quick-service.cjs');
const {createMediaCatalog}=require('../domain/knowledge/media-catalog.cjs');
const {createServer}=require('../adapters/http/server.cjs'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
test('Display names follow V1 clean labels while retaining originals, exact suffixes and versions',()=>{
 const {documentLabel,productView}=require('../adapters/http/quick-service.cjs');
 assert.equal(documentLabel('MS4000Pro规格书_V1.0.pdf'),'HD-MS4000Pro规格书 V1.0');
 assert.equal(documentLabel('HD_A3L 规格书_V1.10.docx'),'HD-A3L 规格书 V1.10');
 assert.equal(documentLabel('HD-VP620A-TP规格书 v1.3.pdf'),'HD-VP620A-TP规格书 v1.3');
 assert.equal(documentLabel('HDSet_V4.0说明书.pdf'),'HDSet V4.0说明书');
 const view=productView({model:'HD-Z9',documents:[{name:'Z9规格书_V1.0.pdf',kind:'spec',url:'/real-original'}]});
 assert.equal(view.docGroups[0].items[0].name,'Z9规格书_V1.0.pdf');assert.equal(view.docGroups[0].items[0].clean,'HD-Z9规格书 V1.0');assert.equal(view.docGroups[0].items[0].url,'/real-original');
});
const listen=async s=>{await new Promise(r=>s.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.address().port;};
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r);});
test('Real product document groups preserve every file and expose V1-compatible category totals',async()=>{
 const app=createApp({knowledge:require('../adapters/data/load-knowledge.cjs').loadKnowledge('v2/data/knowledge-next',{manifestFile:'candidate-manifest.json'})}),quick=createQuickService(app);
 for(const cat of ['spec','manual']){const result=(await quick.docs(cat,{includeHistory:true})).docs;assert.ok(result.groups.length>2);assert.ok(result.groups.some(g=>g.key==='player'));assert.ok(result.groups.some(g=>g.key==='processor'));
  assert.equal(result.total,result.groups.reduce((n,g)=>n+g.fileCount,0));assert.equal(result.modelCount,result.groups.reduce((n,g)=>n+g.count,0));
  for(const g of result.groups){assert.ok(g.label);assert.equal(g.count,g.products.length);assert.equal(g.fileCount,g.products.reduce((n,p)=>n+p.items.length,0));}
  const models=key=>result.groups.find(g=>g.key===key)?.products.map(p=>p.model.replace(/^HD-/,''))||[];if(cat==='spec'){assert.ok(models('receiver').includes('R712'));assert.ok(models('player').includes('A3L'));assert.ok(models('processor').includes('VP620'));assert.equal(result.total,521);}
  assert.equal(result.total,app.quickBrowse().flatMap(p=>p.documents||[]).filter(d=>d.kind===cat).length);
 }
});
test('All software remains visible with stable groups, including unknown entries',()=>{
 const assets={softwareCatalog:['HDSet','HDPlayer','HDShow','HD2020','HD2018','HDSign','PingZhangKong','XiaoHuiYun','LCDPlayer','NewSoftware'].map(id=>({id,name:id,aliases:[]})),software:[],manuals:[],videos:[]};
 const media=createMediaCatalog(assets),rows=media.softwareItems('');assert.equal(rows.length,10);assert.equal(rows.filter(s=>s.group==='led').length,6);assert.equal(rows.filter(s=>s.group==='mobile').length,2);assert.equal(rows.filter(s=>s.group==='lcd').length,1);assert.equal(rows.at(-1).group,'other');assert.ok(rows.every(s=>s.groupLabel));assert.equal(media.softwareItems('HDSet')[0].group,'led');
});
test('HTTP docs resolve originals in a batch and expose unavailable reasons without fabricating links',async()=>{
 const products=[{modelId:'HD-R712',displayName:'R712',parameters:{productSeries:'接收卡'},documents:[{name:'R712 V1.pdf',kind:'spec',url:null},{name:'R712 V2.docx',kind:'spec',url:'/official-files/old-link.docx'}]}];
 const app={...createApp(),quickSearch:()=>({records:[]}),quickBrowse:()=>products};
 let requests=0;const upstream=http.createServer(async(req,res)=>{if(req.url==='/catalog'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({resources:[]}));}requests++;assert.equal(req.url,'/resolve-documents');let b='';for await(const c of req)b+=c;assert.deepEqual(JSON.parse(b).items.map(x=>x.name),['R712 V1.pdf','R712 V2.docx']);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({results:[{available:true,locationId:21,sha256:'a'.repeat(64)},{available:false,reason:'same-name-content-conflict'}]}));});
 const resourceBase=await listen(upstream),server=createServer(app,{offlineKnowledge:createOfflineKnowledge({resourceBase})}),base=await listen(server);
 try{const data=await fetch(base+'/api/docs?cat=spec').then(r=>r.json()),items=data.docs.groups[0].products[0].items;assert.equal(items[0].url,'/v2/offline/preview?id=21');assert.equal(items[0].available,true);assert.equal(items[1].url,null);assert.equal(items[1].unavailableReason,'same-name-content-conflict');assert.equal(requests,1);
  assert.equal((await fetch(base+'/api/docs?cat=invalid')).status,400);
 }finally{await close(server);await close(upstream);}
});
test('Resolver outage preserves the full catalogue and marks files unavailable',async()=>{
 const resolver=createOfflineKnowledge({resourceBase:'http://127.0.0.1:1'}).resolveDocuments;
 const rows=await resolver([{name:'A3L V1.pdf'}]);assert.deepEqual(rows,[{url:null,available:false,unavailableReason:'resource-service-unavailable'}]);
});

test('A missing numeric ID never makes all named accessories match each other',async()=>{
 const products=[{modelId:null,displayName:'USB无线设备',documents:[]},{modelId:null,displayName:'红外附件',documents:[]}];
 const app={...createApp(),quickSearch:()=>({records:[products[0]]}),quickBrowse:()=>products,chipLookup:()=>null};
 const quick=createQuickService(app,{localCatalog:async()=>[]});
 assert.deepEqual((await quick.search('USB无线设备')).results.map(x=>x.name),['USB无线设备']);
});

test('Signed-only originals are hidden from both browse and product search with consistent counts',async()=>{
 const products=[{displayName:'Z9',modelId:'HD-Z9',documents:[{name:'Z9规格.pdf',kind:'spec'},{name:'Z9说明.pdf',kind:'manual'}]}];
 const app={...createApp(),quickSearch:()=>({records:products}),quickBrowse:()=>products,chipLookup:()=>null};
 const quick=createQuickService(app,{resolveDocuments:async docs=>docs.map(()=>({url:null,available:false,unavailableReason:'signed-edition-hidden'}))});
 const browse=(await quick.docs('spec')).docs;assert.equal(browse.total,0);assert.equal(browse.modelCount,0);assert.equal(browse.hiddenSignedCount,1);assert.deepEqual(browse.groups,[]);
 const result=(await quick.search('Z9')).results[0];assert.deepEqual(result.specLinks,[]);assert.deepEqual(result.specGroups,[]);assert.deepEqual(result.docGroups,[]);
});
test('Product search resolves documents in the same grouped order and never advertises stale links',async()=>{
 const products=[{displayName:'Z9',modelId:'HD-Z9',documents:[{name:'Z9操作.pdf',kind:'manual',url:'/old-manual'},{name:'Z9规格.pdf',kind:'spec',url:'/old-spec'}]}];
 const app={...createApp(),quickSearch:()=>({records:products}),chipLookup:()=>null};
 const quick=createQuickService(app,{resolveDocuments:async docs=>{assert.deepEqual(docs.map(d=>d.name),['Z9规格.pdf','Z9操作.pdf']);return [{url:'/v2/offline/file?id=1',available:true},{url:null,available:false,unavailableReason:'original-not-registered'}];}});
 const result=(await quick.search('Z9')).results[0];assert.deepEqual(result.specLinks,['/v2/offline/file?id=1',null]);assert.equal(result.docGroups[1].items[0].available,false);assert.ok(result.docGroups[1].items[0].unavailableMessage);
});
