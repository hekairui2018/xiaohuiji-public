'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
test('two source-backed comparison columns use the full answer budget even if the legacy registry knows only one model',async()=>{
 let count=0;
 const expert=createEvidenceExpert({thinkingEnabled:false,maxModelCalls:1,transport:async(url,options)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'qwen3.8-synthetic'}]})};
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:16384}})};
  if(url.pathname==='/tokenize')return {ok:false};
  count++;const body=JSON.parse(options.body);assert(body.max_tokens>768);assert.match(body.messages[0].content,/服务端直接展示完整参数对比表/);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'answer',claims:[{text:'两款产品的接口不同。',evidenceIds:['s1']}]})}}]})};
 }});
 const result=await expert.answer({message:'X100与Y200的接口差在哪？',route:{hintIntent:'parameters',models:['HD-X100']},preparedEvidence:[{evidenceId:'comparison',name:'合成对比表',sourceKind:'structured-comparison-original',readPerformed:true,modelIds:['HD-X100','HD-Y200'],text:JSON.stringify({models:[{model:'X100'},{model:'Y200'}],rows:[{parameter:'接口',values:[{value:'2口'},{value:'4口'}]}]})}]});
 assert.equal(count,1);assert.equal(result.status,'answer');
});
