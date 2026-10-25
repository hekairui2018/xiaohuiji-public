'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
for(const action of [{action:'clarify',question:'资料不足，请补充型号。'},{action:'search',query:'重复搜索',kind:'text'},{action:'finish'},{action:'analyze',reason:'再想一次'}]){
 test('One generation request only, including '+action.action,async()=>{
  let calls=0,tools=0;
  const expert=createEvidenceExpert({transport:async(url,options)=>{
   if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'qwen3.8-synthetic'}]})};
   if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
   if(url.pathname==='/tokenize')return {ok:false};
   const choices=JSON.parse(options.body).response_format.json_schema.schema.oneOf;
   assert.deepEqual(choices.map(s=>s.properties.action.const),['answer','clarify']);
   calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(action)}}]})};
  }});
  const result=await expert.answer({message:'请查技术资料',route:{intent:'technical'},execute:async()=>{tools++;throw Error('No model-selected tools');}});
  assert.equal(result.modelCallCount,1);assert.equal(calls,1);assert.equal(tools,0);
  assert.equal(result.status,action.action==='clarify'?'clarify':'unavailable');
 });
}
