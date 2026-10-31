'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {describeExpertSources}=require('../domain/knowledge/expert-source-contract.cjs');
test('source ownership describes unconfirmed subjects without deleting or rewriting evidence',()=>{
 const evidence=[{name:'服务器手册.pdf',modelIds:['HD-X200'],text:'输出参数原文'},{name:'通用说明.pdf',text:'通用操作原文'}],before=structuredClone(evidence);
 const missing=describeExpertSources({},evidence);assert.deepEqual(missing.customerModelMentions,[]);assert.equal(missing.sourceSubjects[0].relation,'no-customer-model');
 const other=describeExpertSources({models:['HD-X100']},evidence);assert.equal(other.sourceSubjects[0].relation,'different-declared-models');assert.deepEqual(other.sourceSubjects[0].matchedCustomerModels,[]);assert.deepEqual(evidence,before);
 const same=describeExpertSources({contextModels:['X200']},evidence);assert.equal(same.sourceSubjects[0].relation,'overlap');assert.equal(same.sourceSubjects[1].relation,'source-model-unspecified');
});
test('every tool round refreshes ownership while leaving cross-model evidence available to the expert',async()=>{
 const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');let rounds=0;
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
  const input=JSON.parse(JSON.parse(options.body).messages[1].content);rounds++;
  if(rounds===1)assert.equal(input.sourceContract.sourceSubjects.length,0);
  else {assert.equal(input.sourceContract.sourceSubjects[0].relation,'different-declared-models');assert.equal(input.preparedEvidence.evidence[0].name,'X200手册.pdf');}
  const action=rounds===1?{action:'search',query:'对照产品资料',kind:'text',concepts:['资料'],goals:['查对照资料']}:{action:'answer',claims:[{text:'这是对照型号X200的原文，不代表客户的X100。',evidenceIds:['s1']}],generalAdvice:[],question:''};
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(action)}}]})};
 }});
 const result=await expert.answer({message:'X100与其他型号对照',route:{models:['HD-X100']},execute:async()=>({evidence:[{evidenceId:'reference',name:'X200手册.pdf',modelIds:['HD-X200'],text:'对照资料',readPerformed:true}]})});
 assert.equal(result.status,'answer');assert.equal(result.evidence[0].name,'X200手册.pdf');assert.equal(rounds,2);
});
