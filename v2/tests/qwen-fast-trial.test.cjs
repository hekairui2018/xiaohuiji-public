'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createQwenFastTrial,recentRounds,validate}=require('../model-adapter/qwen-fast-trial.cjs');
test('five recent complete rounds retained without deleting the source history',()=>{
 const messages=Array.from({length:8},(_,i)=>[{role:'user',content:'q'+i},{role:'assistant',content:'a'+i}]).flat();
 assert.equal(recentRounds(messages).length,10);assert.equal(recentRounds(messages)[0].content,'q3');assert.equal(messages.length,16);
});
function fake(){const calls=[];return {calls,transport:async(url,options={})=>{
 await new Promise(r=>setTimeout(r,15));
 if(url.pathname==='/health')return {ok:true,json:async()=>({ready:true})};
 const body=JSON.parse(options.body);calls.push(body);
 return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"action":"search","kind":"cases","query":"局部 不亮","models":[],"concepts":["不亮"],"goals":["相似现象"]}'}}],usage:{completion_tokens:40}})};
 }};}
const execute=async()=>({evidence:[{evidenceId:'fixture-1',name:'合成资料',text:'合成候选片段'}]});
test('five concurrent customers use private history and the sixth request is refused',async()=>{
 const f=fake(),expert=createQwenFastTrial({transport:f.transport});
 const results=await Promise.all(Array.from({length:6},(_,i)=>expert.answer({message:'问题-'+i,route:{intent:'technical'},execute,sessionState:{messages:[{role:'user',content:'private-'+i},{role:'assistant',content:'previous-'+i},{role:'user',content:'问题-'+i}]}})));
 assert.equal(results.filter(r=>r.status==='answer').length,5);assert.equal(results[5].status,'busy');
 for(let i=0;i<5;i++){
  const call=f.calls.find(c=>c.messages[1].content.includes('当前客户问题：问题-'+i+'\n'));
  assert.ok(call);const context=call.messages[1].content;
  assert.ok(context.includes('private-'+i));assert.ok(!context.includes('private-'+((i+1)%5)));
 }
 assert.equal((await expert.answer({message:'你好',route:{intent:'social'}})).status,'answer');
});
test('one short model decision, one existing tool call, and no generated final company claim',async()=>{
 const f=fake(),expert=createQwenFastTrial({transport:f.transport});
 const result=await expert.answer({message:'局部不亮',route:{intent:'technical'},execute,sessionState:{messages:[]}});
 assert.equal(result.status,'answer');assert.equal(f.calls.length,1);assert.equal(f.calls[0].max_tokens,160);
 assert.equal(result.modelCallCount,1);assert.equal(result.toolCallCount,1);assert.deepEqual(result.claims,[]);
 assert.equal(result.results[0].referenceOnly,true);assert.match(result.reply,/不代表当前故障原因/);
});
test('unrecognized actions and extra tool arguments are refused',()=>{
 assert.throws(()=>validate({action:'delete',query:'test'}));
 assert.throws(()=>validate({action:'search',kind:'files',query:'test',path:'C:/private'}));
});
