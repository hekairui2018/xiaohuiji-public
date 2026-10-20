'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPipeline}=require('../app/request-pipeline.cjs');
const {productView,createQuickService}=require('../adapters/http/quick-service.cjs');
const {projectTableFacts,applyTableFacts}=require('../domain/knowledge/product-table-facts.cjs');
const {productCardFeatures}=require('../domain/knowledge/product-card-features.cjs');
function fixture(){
 const normalize=s=>String(s).toUpperCase().replace(/^HD-/,''),source={sha256:'a'.repeat(64),symbol:'Fy',index:2};
 const official=[{model:'A5',category:'同步异步播放盒',totalPoints:1310720,maxWidth:16384,maxHeight:2048,cascadePort:2,HDMIIn:true,hdmiOut:true,memory:'8G',source},{model:'A5L',totalPoints:999999,source:{...source,index:3}}];
 const products=['A5','A5L','A4'].map(model=>({modelId:'HD-'+model,displayName:'HD-'+model,aliases:[model],parameters:model==='A5L'?{productSeries:'A5L原类型',load:'A5L原带载'}:{},claims:[],documents:[{name:model+'说明书.pdf',kind:'manual',url:'/original/'+model}]}));
 const clone=x=>structuredClone(x);
 const dataset={version:'synthetic-structured-v1',findProducts:id=>clone(official.filter(p=>p.model===normalize(id))),devices:()=>clone(official),modules:()=>[],receivers:()=>[]};
 const knowledge={version:'synthetic-knowledge',findProducts:id=>clone(products.filter(p=>p.modelId==='HD-'+normalize(id))),products:()=>clone(products),search:text=>clone(products.filter(p=>p.aliases.includes(text))),assets:()=>({}),evidenceDocuments:()=>[],cases:()=>[]};
 const pipeline=createPipeline({dataset,knowledge,router:()=>{throw Error('Quick lookup must not run dialogue');}});
 return {dataset,knowledge,pipeline,products};
}
test('Product search/browse do not promote selection-tool records into card facts',()=>{
 const {pipeline,knowledge}=fixture();
 for(const p of [pipeline.quickSearch('A5').records[0],pipeline.quickBrowse().find(p=>p.modelId==='HD-A5')]){
  const card=productView(p);assert.equal(card.features.load,'');assert.equal(card.features.resolution,'');assert.equal(card.features.outputs,'');assert.equal(card.features.evidence.structuredProduct,undefined);assert.equal(p.selectionRecords,undefined);assert.equal(p.structuredDatasetVersion,undefined);assert.equal(card.specLinks[0],'/original/A5');
 }
 const direct=pipeline.quickLookup({modelId:'A5'}).records[0];assert.equal(direct.selectionRecords,undefined);assert.equal(direct.hdmiOut,undefined);assert.equal(direct.totalPoints,undefined);
 assert.deepEqual(knowledge.findProducts('A5')[0].parameters,{});
});
test('Legacy selection metadata cannot inject card values; real document values still win',()=>{
 const {dataset,products}=fixture(),selectionRecords=dataset.devices(),p={...products[0],selectionRecords,structuredDatasetVersion:dataset.version};
 const empty=productCardFeatures(p);assert.equal(empty.load,'');assert.equal(empty.inputs,'');assert.equal(empty.evidence.structuredProduct,undefined);
 const actual=productCardFeatures({...p,parameters:{load:'最大带载：100万像素',resolution:'3840 / 1080'}});assert.equal(actual.load,'100万像素');assert.match(actual.resolution,/3840/);
});
test('Product table is the actual source when document values are missing; no algorithm-source conflict is generated',()=>{
 const {pipeline}=fixture(),p=pipeline.quickSearch('A5').records[0],f=productView(p).features;
 const facts=projectTableFacts([{fields:{'型号':'A5','支持点数':'1280*1024','最宽':'16384','最高':'2048','网口级联':'2路','存储':'8G','运行内存':'2G','视频':'支持2路1080P','转码要求':'大于1080P必须转码','宽打折触发宽度':'3840','HDMI IN':'支持（自动缩放）','HDMI 输出':'不支持'},source:{name:'合成产品表.xlsx',row:28}}]);
 applyTableFacts(f,facts,p);assert.match(f.load,/1310720像素/);assert.equal(f.outputs,'级联网口：2路');assert.match(f.resolution,/最高 2048/);assert.match(f.resolution,/3840/);assert.match(f.highlights,/运行内存：2G/);assert.match(f.inputs,/自动缩放/);assert.equal(f.notice,undefined);assert.equal(f.sources[0].row,28);assert.equal(f.evidence.structuredProduct,undefined);
});
test('Missing actual documents/tables leaves parameters unknown; suffix identity and ordering dataset remain unchanged',async()=>{
 const {pipeline,dataset,products}=fixture(),prior=dataset.devices(),quick=createQuickService({...pipeline,chipLookup:()=>null},{localCatalog:async()=>[]});
 const card=(await quick.search('A5')).results[0];assert.equal(card.features.load,'');assert.equal(card.features.sources,undefined);
 for(const name of ['A5L','A4']){const p=pipeline.quickSearch(name).records[0];assert.equal(p.selectionRecords,undefined);assert.deepEqual(p.parameters,products.find(x=>x.modelId==='HD-'+name).parameters);}
 assert.deepEqual(dataset.devices(),prior);
});
test('Actual document version conflicts still block table load/dimensions without affecting other real table facts',()=>{
 const facts=projectTableFacts([{fields:{'型号':'A5','支持点数':'1280*1024','最宽':'16384','最高':'2048','网口级联':'2路'},source:{name:'合成表.xlsx',row:28}}]);
 const f={load:'',resolution:''};applyTableFacts(f,facts,{modelId:'HD-A5',parameterStatus:'document-version-conflict'});assert.equal(f.load,'');assert.equal(f.resolution,'');assert.equal(f.outputs,'级联网口：2路');
});
