'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
test('historical write actions receive one review while ordinary parameter answers remain single-call',async()=>{
 for(const withCase of [true,false]){
  let calls=0;
  const expert=createEvidenceExpert({maxModelCalls:4,thinkingEnabled:false,transport:async(url,options)=>{
   if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic'}]})};
   if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
   if(url.pathname==='/tokenize')return {ok:false};
   const request=JSON.parse(options.body),input=JSON.parse(request.messages[1].content);calls++;
   if(calls===2){assert(input.caseReview);assert(input.answerDraftForReview);assert.match(JSON.stringify(input.caseReview),/维护窗口/);}
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'answer',claims:[{text:calls===1?'历史中写过参数。':'历史写参不证明当前适用；先记录显示范围及设备状态。',evidenceIds:['s1']}],generalAdvice:withCase&&calls===1?['建议先发送参数，再复位。']:[],question:''})}}]})};
  }});
  const r=await expert.answer({message:withCase?'X100花屏先查什么':'X100参数',route:{hintIntent:withCase?'aftersales':'parameters'},preparedEvidence:[{evidenceId:'case-1',name:'合成来源',text:'历史处理为发送参数，尚未复现。',readPerformed:true,...(withCase?{sourceKind:'indexed-case-record',caseSemantics:{historyOnly:true,presentSiteCompatibilityConfirmed:false,operationClasses:['configuration-write'],caseStatus:'pending'}}:{})}]});
  assert.equal(r.status,'answer');assert.equal(calls,withCase?2:1);if(withCase)assert.match(r.reply,/先记录显示范围/);
 }
});
