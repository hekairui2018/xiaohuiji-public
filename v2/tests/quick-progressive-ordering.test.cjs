'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createApp}=require('../app/bootstrap.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createQuickAnswer}=require('../adapters/http/quick-answer.cjs'),{createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
const {progressiveOrdering}=require('../adapters/http/ordering-session.cjs'),{parseOrderingFields}=require('../domain/parser/ordering-fields.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge}),search=async()=>({results:[]});
function conversation(){
 const business=createQuickAnswer({app,knowledge,search,searchCases:search}),api=createQuickRetrieval({app,knowledge,search,searchCases:search,businessAnswer:business.answer});
 const state={id:'progressive-regression',messages:[],retrievalHistory:[],facts:{}};
 return {state,async say(message){state.messages.push({role:'user',content:message});const r=await api.answer(message,{state});state.retrievalHistory.push({quickContext:r.quickContext});return r;}};
}
const formal='配单P2.5 模组128x64，32扫，HUB75，全彩，室内，同步，接收卡，10宽10高';

test('Customer speech reaches the shared ordering business route, not arbitrary FTS/case matches',async()=>{
 for(const text of ['我要配个 P3 屏','P3 宽 6 米高 3 米','整屏分辨率 1920×1080，同步','模组横着 20 张，竖着 10 张']){
  const r=await conversation().say(text);assert.equal(r.intent,'ordering',text);assert.equal(r.modelCallCount,0);assert.equal(r.routeLog.sources[0].name,'ordering-dialogue');assert.equal(r.results.length,0);assert.equal(r.quickContext.ordering.pending.length>0,true);
  assert.equal((r.reply.match(/[？?]/g)||[]).length,1);assert(!r.result.bom);assert(!r.quickContext.ordering.confirmed.module?.scan);
 }
});

test('Physical targets are not silently rounded; explicit approval is recorded separately from source assumptions',async()=>{
 const c=conversation();await c.say('P3 宽6米高3米');await c.say('异步');let r=await c.say('室内');
 assert.equal(r.quickContext.ordering.confirmed.screen.physicalWidthMm,6000);assert.equal(r.quickContext.ordering.confirmed.screen.physicalHeightMm,3000);assert(!r.quickContext.ordering.confirmed.screen.moduleColumns);assert(!r.result.bom);
 assert.equal(r.quickContext.ordering.gridProposal.widthMm,6144);assert.match(r.reply,/允许调整尺寸/);
 r=await c.say('允许调整尺寸');const s=r.quickContext.ordering;
 assert.equal(r.intent,'ordering');assert.equal(s.confirmed.screen.physicalWidthMm,6144);assert.equal(s.confirmed.screen.moduleColumns,32);assert.equal(s.acceptedProposal.originalTarget.physicalWidthMm,6000);assert.equal(s.confirmed.provenance['/screen/moduleColumns'].kind,'user-approved-proposal');
 assert.equal(s.stage,'provisional');assert(!s.confirmed.module.scan);assert(!r.result.bom);
});

test('One condition updates only that condition; software/fault/firmware detours do not erase ordering',async()=>{
 const c=conversation();await c.say('我要配个P3屏');await c.say('宽6米高3米');await c.say('刚才那个改成异步');let r=await c.say('换成 A6L');
 assert.equal(r.quickContext.ordering.confirmed.providedDevices[0].modelId,'HD-A6L');
 for(const [message,intent]of [['HDPlayer 如何发送节目','operation'],['C16L 右边颜色异常','aftersales'],['R712 固件','resources'],['R712和R716能互刷吗','compatibility']]){r=await c.say(message);assert.equal(r.intent,intent);assert.equal(r.quickContext.ordering.confirmed.module.pitchMm,3);assert.equal(r.quickContext.ordering.confirmed.providedDevices[0].modelId,'HD-A6L');}
 r=await c.say('继续配单');assert.equal(r.intent,'ordering');assert.equal(r.quickContext.ordering.confirmed.screen.physicalHeightMm,3000);assert.equal(r.quickContext.ordering.confirmed.controlMode,'async');assert(!r.reply.includes('C16L'));
});

test('Source candidates and validated conditional calculations never become confirmed customer fields or a formal BOM',async()=>{
 const c=conversation();await c.say('模组横着20张，竖着10张');await c.say('P3');await c.say('室内');const r=await c.say('异步'),s=r.quickContext.ordering;
 assert.equal(s.stage,'provisional');assert(s.simulations.length);assert(s.simulations.every(v=>v.validation.passed&&v.source.sha256&&v.assumptions.includes('/module/scan')));assert(!s.confirmed.module.scan);assert(!s.confirmed.module.interface);assert(!s.confirmed.architecture);assert(!r.result.bom);assert.match(r.reply,/不是正式BOM/);assert.match(r.reply,/A5L/);assert.equal(r.routeLog.businessStatus.answer,'provisional');assert(s.pending.length);assert.equal(r.routeLog.ordering.simulationCount,s.simulations.length);
});

test('Complete demand still passes the original validator; subsequent grid changes reuse all confirmed module fields',async()=>{
 const c=conversation();let r=await c.say(formal);assert.equal(r.quickContext.ordering.stage,'formal');assert(r.result.validation.passed);assert.equal(r.result.bom[0].quantity,100);
 r=await c.say('改成12宽10高');assert.equal(r.quickContext.ordering.stage,'formal');assert.equal(r.result.bom[0].quantity,120);assert.equal(r.result.normalizedDemand.module.pitchMm,2.5);
 const independent=await app.dialogue({...r.quickContext.ordering.confirmed});assert.deepEqual(r.result.bom,independent.bom);
});

test('Only exact arithmetic on explicit module sizes can derive a formal grid',async()=>{
 const r=await progressiveOrdering(app,'配单P2.5 模组128x64，32扫，HUB75，全彩，室内，同步，接收卡，整屏1280×640');
 assert.equal(r.orderingState.stage,'formal');assert.equal(r.result.bom[0].quantity,100);assert(!r.orderingState.confirmed.screen.moduleColumns);assert(r.orderingState.derived.length===2);
 const notDivisible=await progressiveOrdering(app,'配单P2.5 模组128x64，32扫，HUB75，全彩，室内，同步，接收卡，整屏1280×641');assert.notEqual(notDivisible.orderingState.stage,'formal');assert(!notDivisible.result.bom);
});

test('Explicit correction, negation and a new screen cannot reuse stale derived geometry or old module attributes',async()=>{
 const c=conversation();await c.say(formal);let r=await c.say('不是同步，改成异步');assert.equal(r.quickContext.ordering.confirmed.controlMode,'async');
 r=await c.say('改成P3');assert.equal(r.quickContext.ordering.confirmed.module.pitchMm,3);assert(!r.quickContext.ordering.confirmed.module.scan);assert(!r.quickContext.ordering.confirmed.provenance['/module/scan']);
 r=await c.say('不是全彩');assert(!r.quickContext.ordering.confirmed.module.color);assert.equal(r.quickContext.ordering.simulations.length,0);
 r=await c.say('另一块屏');assert(!r.quickContext.ordering.confirmed.module);assert(!r.quickContext.ordering.confirmed.screen);
 r=await c.say('室内');assert(!r.quickContext.ordering.confirmed.module);assert.equal(r.quickContext.ordering.confirmed.environment,'indoor');
 const absent=await conversation().say('继续配单');assert.equal(absent.answerType,'task-relation-unclear');assert.equal(absent.quickContext.ordering,null);
});

test('Unverified hardware versions and model suffixes cannot reach a conditional or formal selection',async()=>{
 const c=conversation();await c.say(formal);const r=await c.say('配单改用 A6LL');assert.match(r.reply,/尚未确认型号/);assert(!r.result?.bom);
 const version=await c.say('配单 A6L 硬件版本1.2');assert.match(version.reply,/硬件版本/);assert(!version.result?.bom);
 const a6l=await c.say('换成 A6L');assert.equal(a6l.quickContext.ordering.confirmed.providedDevices[0].modelId,'HD-A6L');assert.notEqual(a6l.quickContext.ordering.stage,'formal');
});

test('Multi-screen and incompatible module conditions cannot masquerade as a validated single-screen BOM',async()=>{
 const c=conversation();await c.say(formal);const r=await c.say('配单两个独立屏，主屏和副屏');assert.equal(r.result.status,'needs_input');assert(!r.result.bom);assert.equal(r.quickContext.ordering.simulations.length,0);assert.match(r.reply,/多屏/);
 const conflict=await progressiveOrdering(app,'配单P3 模组999x999，室内同步');assert.equal(conflict.orderingState.stage,'conflict');assert(!conflict.result.bom);
});

test('Metres, module counts and pixels remain separate with V1-style word order',()=>{
 for(const input of ['宽6米高3米','6米宽3米高','长6米宽3米','6m×3m']){const r=parseOrderingFields(input);assert.equal(r.screen.physicalWidthMm,6000,input);assert.equal(r.screen.physicalHeightMm,3000,input);assert(!r.screen.moduleColumns);}
 const grid=parseOrderingFields('模组横着20张，竖着10张');assert.deepEqual(grid.screen,{moduleColumns:20,moduleRows:10});assert(!parseOrderingFields('模组128×64').screen);assert(!parseOrderingFields('模组尺寸320×160mm').screen);
 assert.deepEqual(parseOrderingFields('宽1920高1080').screen,{pixelWidth:1920,pixelHeight:1080});
});

test('Requested receiver and controller roles are retained independently when one is replaced',async()=>{
 const c=conversation();await c.say(formal);await c.say('换成R712');let r=await c.say('换成VP410');assert.deepEqual(r.quickContext.ordering.confirmed.providedDevices.map(d=>d.modelId),['HD-R712','HD-VP410']);
 r=await c.say('换成R716');assert.deepEqual(r.quickContext.ordering.confirmed.providedDevices.map(d=>d.modelId),['HD-VP410','HD-R716']);
});
