'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs');
const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
const {analyzeFrames}=require('../domain/parser/intent-frames.cjs');
const k=loadKnowledge(),app=createApp({knowledge:k}),lookup={...k,softwareItems:app.resourceMedia.softwareItems,isSoftware:s=>!!app.resourceMedia.softwareItems(s).length,chipLookup:app.chipLookup};
for(const [text,intent]of require('./intent-frame-development.cjs'))test('Request scope: '+text,()=>assert.equal(parseQuickQuery(text,lookup).intent,intent));
test('Phrase spans bind predicate to the nearest typed object in the same clause',()=>{
 const q='设备搜不到，先给我说明书',f=analyzeFrames(q);
 assert.equal(f.focusText,'先给我说明书');
 assert(f.relations.some(r=>r.predicate.text==='搜不到'&&r.target.type==='device'));
 assert(f.relations.some(r=>r.predicate.text==='先给'&&r.target.type==='document'));
 for(const c of f.clauses)for(const t of c.tokens)assert.equal(q.slice(t.start,t.end),t.text);
});
test('Background identities cannot contaminate a new explicit model or software request',()=>{
 assert.deepEqual(parseQuickQuery('R712花屏，先查R716参数',lookup).models,['HD-R716']);
 const q=parseQuickQuery('HDSet闪退，先给HDPlayer手册',lookup);assert.deepEqual(q.software,['HDPlayer']);
 const r=parseQuickQuery('R712没信号，我只问HDMI输入分辨率多少',lookup);assert.deepEqual(r.models,[]);
});
test('A background symptom is retained when the follow-up asks how to handle that symptom',()=>{
 const r=parseQuickQuery('R712灰阶不正常，怎么处理',lookup);assert.equal(r.intent,'aftersales');assert(r.symptoms.length);
});
test('Negation scope never makes a negated-only request into a positive business action',()=>{
 for(const q of ['不要配单','别配卡','无需配屏']){const r=parseQuickQuery(q,lookup);assert.equal(r.intent,'clarify');assert(r.decision.missing.includes('positive-request'));}
});

test('Longest lexical spans prevent handling verbs from becoming a request to search',()=>{
 for(const verb of ['排查','检查','自查','核查']){
  const f=analyzeFrames('HDPlayer打不开，如何'+verb);
  assert(!f.clauses.at(-1).tokens.some(t=>t.type==='request'));
  assert.equal(parseQuickQuery('HDPlayer打不开，如何'+verb,lookup).intent,'aftersales');
 }
});

test('Attribute-question relations cover fronted attributes and new entity names',()=>{
 for(const q of ['R716接口有哪些','有哪些接口，R708','R708灰阶是什么','A6L接口有啥'])assert.equal(parseQuickQuery(q,lookup).intent,'parameters');
});
test('Independent fragments retain both business goals',()=>{
 const r=parseQuickQuery('R712参数。同时给我说明书',lookup);assert.equal(r.intent,'clarify');assert.deepEqual(r.decision.alternatives,['query-parameters','find-resources']);
});
test('Complete social phrases do not override a technical question',()=>{
 assert.equal(parseQuickQuery('谢了',lookup).intent,'social');assert.equal(parseQuickQuery('谢了，R712带载多少',lookup).intent,'parameters');
});

test('Stored session facts cannot refill an old hardware identity after a topic change',async()=>{
 const {createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
 const api=createQuickRetrieval({app,knowledge:k,search:async()=>({results:[]}),searchCases:async()=>({results:[]})});
 for(const q of ['模组尺寸是多少','HDMI说明书']){const r=await api.answer(q,{facts:{modelIds:['HD-R712']}});assert.deepEqual(r.queryPlan.models,[]);}
});

test('Mentioning parameters in an event narrative is not a request for parameters',()=>{
 for(const q of ['加载软件内置的参数后，调式完客户有拍照有水波纹','更新了接口参数，屏幕出现花屏','修改尺寸后，屏幕不亮'])assert.equal(parseQuickQuery(q,lookup).intent,'aftersales');
 assert.equal(analyzeFrames('R712参数，同时给我说明书').clauses[0].role,'request');
});

test('An observed fault noun differs from a feature question or edition adjective',()=>{
 for(const q of ['模组出现阴影','接收卡有暗影','屏幕有残影','C16L国内云通用版添加表格有拖影','摄像机拍摄有扫描线问题'])assert.equal(parseQuickQuery(q,lookup).intent,'aftersales');
 for(const q of ['R712支持残影消除吗','R712有没有阴影补偿功能'])assert.equal(parseQuickQuery(q,lookup).intent,'parameters');
 assert.equal(parseQuickQuery('HDPlayer通用版有什么功能',lookup).intent,'software-function');
 assert.equal(parseQuickQuery('R512和R512S固件通用吗',lookup).intent,'compatibility');
});

test('Relations outside the chosen request remain diagnostic and cannot change its intent',()=>{
 assert.equal(parseQuickQuery('R712有暗影，想了解R716带载多少',lookup).intent,'parameters');
 assert.equal(parseQuickQuery('R712有残影，我想知道HDPlayer有什么功能',lookup).intent,'software-function');
 const q=parseQuickQuery('R712花屏，我想了解HDPlayer通用版的功能',lookup);assert.equal(q.intent,'software-function');
});
