'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs');
const {createQuickAnswer}=require('../adapters/http/quick-answer.cjs'),{createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs'),{createOfflineSessions}=require('../adapters/http/offline-session.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge});
function fixture(){
 const sessions=createOfflineSessions(),calls=[];const search=async(query,kind,options)=>{calls.push({query,kind,options});return{results:[]};};
 const business=createQuickAnswer({app,knowledge,search,searchCases:search}),api=createQuickRetrieval({app,knowledge,search,searchCases:search,businessAnswer:business.answer});
 return {calls,close:()=>sessions.dispose(),async say(message,id='composition'){
  const state=sessions.update(id,{message}),r=await api.answer(message,{state,facts:state.facts});sessions.recordResult(id,{quickContext:r.quickContext});sessions.recordAnswer(id,r);return r;
 }};
}
const task=r=>r.quickContext.taskState.tasks.find(t=>t.id===r.quickContext.taskState.activeId);
const unitCases=[['这是像素','pixelWidth','pixelHeight',1],['单位是毫米','physicalWidthMm','physicalHeightMm',1],['刚才说的是分辨率','pixelWidth','pixelHeight',1]];
// Cartesian products exercise composition, not one memorized full sentence.
for(const dimensions of ['整屏1600×800','屏宽1600高800','1600乘800','宽1600高800'])for(const [unit,width,height,factor]of unitCases){
 test('Typed geometry and later property compose: '+dimensions+' / '+unit,async()=>{
  const c=fixture();try{
   let r=await c.say('我要配一块P2屏'),id=task(r).id;r=await c.say(dimensions);
   assert.equal(task(r).id,id);assert.equal(task(r).ordering.confirmed.screen,undefined);assert.equal(task(r).pendingUpdate.geometry.values.width,1600);assert.match(r.reply,/像素.*实际尺寸/);
   r=await c.say(unit);assert.equal(task(r).id,id);assert.equal(task(r).ordering.confirmed.screen[width],1600*factor);assert.equal(task(r).ordering.confirmed.screen[height],800*factor);assert.equal(task(r).pendingUpdate,null);
   const n=task(r).revisions.length;r=await c.say('不对，我说错了');assert.equal(task(r).ordering.confirmed.screen[width],1600);assert.match(r.reply,/更正哪项/);
   r=await c.say('改成1920×1080');assert.equal(task(r).ordering.confirmed.screen[width],1920);assert.equal(task(r).ordering.confirmed.screen[height],1080);assert.ok(task(r).revisions.length>n);
   const change=task(r).revisions.at(-1).changes.find(f=>f.path==='/screen/'+width);assert.equal(change.before,1600);assert.equal(change.after,1920);assert.ok(change.source.text);assert.equal(c.calls.length,0);assert.equal(r.modelCallCount,0);
  }finally{c.close();}
 });
}
test('Only the addressed field changes, reversion restores a real task revision, and negation clears rather than inverts',async()=>{
 const c=fixture();try{
  await c.say('配单P3室内同步');await c.say('整屏分辨率1280×640');await c.say('改成1920×960');let r=await c.say('还是原来的');assert.equal(task(r).ordering.confirmed.screen.pixelWidth,1280);
  r=await c.say('不是室内');assert.equal(task(r).ordering.confirmed.environment,undefined);assert.notEqual(task(r).ordering.confirmed.environment,'outdoor');assert.equal(task(r).ordering.confirmed.module.pitchMm,3);assert.equal(task(r).ordering.confirmed.screen.pixelWidth,1280);
  assert.ok(task(r).lastRelation.operations.some(o=>o.op==='clear'&&o.path==='/environment'));assert.equal(task(r).completed,false);
 }finally{c.close();}
});
test('Units can reinterpret the last geometry without replacing unrelated fields',async()=>{
 const c=fixture();try{await c.say('配单P2室内');await c.say('整屏分辨率1600×800');const r=await c.say('单位是毫米');assert.deepEqual(task(r).ordering.confirmed.screen,{physicalWidthMm:1600,physicalHeightMm:800});assert.equal(task(r).ordering.confirmed.module.pitchMm,2);assert.equal(task(r).ordering.confirmed.environment,'indoor');assert.equal(task(r).revisions.at(-1).changes.filter(x=>x.after===null).length,2);}finally{c.close();}
});
test('A suspended unresolved field keeps its owner through product, fault and document tasks',async()=>{
 const c=fixture();try{
  let r=await c.say('配单P4'),id=task(r).id;await c.say('2560乘1280');await c.say('R712灰阶多少');await c.say('HDPlayer打不开');r=await c.say('A5L规格书');
  assert.equal(r.intent,'resources');assert.deepEqual(r.queryPlan.models,['HD-A5L']);assert.equal(r.queryPlan.orderingContext,null);assert.ok(c.calls.every(x=>!String(x.query).includes('2560')));
  r=await c.say('继续刚才的');assert.equal(task(r).id,id);assert.ok(task(r).pendingUpdate);r=await c.say('这是像素');assert.equal(task(r).ordering.confirmed.screen.pixelWidth,2560);assert.deepEqual(r.queryPlan.models,[]);
 }finally{c.close();}
});
test('Different conversations cannot supply each other dimensions or labels; completion is explicit',async()=>{
 const c=fixture();try{
  await c.say('配单P2','client-one');await c.say('1600乘800','client-one');await c.say('配单P4','client-two');let other=await c.say('这是像素','client-two');assert.equal(task(other).ordering?.confirmed.screen,undefined);
  const first=await c.say('这是像素','client-one');assert.equal(task(first).ordering.confirmed.screen.pixelWidth,1600);assert.equal(task(first).ordering.confirmed.module.pitchMm,2);
  other=await c.say('任务确认完成','client-one');assert.equal(other.quickContext.taskState.activeId,null);assert.equal(other.quickContext.taskState.tasks[0].completed,true);
 }finally{c.close();}
});
test('Pending geometry does not swallow other typed fields and cannot leak into a new screen',async()=>{
 const c=fixture();try{
  await c.say('配单P2');await c.say('1600乘800');let r=await c.say('室内');assert.equal(task(r).ordering.confirmed.environment,'indoor');assert.ok(task(r).pendingUpdate.geometry);assert.match(r.reply,/1600.*800/);
  r=await c.say('另一块屏');assert.equal(task(r).pendingUpdate,null);assert.equal(task(r).ordering.confirmed.screen,undefined);assert.equal(task(r).ordering.confirmed.environment,undefined);
 }finally{c.close();}
});
test('Denying a known condition clears it without feeding it back as a positive constraint',async()=>{
 const c=fixture();try{
  await c.say('配单P2室内');let r=await c.say('不是P2');assert.equal(task(r).ordering.confirmed.module.pitchMm,undefined);assert.ok(task(r).lastRelation.operations.some(o=>o.path==='/module/pitchMm'&&o.op==='clear'));
  await c.say('改成P3');await c.say('换成A6L');r=await c.say('不要A6L');assert.deepEqual(task(r).ordering.confirmed.providedDevices,[]);
 }finally{c.close();}
});
test('A typed dimension focus supports one-axis changes, and mixed physical units convert exactly',async()=>{
 const c=fixture();try{
  await c.say('配单P2');await c.say('分辨率1600×800');let r=await c.say('宽1920');assert.deepEqual(task(r).ordering.confirmed.screen,{pixelWidth:1920,pixelHeight:800});
  r=await c.say('宽1.92米高1080毫米');assert.deepEqual(task(r).ordering.confirmed.screen,{physicalWidthMm:1920,physicalHeightMm:1080});
 }finally{c.close();}
});
test('Denying a different value never overwrites or clears an already confirmed value',async()=>{
 const c=fixture();try{await c.say('配单P2室内');let r=await c.say('不是P3');assert.equal(task(r).ordering.confirmed.module.pitchMm,2);r=await c.say('不是户外');assert.equal(task(r).ordering.confirmed.environment,'indoor');assert.ok(task(r).excludedConditions.length);}finally{c.close();}
});
test('Denying the confirmed geometry clears both axes and never silently chooses new dimensions',async()=>{
 const c=fixture();try{await c.say('配单P2');await c.say('分辨率1600×800');const r=await c.say('不是1600×800');assert.equal(task(r).ordering.confirmed.screen.pixelWidth,undefined);assert.equal(task(r).ordering.confirmed.screen.pixelHeight,undefined);assert.equal(task(r).ordering.confirmed.module.pitchMm,2);}finally{c.close();}
});
