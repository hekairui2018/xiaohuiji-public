'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs');
const {createQuickAnswer}=require('../adapters/http/quick-answer.cjs'),{createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
const {createOfflineSessions}=require('../adapters/http/offline-session.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge});
function fixture(sessions=createOfflineSessions(),id='task-test'){
 let searches=0;
 const search=async()=>{searches++;return {results:[]}},business=createQuickAnswer({app,knowledge,search,searchCases:search});
 const api=createQuickRetrieval({app,knowledge,search,searchCases:search,businessAnswer:business.answer});
 return {sessions,get searches(){return searches},async say(message){const state=sessions.update(id,{message});const r=await api.answer(message,{state,facts:state.facts});sessions.recordResult(id,{quickContext:r.quickContext});sessions.recordAnswer(id,r);return r},state:()=>sessions.get(id)};
}
const active=r=>r.quickContext.taskState.tasks.find(t=>t.id===r.quickContext.taskState.activeId);
test('Whole dialogue updates, corrects, detours and resumes with task-owned slots',async()=>{
 const c=fixture();try{
  let r=await c.say('我要配一块P2.5的室内屏');const id=active(r).id;
  for(const [text,width,mode]of [['分辨率是1600×800',1600,undefined],['用异步的',1600,'async'],['不对，改成同步',1600,'sync'],['不是1600，是1920×1080',1920,'sync']]){
   r=await c.say(text);assert.equal(active(r).id,id);assert.equal(active(r).ordering.confirmed.screen.pixelWidth,width);assert.equal(active(r).ordering.confirmed.controlMode,mode);assert.equal(active(r).ordering.confirmed.module.pitchMm,2.5);
  }
  assert.equal(c.searches,0);r=await c.say('顺便查一下R712灰阶');assert.equal(r.intent,'parameters');assert.notEqual(active(r).id,id);assert.equal(active(r).ordering,undefined);assert.equal(r.queryPlan.orderingContext,null);
  const n=c.searches;r=await c.say('不太行啊');assert.equal(r.intent,'feedback');assert.equal(c.searches,n);
  r=await c.say('刚才那块屏继续配');assert.equal(r.intent,'ordering');assert.equal(active(r).id,id);assert.equal(active(r).ordering.confirmed.screen.pixelWidth,1920);assert.equal(active(r).ordering.confirmed.controlMode,'sync');assert.deepEqual(r.queryPlan.models,[]);assert.equal(c.searches,n);
 }finally{c.sessions.dispose()}
});
test('Different geometry entities never bind solely because a screen field is pending',async()=>{
 const c=fixture();try{
  await c.say('配一块P2室内屏');let r=await c.say('模组分辨率是160×80');assert.equal(active(r).ordering.confirmed.screen,undefined);assert.equal(active(r).ordering.confirmed.module.pixelWidth,160);
  r=await c.say('整屏分辨率是1280×640');assert.equal(active(r).ordering.confirmed.screen.pixelWidth,1280);
  await c.say('R712规格书');const n=c.searches;r=await c.say('1920×1080');assert.equal(r.answerType,'task-relation-unclear');assert.equal(c.searches,n);assert.equal(r.quickContext.ordering.confirmed.screen.pixelWidth,1280);
 }finally{c.sessions.dispose()}
});
test('Multiple suspended screens require selection and cancellation does not delete history',async()=>{
 const c=fixture();try{
  await c.say('配一块P2室内屏');await c.say('另一块屏');await c.say('P3');await c.say('R712灰阶多少');const before=c.state().messages.length;
  const r=await c.say('恢复刚才配单');assert.equal(r.answerType,'task-relation-unclear');assert.equal(r.quickContext.taskState.tasks.filter(t=>t.type==='ordering').length,2);
  await c.say('取消当前任务');assert.ok(c.state().messages.length>before);assert.equal(c.state().taskState.activeId,null);
 }finally{c.sessions.dispose()}
});
test('Unfinished task survives idle retrieval eviction and disk reload; clients stay isolated',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task-dialogue-'));let now=Date.now(),sessions=createOfflineSessions(dir,{now:()=>now});
 try{
  const a=fixture(sessions,'client-alpha'),b=fixture(sessions,'client-beta');
  await Promise.all([a.say('配单P2室内屏'),b.say('配单P3户外屏')]);await Promise.all([a.say('1600×800'),b.say('1920×1080')]);
  now+=300001;sessions.sweep();sessions.dispose();sessions=createOfflineSessions(dir,{now:()=>now});
  const aa=fixture(sessions,'client-alpha'),bb=fixture(sessions,'client-beta');
  let [ra,rb]=await Promise.all([aa.say('继续配单'),bb.say('继续配单')]);
  assert.equal(active(ra).pendingUpdate.geometry.values.width,1600);assert.equal(active(rb).pendingUpdate.geometry.values.width,1920);
  [ra,rb]=await Promise.all([aa.say('这是像素'),bb.say('这是像素')]);
  assert.equal(active(ra).ordering.confirmed.module.pitchMm,2);assert.equal(active(rb).ordering.confirmed.module.pitchMm,3);assert.equal(active(ra).ordering.confirmed.screen.pixelWidth,1600);assert.equal(active(rb).ordering.confirmed.screen.pixelWidth,1920);
  assert.equal(aa.searches+bb.searches,0);
 }finally{sessions.dispose();fs.rmSync(dir,{recursive:true,force:true})}
});
test('Unclear and multi-action messages do not partially mutate a plan',async()=>{
 const c=fixture();try{
  await c.say('配单P2室内屏');await c.say('1600×800');const previous=c.state().taskState.tasks[0].ordering.confirmed;
  const r=await c.say('改成同步，同时查R712灰阶');assert.equal(r.status,'clarify');assert.deepEqual(r.quickContext.taskState.tasks[0].ordering.confirmed,previous);
 }finally{c.sessions.dispose()}
});
test('A new topic and its follow-ups cannot inherit another task firmware or chips',async()=>{
 const c=fixture();try{
  await c.say('R712 固件版本1.2 芯片ICN1065 闪屏');let r=await c.say('A5L带载多少');
  assert.deepEqual(r.queryPlan.chips,[]);assert.deepEqual(r.queryPlan.versions,[]);
  r=await c.say('它有多少网口');assert.deepEqual(r.queryPlan.models,['HD-A5L']);assert.deepEqual(r.queryPlan.chips,[]);assert.deepEqual(r.queryPlan.versions,[]);
 }finally{c.sessions.dispose()}
});
test('Selecting an older suspended task projects that task rather than the newest screen',async()=>{
 const c=fixture();try{
  await c.say('配单P2室内屏');await c.say('另一块屏');await c.say('P4');await c.say('R716规格书');
  const r=await c.say('恢复P2配单');assert.equal(active(r).ordering.confirmed.module.pitchMm,2);assert.equal(r.quickContext.ordering.confirmed.module.pitchMm,2);
 }finally{c.sessions.dispose()}
});
