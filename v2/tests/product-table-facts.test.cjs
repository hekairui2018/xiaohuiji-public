'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {tableRows,projectTableFacts,createProductTableFacts,applyTableFacts}=require('../domain/knowledge/product-table-facts.cjs');
const {productView,createQuickService}=require('../adapters/http/quick-service.cjs');
const source={name:'产品特性V1.1.xlsx',sha256:'a'.repeat(64),locationId:12,availabilityState:'present'};
const block=(row,values)=>({id:row,locator:{sheet:'设备特性',row,cells:Object.entries(values).map(([col,value])=>({cell:col+row,value}))}});
const header=block(1,{A:'型号',C:'支持点数',D:'最宽',E:'最高',F:'宽打折触发宽度',J:'网口级联',T:'HDMI IN',Z:'有线网口',AA:'USB',AJ:'存储',AX:'视频'});
const data=block(28,{A:'A5',C:'1280*1024',D:'16384',E:'2048',F:'3840',J:'2路',T:'支持（自动缩放）',Z:'百兆',AA:'支持',AJ:'8G',AX:'支持2路1080P'});
test('Sparse spreadsheet cells bind to their actual column headers and preserve row evidence',()=>{
 const rows=tableRows([header,data],source),r=projectTableFacts(rows);assert.equal(rows[0].modelId,'HD-A5');
 assert.equal(r.features.load,'1280×1024点（1310720像素）');assert.match(r.features.resolution,/最高 2048/);assert.match(r.features.resolution,/宽打折触发宽度：3840/);assert.equal(r.features.outputs,'级联网口：2路');assert.match(r.features.interfaces,/有线网口：百兆/);assert.match(r.features.highlights,/存储：8G/);assert.equal(r.sources[0].row,28);assert.equal(r.sources[0].url,'/v2/offline/preview?id=12');
});
test('No recognized header means no invented parameter map; accessory tables and shared model cells cannot become product rows',()=>{
 assert.deepEqual(tableRows([data],source),[]);assert.deepEqual(tableRows([block(1,{A:'型号',C:'适用范围'}),data],source),[]);assert.equal(tableRows([header,block(2,{A:'A5/A5L',C:'1280*1024'})],source).length,0);
});
test('Conflicting tables do not silently choose a value; verified spec and withheld version facts remain protected',()=>{
 const a=tableRows([header,data],source),b=tableRows([header,block(2,{A:'A5',C:'1280*512',D:'16384',E:'8192'})],source);
 const facts=projectTableFacts([...a,...b]);assert.ok(facts.conflicts.includes('支持点数'));assert.equal(facts.features.load,undefined);assert.equal(facts.features.resolution,undefined);
 const own={load:'最新规格书带载',resolution:'最新规格书尺寸'};applyTableFacts(own,projectTableFacts(a),{});assert.equal(own.load,'最新规格书带载');assert.equal(own.resolution,'最新规格书尺寸');
 const blocked={load:'',resolution:''};applyTableFacts(blocked,projectTableFacts(a),{parameterStatus:'document-version-conflict'});assert.equal(blocked.load,'');assert.equal(blocked.resolution,'');
});
test('Existing parsed-table reader caches by catalog identity, keeps suffixes exact, and deduplicates identical files',async()=>{
 const resources=[source,{...source,locationId:99}],calls=[];
 const lookup=createProductTableFacts({localCatalog:async()=>resources,request:async route=>{calls.push(route);return {sha256:source.sha256,blocks:[header,data,block(29,{A:'A5L',C:'1600*800',D:'2000',E:'1000'})],nextOffset:null};}});
 const [a,b,missing]=await lookup([{modelId:'HD-A5'},{modelId:'HD-A5L'},{modelId:'HD-A51'}]);assert.match(a.features.load,/1310720/);assert.match(b.features.load,/1280000/);assert.equal(missing,null);await lookup([{modelId:'HD-A5'}]);assert.equal(calls.length,1);
});
test('Table service failure leaves document lookup usable and never exposes unrelated table fields',async()=>{
 const lookup=createProductTableFacts({localCatalog:async()=>[source],request:async()=>{throw Error('unavailable');}});assert.deepEqual(await lookup([{modelId:'HD-A5'}]),[null]);
});
test('Quick HTTP projection supplements actual missing fields, keeps file actions, and rejects connection prose as a product type',async()=>{
 const p={modelId:'HD-A5',displayName:'A5',parameters:{productSeries:'网线，A4/A5/A6与接收卡之间都是用网线连接起来',interfaces:'网线，连接电脑网口与A4/A5/A6的LAN IN接口，传输数据'},documents:[{name:'A5说明.pdf',kind:'manual',url:'/original'}]};
 const app={quickResources:()=>({}),quickSearch:()=>({records:[p]}),chipLookup:()=>null};
 const q=createQuickService(app,{productFacts:async()=>[projectTableFacts(tableRows([header,data],source))]});
 const card=(await q.search('A5')).results[0];assert.equal(card.features.series,'');assert.match(card.features.load,/1310720/);assert.doesNotMatch(JSON.stringify(card.features),/连接电脑|连接起来/);assert.equal(card.specLinks[0],'/original');assert.equal(card.features.sources[0].row,28);
 assert.equal(productView({...p,parameters:{productSeries:'使用网线连接接收卡'}}).features.series,'');
});
