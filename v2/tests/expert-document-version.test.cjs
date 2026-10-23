'use strict';
// Synthetic model-protocol tests only; no real model, source documents, or HTTP.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const body='灰度等级支持256~65536级。';
const row=(id,name,overrides={})=>({evidenceId:id,name,text:body,readPerformed:true,readAvailable:false,nextOffset:null,sourceKind:'public-original',verificationStatus:'public-original-hash-verified',knowledgeUnit:{complete:true},...overrides});
async function ask(text,rows,{ids=rows.map(r=>r.evidenceId),excerpt=body,maxAnswerRepairs=0,actions}={}){
 const claim={text,evidenceIds:ids,sourceExcerpt:excerpt};let index=0;
 const expert=createEvidenceExpert({maxAnswerRepairs,transport:async(url)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic-revision-protocol'}]})};
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  assert.equal(url.pathname,'/v1/chat/completions');
  const action=actions?actions[Math.min(index++,actions.length-1)]:{action:'answer',claims:[claim],generalAdvice:[],question:''};
  return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(action)},finish_reason:'stop'}]})};
 }});
 return expert.answer({message:'请核对示例参数及文档版本',route:{intent:'presales',models:[]},responsePlan:{purpose:'parameters',evidencePacket:{version:1,question:{text:'请核对示例参数及文档版本'},evidence:rows,outcome:'answerable',gaps:[]}},execute:async()=>{throw Error('No lookup in prepared packet tests');}});
}
test('Two cited specification revisions support version metadata while parameters remain sourced from the excerpt',async()=>{
 const rows=[row('first','示例规格书 V2.3.pdf'),row('second','示例规格书 V4.5_已签章.pdf')];
 const r=await ask('灰度等级支持256~65536级，该参数在V2.3、V4.5及已签章版规格书中一致记载。',rows);
 assert.equal(r.status,'answer',r.error);assert.equal(r.modelCallCount,1);assert.equal(r.toolCallCount,0);
 assert.match(r.reply,/V2\.3、V4\.5/);
});
test('A strictly typed referenced versions array can identify a document revision absent from its filename',async()=>{
 const r=await ask('说明书版本V2.3记载灰度等级支持256~65536级。',[row('first','示例说明书.pdf',{versions:['V2.3']})]);
 assert.equal(r.status,'answer');
});
test('Unknown and uncited source versions remain rejected, even if another prepared row has that revision',async()=>{
 const rows=[row('first','示例规格书 V2.3.pdf'),row('second','其他规格书 V9.8.pdf')];
 const unknown=await ask('V7.6版规格书记载灰度等级支持256~65536级。',rows);
 assert.equal(unknown.status,'unavailable');assert.equal(unknown.error,'expert-unsupported-document-version');
 const uncited=await ask('V9.8版规格书记载灰度等级支持256~65536级。',rows,{ids:['first']});
 assert.equal(uncited.error,'expert-unsupported-document-version');
});
test('Matching revision digits cannot become product values or borrow unrelated numeric filename fields',async()=>{
 const rows=[row('first','示例规格书 V2.3_20口_2027年.pdf')];
 const sameNumber=await ask('规格书V2.3记载设备刷新率为2.3Hz。',rows);
 assert.equal(sameNumber.claims[0].sourceOnly,true);assert.equal(sameNumber.claims[0].text,'原文记载：'+body);assert.doesNotMatch(sameNumber.claims[0].text,/2\.3Hz/);
 const filenameNumber=await ask('规格书V2.3记载设备有20个接口。',rows);
 assert.equal(filenameNumber.claims[0].sourceOnly,true);assert.equal(filenameNumber.claims[0].text,'原文记载：'+body);assert.doesNotMatch(filenameNumber.claims[0].text,/20个接口/);
 const year=await ask('设备带载为2027点。',rows);
 assert.equal(year.claims[0].sourceOnly,true);assert.equal(year.claims[0].text,'原文记载：'+body);assert.doesNotMatch(year.claims[0].text,/2027点/);
});
test('A prefixed numeric product value cannot disguise itself as a document revision',async()=>{
 const r=await ask('规格书中设备电压为V2.3。',[row('first','示例规格书 V2.3.pdf')]);
 assert.equal(r.claims[0].sourceOnly,true);assert.equal(r.claims[0].text,'原文记载：'+body);assert.doesNotMatch(r.claims[0].text,/电压|V2\.3/);
});
test('Revision tokens match exactly and never accept a prefix of an unknown revision',async()=>{
 for(const version of ['V2.30','V2.3.1']){
  const r=await ask(version+'版规格书记载灰度等级支持256~65536级。',[row('first','示例规格书 V2.3.pdf')]);
  assert.equal(r.error,'expert-unsupported-document-version');
 }
});
test('No document-version inference comes from anonymous text or arbitrary versions objects',async()=>{
 const rows=[row('first','示例规格书.pdf',{versions:[{version:'V2.3'},'unknown V2.3 string']})];
 assert.equal((await ask('V2.3版规格书记载灰度等级支持256~65536级。',rows)).error,'expert-unsupported-document-version');
});
test('An unsupported document revision may be removed by one bounded answer repair without querying again',async()=>{
 const output=text=>({action:'answer',claims:[{text,evidenceIds:['first'],sourceExcerpt:body}],generalAdvice:[],question:''});
 const r=await ask('',[row('first','示例规格书 V2.3.pdf')],{maxAnswerRepairs:1,actions:[output('V9.8版规格书记载灰度等级支持256~65536级。'),output('灰度等级支持256~65536级。')]});
 assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.equal(r.toolCallCount,0);
 assert.equal(r.modelCalls[0].validationFailure,'expert-unsupported-document-version');
});
