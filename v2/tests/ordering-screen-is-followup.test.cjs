'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseOrderingFields}=require('../domain/parser/ordering-fields.cjs');
test('Explicit whole-screen dimensions accept copulas without treating physical or module sizes as screen pixels',()=>{
 for(const text of ['整屏是1600x800','屏幕为1600×800','整屏的分辨率是1600*800']){
  const value=parseOrderingFields(text);assert.equal(value.screen.pixelWidth,1600);assert.equal(value.screen.pixelHeight,800);assert.equal(value.provenance['/screen/pixelWidth'].kind,'user-stated');
 }
 for(const text of ['整屏是1600x800毫米','整屏是1600x800mm','模组是160x80'])assert.equal(parseOrderingFields(text).screen?.pixelWidth,undefined,text);
});
test('The exact reported follow-up belongs to the active ordering task',()=>{
 const {decideTask}=require('../domain/parser/task-context.cjs');
 const dataset=require('../adapters/data/load-dataset.cjs').loadDataset();
 const state={taskState:{version:1,sequence:1,activeId:'screen-one',tasks:[{id:'screen-one',type:'ordering',status:'active',ordering:{confirmed:{schemaVersion:'2.0',operation:'ordering'},pending:[{path:'/screen'}]},context:{intent:'ordering'}}],events:[]}};
 const decision=decideTask('整屏是1600x800',dataset,state);
 assert.equal(decision.taskId,'screen-one');assert.equal(decision.needsInput,true);assert.equal(decision.ordering,true);assert.equal(decision.delta.screen,undefined);assert.equal(decision.update.pending.geometry.values.width,1600);
});
test('Reported two-turn conversation stores resolution and asks for other conditions rather than repeating task clarification',async()=>{
 const {createApp}=require('../app/bootstrap.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
 const {createQuickAnswer}=require('../adapters/http/quick-answer.cjs'),{createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs'),{createOfflineSessions}=require('../adapters/http/offline-session.cjs');
 const knowledge=loadKnowledge(),app=createApp({knowledge}),sessions=createOfflineSessions();let searches=0;
 const search=async()=>{searches++;return{results:[]};},business=createQuickAnswer({app,knowledge,search,searchCases:search});
 const api=createQuickRetrieval({app,knowledge,search,searchCases:search,businessAnswer:business.answer});
 try{
  let result;for(const message of ['配单','整屏是1600x800','是分辨率']){
   const state=sessions.update('screen-is-regression',{message});result=await api.answer(message,{state,facts:state.facts});sessions.recordResult(state.id,{quickContext:result.quickContext});sessions.recordAnswer(state.id,result);
  }
  const store=result.quickContext.taskState,task=store.tasks.find(t=>t.id===store.activeId);
  assert.equal(result.intent,'ordering');assert.equal(task.ordering.confirmed.screen.pixelWidth,1600);assert.equal(task.ordering.confirmed.screen.pixelHeight,800);
  assert.doesNotMatch(result.reply,/这句话是在补充|请指出对象/);assert.match(result.reply,/1600.*800/);assert.equal(searches,0);
 }finally{sessions.dispose();}
});
