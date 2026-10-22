'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseOrderingFields}=require('../domain/parser/ordering-fields.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs');
const {createQuickAnswer}=require('../adapters/http/quick-answer.cjs'),{createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
test('Screen resolution statements accept declarative markers without stealing module geometry or physical units',()=>{
 for(const text of ['分辨率是1600x800','分辨率为1920×1080','整屏分辨率是1280*640','屏幕的分辨率：1024x768','分辨率1600x800像素']){
  const r=parseOrderingFields(text);assert.ok(r.screen?.pixelWidth,text);assert.ok(r.screen?.pixelHeight,text);assert.equal(r.provenance['/screen/pixelWidth'].kind,'user-stated');
 }
 for(const text of ['模组分辨率是160x80','模组的分辨率为128×64']){
  const r=parseOrderingFields(text);assert.equal(r.screen,undefined,text);assert.ok(r.module?.pixelWidth,text);
 }
 for(const text of ['分辨率是1600x800mm','R712分辨率是多少','HDMI输入分辨率是1920x1080','10高10宽'])assert.equal(parseOrderingFields(text).screen,undefined,text);
});
test('Screenshot conversation retains P2 and consumes resolution without issuing retrieval or model requests',async()=>{
 const knowledge=loadKnowledge(),app=createApp({knowledge});let searches=0;
 const search=async()=>{searches++;return {results:[]}},business=createQuickAnswer({app,knowledge,search,searchCases:search});
 const api=createQuickRetrieval({app,knowledge,search,searchCases:search,businessAnswer:business.answer}),state={id:'ordering-resolution-regression',messages:[],retrievalHistory:[],facts:{}};
 const say=async message=>{state.messages.push({role:'user',content:message});const r=await api.answer(message,{state});state.retrievalHistory.push({quickContext:r.quickContext});return r};
 let r=await say('P2，10高10宽配个屏');assert.equal(r.intent,'ordering');assert.equal(r.quickContext.ordering.confirmed.screen,undefined,'unitless 10 must not become metres or modules');
 r=await say('分辨率是1600x800');assert.equal(r.intent,'ordering');assert.match(r.reply,/1600×800/);assert.match(r.reply,/P2/);assert.doesNotMatch(r.reply,/屏幕宽、高各多少米|相关原文/);
 assert.deepEqual(r.quickContext.ordering.confirmed.screen,{pixelWidth:1600,pixelHeight:800});assert.equal(r.quickContext.ordering.confirmed.module.pitchMm,2);assert.equal(searches,0);assert.equal(r.modelCallCount,0);assert.ok(!r.result.bom);
 // Existing business output can produce either a conditional calculation or
 // a source-backed controller preview. Neither may become confirmed fields.
 if(r.quickContext.ordering.simulations.length){assert.match(r.reply,/不是正式BOM/);assert.ok(r.quickContext.ordering.simulations.every(s=>s.source&&s.assumptions.length&&s.preview.exportAllowed===false));}
 else{assert.match(r.reply,/先筛主控/);assert.match(r.reply,/接收卡数量及布线还未核定/);assert.ok(r.quickContext.ordering.controllerPreviews.length);}
 assert.equal(r.quickContext.ordering.confirmed.controlMode,undefined);assert.equal(r.quickContext.ordering.confirmed.architecture,undefined);assert.equal(r.quickContext.ordering.confirmed.environment,undefined);
 r=await say('分辨率改为1920x1080');assert.equal(r.intent,'ordering');assert.deepEqual(r.quickContext.ordering.confirmed.screen,{pixelWidth:1920,pixelHeight:1080});assert.equal(r.quickContext.ordering.confirmed.module.pitchMm,2);
});
test('Controller preview uses existing source filters and does not weaken final module validation',()=>{
 const {loadDataset}=require('../adapters/data/load-dataset.cjs'),{previewControllers}=require('../domain/ordering/controller-preview.cjs'),{controllerCandidates}=require('../domain/ordering/controller-selector.cjs');
 const dataset=loadDataset(),demand={screen:{pixelWidth:1600,pixelHeight:800}},snapshot=structuredClone(demand),previews=previewControllers(demand,dataset);
 assert.ok(previews.length);assert.deepEqual(demand,snapshot);
 for(const p of previews){
  const actual=controllerCandidates({...demand,controlMode:p.controlMode,architecture:'receiver',requirements:{controllerFamily:p.family}},{pixelWidth:1600,pixelHeight:800,points:1280000},dataset);
  assert.deepEqual(p.models.map(m=>m.modelId),actual.controllers.slice(0,2).map(d=>'HD-'+d.model));assert.ok(p.models.every(m=>m.source));
 }
 assert.ok(previewControllers({...demand,controlMode:'async'},dataset).every(p=>p.family==='playBox'));
 for(const d of [{screen:{pixelWidth:0,pixelHeight:800}},{...demand,architecture:'direct'},{...demand,requirements:{controllerFamily:'asyncCard'}},{...demand,providedDevices:[{modelId:'HD-A6LL'}]},{...demand,providedDevices:[{modelId:'HD-A6L',revisionId:'unverified'}]}])assert.deepEqual(previewControllers(d,dataset),[]);
});
