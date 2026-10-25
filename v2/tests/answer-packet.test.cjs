'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
test('Only short source handles are generated; answer does not repeat a question or source filenames',async()=>{
 const long='rag-'+'a'.repeat(64);let generations=0;
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'qwen3.8-synthetic'}]})};
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false};
  generations++;const body=JSON.parse(options.body),answer=body.response_format.json_schema.schema.oneOf[0],input=JSON.parse(body.messages[1].content);
  assert.equal(JSON.stringify(body).includes(long),false);
  assert.equal(input.preparedEvidence.evidence[0].evidenceId,'s1');
  assert.equal(input.preparedEvidence.evidence[0].sha256,undefined);
  assert.equal(answer.properties.question,undefined);assert.equal(answer.properties.generalAdvice,undefined);
  assert.deepEqual(answer.properties.claims.items.properties.evidenceIds.items.enum,['s1']);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'answer',claims:[{text:'支持256级灰度。',evidenceIds:['s1','s1']}],question:'重复答案不应显示'})}}]})};
 }});
 const r=await expert.answer({message:'X1灰度',route:{intent:'technical',hintIntent:'parameters',models:['HD-X1']},preparedEvidence:[{evidenceId:long,text:'支持256级灰度。',name:'合成规格书.pdf',modelIds:['HD-X1'],sha256:'b'.repeat(64),readPerformed:true,readAvailable:false}]});
 assert.equal(generations,1);assert.equal(r.status,'answer');assert.equal(r.reply,'支持256级灰度。');assert.equal(r.question,'');
 assert.deepEqual(r.claims[0].evidenceIds,[long]);assert.equal(r.results[0].name,'合成规格书.pdf');
});
