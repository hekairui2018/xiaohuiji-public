'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const pairs=require('./intent-action-pairs.cjs'),{createApp}=require('../app/bootstrap.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs'),{createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge}),lookup={products:knowledge.products,findProducts:knowledge.findProducts,softwareItems:s=>app.resourceMedia.softwareItems(s),isSoftware:s=>!!app.resourceMedia.softwareItems(s).length,chipLookup:app.chipLookup};
function context(type){return {id:'contrast-test',retrievalHistory:[{quickContext:{models:type==='product'?['HD-R712']:[],software:type==='software'?['HDPlayer']:[],chips:[],query:type==='product'?'R712':type==='software'?'HDPlayer':'我要配个P3屏',ordering:type==='ordering'?{confirmed:{schemaVersion:'2.0',operation:'ordering',module:{pitchMm:3},provenance:{}},pending:[],candidates:[],simulations:[]}:null}}]};}
for(const pair of pairs)test('Action contrast '+pair.id+': '+pair.left.text+' / '+pair.right.text,()=>{
 for(const sample of [pair.left,pair.right]){const r=parseQuickQuery(sample.text,lookup,context(pair.context));assert.equal(r.intent,sample.intent);assert.equal(r.decision.intent,r.intent);assert.equal(r.decision.original,sample.text);assert(r.decision.reasons.length);assert(r.decision.reasons.every(e=>e.start>=0&&sample.text.includes(e.text)));}
});
test('Routing remains stable across empty, populated and unavailable retrieval, with separate answer states',async()=>{
 for(const text of ['HDMI说明书','模组尺寸是多少','R712灰阶多少','HDPlayer支持什么功能','R712可以刷这个吗']){
  const expected=parseQuickQuery(text,lookup).intent;
  for(const search of [async()=>({results:[]}),async()=>({results:[{name:'无关.pdf',text:'无关正文'}]}),async()=>{throw Error('isolated outage');}]){
   const r=await createQuickRetrieval({knowledge,app,search,searchCases:async()=>{throw Error('wrong source: no fault request');}}).answer(text);
   assert.equal(r.intent,expected);assert.equal(r.queryPlan.decision.intent,expected);assert.equal(r.modelCallCount,0);
  }
 }
});
test('Topic document requests search and resolve registered originals without requiring a hardware identity',async()=>{
 let catalog=0,resolver=0,fts=0,cases=0;
 const api=createQuickRetrieval({knowledge,app,localCatalog:async()=>{catalog++;return [{name:'HDMI说明书.pdf',sha256:'a'.repeat(64)}];},resolveDocuments:async rows=>{resolver++;return rows.map(()=>({available:true,url:'/original-hdmi',downloadUrl:'/download-hdmi'}));},search:async()=>{fts++;return {results:[]};},searchCases:async()=>{cases++;return {results:[]};}});
 const r=await api.answer('HDMI说明书');assert.equal(r.intent,'resources');assert(catalog&&resolver);assert.equal(cases,0);assert(r.results.some(r=>r.download==='/original-hdmi'));assert.doesNotMatch(r.reply,/请提供准确产品型号/);
});
test('Software function questions consume registered purpose rather than asking for hardware model',async()=>{
 const r=await createQuickRetrieval({knowledge,app,search:async()=>({results:[]}),searchCases:async()=>{throw Error('unexpected case lookup');}}).answer('HDPlayer支持什么功能');
 assert.equal(r.intent,'software-function');assert.equal(r.answerType,'software-function-answer');assert.match(r.reply,/节目/);assert.doesNotMatch(r.reply,/哪个产品|硬件型号/);assert(r.retrievalTrace.some(x=>x.name==='software-catalog'));
});
test('Firmware deictic questions preserve compatibility action and request the actual missing file',async()=>{
 const r=await createQuickRetrieval({knowledge,app,search:async()=>({results:[]}),searchCases:async()=>{throw Error('unexpected case lookup');}}).answer('R712可以刷这个吗');
 assert.equal(r.intent,'compatibility');assert.match(r.reply,/哪个固件文件/);assert.match(r.reply,/硬件|芯片/);assert.doesNotMatch(r.reply,/可以直接刷|已经兼容/);assert(r.queryPlan.decision.missing.includes('referenced-file'));
});
test('Data source parameters do not turn a bare technical object into an engineering request',()=>{
 for(const q of ['模组尺寸是多少','不是配单，只问模组尺寸是多少'])assert.equal(app.understandInput(q).demand.operation,'consultation');
 assert.equal(app.understandInput('按这个模组尺寸帮我配卡').demand.operation,'ordering');
 assert.equal(app.understandInput('R712灰阶多少').demand.operation,'consultation');assert.equal(app.understandInput('R712灰阶异常').demand.operation,'aftersales');
});
test('An explicit model correction inherits the previous action and excludes the denied identity',()=>{
 const state={retrievalHistory:[{quickContext:{models:['HD-R712'],software:[],chips:[],query:'R712灰阶多少',intent:'parameters'}}]};
 const q=parseQuickQuery('不是R712，是R716',lookup,state);assert.equal(q.intent,'parameters');assert.deepEqual(q.models,['HD-R716']);assert.equal(q.decision.original,'不是R712，是R716');assert(q.decision.reasons.every(r=>r.text==='不是R712，是R716'));
});
test('Document title properties do not become compatibility questions without a suitability question',()=>{
 assert.equal(parseQuickQuery('给我通用说明书',lookup).intent,'resources');
 assert.equal(parseQuickQuery('这个固件行不行',lookup).intent,'compatibility');
});
test('Software evidence cannot be borrowed from another application merely sharing the word function',async()=>{
 const api=createQuickRetrieval({knowledge,app,search:async()=>({results:[{name:'屏掌控APP功能介绍.pptx',text:'支持多种功能；分享软件；二维码分享软件。'}]}),searchCases:async()=>({results:[]})});
 const r=await api.answer('HDPlayer支持什么功能');assert.match(r.reply,/编辑图文/);assert.doesNotMatch(r.reply,/二维码分享软件/);assert(r.routeLog.filtered['different-software-source']>0);
});
test('The shared business classifier and quick entry agree on the six concrete requests',()=>{
 const business=require('../adapters/http/quick-answer.cjs').createQuickAnswer({app,knowledge,search:async()=>({results:[]}),searchCases:async()=>({results:[]})});
 for(const text of ['R712灰阶多少','找不到R712说明书','HDPlayer支持什么功能','HDMI说明书','模组尺寸是多少','R712可以刷这个吗'])assert.equal(business.classify(text).intent,parseQuickQuery(text,lookup).intent);
});
test('Grayscale answers consume the accessible original and do not quote a hidden signed edition',async()=>{
 const originalDocuments=[{document:{name:'HD-R712规格书 V3.1_已签章.pdf',sha256:'b'.repeat(64),pages:[{page:3,text:'灰度等级 支持 256~65536 级'}]}},{document:{name:'HD-R712 Specification V3.1.pdf',sha256:'c'.repeat(64),pages:[{page:3,text:'Gray scale 256~65536'}]}}];
 const r=await createQuickRetrieval({knowledge,app,originalDocuments,resolveDocuments:async rows=>rows.map(r=>/Specification/.test(r.name)?{available:true,url:'/verified-original'}:{available:false,reason:'signed-edition-hidden'}),search:async()=>({results:[]})}).answer('R712灰阶多少');
 assert.equal(r.intent,'parameters');assert.equal(r.answerType,'parameter-answer');assert.match(r.reply,/256~65536/);assert.match(r.reply,/Specification V3.1/);assert.doesNotMatch(r.reply,/已签章/);
});
test('A defect name inside a capability question is not a report of an observed fault',async()=>{
 for(const q of ['R712支持灰阶异常检测吗','R712支持故障报警吗'])assert.equal(parseQuickQuery(q,lookup).intent,'parameters');
 assert.equal(parseQuickQuery('我的R712现在灰阶异常，怎么处理',lookup).intent,'aftersales');
 const r=await createQuickRetrieval({knowledge,app,originalDocuments:[{document:{name:'HD-R712规格书.pdf',pages:[{page:3,text:'灰度等级 支持256~65536级'}]}}],resolveDocuments:async rows=>rows.map(()=>({available:true,url:'/original'})),search:async()=>({results:[]})}).answer('R712支持灰阶异常检测吗');
 assert.notEqual(r.answerType,'parameter-answer');assert.doesNotMatch(r.reply,/256~65536/);
});
test('A new interface or module topic does not borrow the previous software or hardware identity',()=>{
 const software=context('software');const doc=parseQuickQuery('HDMI说明书',lookup,software);assert.equal(doc.intent,'resources');assert.deepEqual(doc.software,[]);assert.equal(doc.contextUsed,false);
 const module=parseQuickQuery('模组尺寸是多少',lookup,context('product'));assert.deepEqual(module.models,[]);assert.equal(module.contextUsed,false);
 const follow=parseQuickQuery('它的接口有哪些',lookup,context('product'));assert.deepEqual(follow.models,['HD-R712']);assert.equal(follow.contextUsed,true);
});
test('Software failures ask about software and exclude a different application from returned evidence',async()=>{
 const r=await createQuickRetrieval({app,knowledge,search:async()=>({results:[{name:'HDSet异常说明.pdf',text:'HDSet闪退'}]}),searchCases:async()=>({results:[]})}).answer('HDPlayer打不开怎么办');
 assert.equal(r.intent,'aftersales');assert.match(r.reply,/软件本身无法启动/);assert.doesNotMatch(r.reply,/接收卡\/驱动芯片完整型号|HDSet闪退/);assert(r.routeLog.filtered['different-software-source']);
});
test('Independent simultaneous requests are acknowledged rather than silently dropping one',async()=>{
 const r=await createQuickRetrieval({knowledge,app,search:async()=>{throw Error('priority not resolved');}}).answer('查R712参数，同时给我说明书');
 assert.equal(r.intent,'clarify');assert.deepEqual(r.queryPlan.decision.alternatives,['query-parameters','find-resources']);assert.match(r.reply,/先看参数，还是先找说明书/);assert.equal(r.routeLog.businessStatus.intent,'identified-multiple');
 assert.equal(parseQuickQuery('R712参数和接口多少',lookup).intent,'parameters');
});
test('Registered numeric identities are recorded as objects, separately from action and retrieved evidence',()=>{
 const chip=parseQuickQuery('1065',lookup);assert.equal(chip.decision.action,'identify-chip');assert(chip.decision.objects.some(o=>o.type==='chip'&&o.id==='ICN1065'));
 const product=parseQuickQuery('712',lookup);assert(product.decision.objects.some(o=>o.type==='product'&&o.id==='HD-R712'));
});
test('A generic parameter request consumes source table rows rather than returning only file names',async()=>{
 const r=await createQuickRetrieval({app,knowledge,originalDocuments:[{document:{name:'HD-R712 Specification V3.1.pdf',pages:[{page:3,text:'Control range 262144 pixels\nGray scale 256~65536'}]}}],resolveDocuments:async rows=>rows.map(()=>({available:true,url:'/original'})),search:async()=>({results:[]})}).answer('R712参数');
 assert.equal(r.intent,'parameters');assert.equal(r.answerType,'parameter-answer');assert.match(r.reply,/262144/);assert.match(r.reply,/256~65536/);
});
