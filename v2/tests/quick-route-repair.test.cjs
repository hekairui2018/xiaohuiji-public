'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
const {numericModelCandidates}=require('../domain/identity/extract-models.cjs');
const {createQuickRetrieval,rank}=require('../adapters/http/quick-retrieval.cjs');
const {operationExcerpt}=require('../adapters/http/quick-answer.cjs');
const products=['HD-R712','HD-R716','HD-C16L'].map(modelId=>({modelId,aliases:[modelId,modelId.slice(3)]}));
const lookup={products:()=>products,findProducts:id=>products.filter(p=>p.modelId===id),softwareItems:s=>/HDPlayer/i.test(s)?[{name:'HDPlayer'}]:[],isSoftware:s=>/HDPlayer/i.test(s),chipLookup:s=>/^(?:1065|ICN1065)$/.test(s)?{items:[{models:['ICN1065'],sourceReference:{page:3}}]}:null};
const knowledge={products:lookup.products,findProducts:lookup.findProducts};
const api=options=>createQuickRetrieval({knowledge,search:async()=>({results:[]}),searchCases:()=>({results:[]}),...options});
test('Numeric identity uses registered cores and aliases only, and ambiguity is not silently confirmed',async()=>{
 assert.deepEqual(numericModelCandidates('712',products).map(c=>c.modelId),['HD-R712']);
 assert.deepEqual(numericModelCandidates('712',[{modelId:'HD-R712S',aliases:['R712S']}]),[]);
 assert.deepEqual(parseQuickQuery('712',lookup).models,['HD-R712']);
 const ambiguousLookup={...lookup,products:()=>[...products,{modelId:'HD-A712',aliases:['A712']}]};
 assert.equal(parseQuickQuery('712',ambiguousLookup).ambiguous,true);
 const result=await api({knowledge:{...knowledge,products:ambiguousLookup.products,findProducts:id=>ambiguousLookup.products().filter(p=>p.modelId===id)}}).answer('712');
 assert.equal(result.answerType,'ambiguous-entity');assert.deepEqual(result.quickContext.models,[]);assert.match(result.reply,/HD-A712/);
 assert.deepEqual(parseQuickQuery('1065',lookup).chips,['ICN1065']);
});
test('Exact numeric hits survive without a known entity, but substring numbers do not',()=>{
 const q=parseQuickQuery('765',lookup),rows=[{type:'passage',name:'技术参考',text:'芯片765的原始记录'},{type:'passage',name:'技术参考',text:'芯片1765的原始记录'}];
 assert.equal(rank(q,[{source:'text',rows}],lookup).length,1);
});
test('Shared business intent distinguishes engineering, operation, fault, parameters and social',()=>{
 for(const [input,intent]of [['配单 屏幕宽1920高1080','ordering'],['R712 怎么升级','operation'],['R712 带载多少','parameters'],['HDPlayer 如何发送节目','operation'],['C16L 局部颜色异常','aftersales'],['R712 固件','resources'],['R712','product'],['谢谢','social']])assert.equal(parseQuickQuery(input,lookup).intent,intent,input);
 assert.equal(parseQuickQuery('HDPlayer 如何播放节目',lookup).intent,'operation');assert.deepEqual(parseQuickQuery('HDPlayer 如何播放节目',lookup).attributes,[]);
 assert.equal(parseQuickQuery('R712 数据组交换',lookup).intent,'technical');
});
test('Confirmed context continues through repeated turns and explicit switches do not borrow older facts',async()=>{
 const state={retrievalHistory:[{quickContext:{models:['HD-R712'],chips:[],software:[]}}]};
 assert.deepEqual(parseQuickQuery('怎么升级',lookup,state).models,['HD-R712']);
 assert.deepEqual(parseQuickQuery('R716 怎么升级',lookup,state).models,['HD-R716']);
 assert.deepEqual(parseQuickQuery('HDPlayer 如何发送节目',lookup,state).models,[]);
 assert.deepEqual(parseQuickQuery('R799 怎么升级',lookup,state).models,[]);
 const r=await api().answer('R716 带载多少',{state,facts:{modelIds:['HD-R712'],chips:['ICN1065'],firmwareVersions:['1.2.3']}});
 assert.deepEqual(r.queryPlan.models,['HD-R716']);assert.deepEqual(r.queryPlan.chips,[]);assert.deepEqual(r.queryPlan.versions,[]);
});
test('Chip identity, product suffix and hardware constraints remain hard gates for every source',()=>{
 const q=parseQuickQuery('ICN1065',lookup),filtered={};
 assert.equal(rank(q,[{source:'text',rows:[{type:'passage',name:'调试',text:'ICN1063调试'}]}],lookup,filtered).length,0);assert.equal(filtered['different-chip'],1);
 const op=parseQuickQuery('R716 怎么升级',lookup);
 assert.equal(rank(op,[{source:'manual',rows:[{type:'operation',name:'操作说明',text:'R712专用升级操作'}]}],lookup).length,0);
 assert.equal(rank(parseQuickQuery('R712硬件版本1.2固件',lookup),[{source:'catalog',rows:[{type:'document',name:'R712固件',modelIds:['HD-R712'],category:'firmware',download:'/file',versions:['1.2']}]}],lookup).length,0);
});
test('Operation answer reads its focused original and never falls into unrelated cases',async()=>{
 let cases=0,reads=0;const app={quickResources:()=>({}),chipLookup:()=>null,resourceMedia:{softwareItems:lookup.softwareItems},quickSearch:()=>({records:[]}),quickBrowse:()=>[]};
 const r=await api({app,localCatalog:async()=>[{name:'HDPlayer用户手册.pdf'}],searchCases:()=>{cases++;return {results:[]};},searchContext:async()=>[{name:'HDPlayer用户手册.pdf',blockId:12}],readContext:async()=>{reads++;return {text:'第五章 节目更新\n1.集群发送\n选择设备后点击发送。\n2.U盘更新节目\n点击导出U盘。\n3.U盘无限扩容节目\n不应混入。',contextComplete:true};}}).answer('HDPlayer 如何发送节目');
 assert.equal(cases,0);assert.equal(reads,1);assert.equal(r.answerType,'operation-excerpt');assert.match(r.reply,/选择设备后点击发送/);assert.doesNotMatch(r.reply,/不应混入/);
});
test('Operation excerpts reject TOCs and avoid borrowing surrounding unrelated tasks',()=>{
 assert.equal(operationExcerpt('目录\n节目更新...........46',{sendProgram:true}),null);
 const excerpt=operationExcerpt('无关连接步骤\n5.1 固件升级\n点击接收卡，选择固件。\n5.2 屏幕测试\n无关测试',{upgrade:true});assert.equal(excerpt.text,'5.1 固件升级\n点击接收卡，选择固件。');
});
test('Failure answers separate unavailable, unknown, unregistered, unrecognized and insufficient evidence',async()=>{
 const unavailable=await api({search:async()=>{throw Error('test-outage');}}).answer('765');assert.equal(unavailable.answerType,'service-unavailable');
 assert.equal((await api().answer('R799')).answerType,'entity-not-registered');
 assert.equal((await api().answer('765')).answerType,'data-not-registered');
 assert.equal((await api().answer('某个未知事物')).answerType,'unrecognized-intent');
 const inadequate=await api({search:async()=>({results:[{name:'参考',text:'与问题无关'}]})}).answer('765');assert.equal(inadequate.answerType,'insufficient-evidence');
});
test('Restricted claims are removed before composition; route log has counts and exclusion reasons without raw text',async()=>{
 const product={...products[0],claims:[{claimId:'private',field:'load',text:'带载999像素',verificationStatus:'verified',sourceReferences:[{originalName:'内部.pdf',originalSha256:'a'.repeat(64),verificationStatus:'verified'}]}]};
 const r=await api({knowledge:{products:()=>[product],findProducts:id=>id===product.modelId?[product]:[]},filterEvidence:async rows=>rows.filter(r=>r.evidenceId!=='private')}).answer('R712带载多少');
 assert.doesNotMatch(r.reply,/999/);assert.equal(r.routeLog.filtered['restricted-source'],1);assert(!JSON.stringify(r.routeLog).includes('999'));
});
test('Engineering delegates to the existing business executor and social does not call it',async()=>{
 let calls=0;const client=api({businessAnswer:async route=>{calls++;assert.equal(route.intent,'ordering');return {reply:'请补充屏幕参数',results:[],status:'clarify',retrievalTrace:[{name:'ordering-dialogue'}]};}});
 const r=await client.answer('配单 屏幕宽1920高1080像素');assert.equal(r.answerType,'engineering');assert.equal(calls,1);await client.answer('你好');assert.equal(calls,1);
});
