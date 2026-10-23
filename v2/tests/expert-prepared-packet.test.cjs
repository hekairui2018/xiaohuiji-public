'use strict';
// Synthetic protocol transports only. These tests make no model or HTTP calls
// and do not measure answer accuracy on customer questions.
const test=require('node:test'),assert=require('node:assert/strict');
const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
const row=(overrides={})=>({evidenceId:'prepared-original',name:'示例设备说明书.pdf',sha256:'a'.repeat(64),text:'设备支持有线连接。仅适用于当前版本。',locator:{page:4},scope:{mentionedModels:['HD-X1']},modelIds:['HD-X1'],sourceKind:'role-index-original',verificationStatus:'public-original-hash-verified',readPerformed:true,readAvailable:false,nextOffset:null,role:'operation',knowledgeUnit:{complete:true},...overrides});
const packet=(overrides={})=>({version:1,question:{text:'怎样连接设备',intent:'operation',models:['HD-X1'],software:null,confirmed:{},assumptions:{},missing:[]},evidence:[row()],outcome:'answerable',gaps:[],...overrides});
const answer=(overrides={})=>({action:'answer',claims:[{text:'可以使用有线方式连接设备；请核对版本适用范围。',evidenceIds:['prepared-original'],sourceExcerpt:'设备支持有线连接。仅适用于当前版本。'}],generalAdvice:[],question:'',...overrides});
function fixture(actions,options={}){
 const requests=[],events=[];let position=0,toolCalls=0;
 const expert=createEvidenceExpert({autoReadCandidates:3,...options,onDiagnostic:event=>events.push(event),transport:async(url,request)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic-packet-protocol'}]})};
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false,json:async()=>({})};
  assert.equal(url.pathname,'/v1/chat/completions');
  requests.push(JSON.parse(request.body));
  const output=actions[Math.min(position++,actions.length-1)];
  return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(output)},finish_reason:'stop'}]})};
 }});
 return {requests,events,get toolCalls(){return toolCalls;},run:async(prepared,plan={})=>expert.answer({message:'怎样连接设备',route:{intent:'software',models:['HD-X1']},responsePlan:{purpose:'operation',search:{query:'不得重新检索',kind:'text',concepts:['连接']},...plan,evidencePacket:prepared},execute:async()=>{toolCalls++;throw Error('Prepared evidence must not be replaced by another search or read');}})};
}
test('Prepared original is sent once, cited, and never replaced by search or auto-read',async()=>{
 const f=fixture([answer()]),p=packet();const r=await f.run(p);
 assert.equal(r.status,'answer');assert.equal(f.toolCalls,0);assert.equal(r.modelCallCount,1);assert.equal(r.toolCallCount,0);
 const input=JSON.parse(f.requests[0].messages[1].content);
 assert.deepEqual(input.preparedEvidence.evidence,p.evidence);assert.deepEqual(input.question,p.question);
 assert.equal(JSON.stringify(f.requests[0].messages).split(p.evidence[0].text).length-1,1);
 assert.equal(r.claims[0].evidenceIds[0],'prepared-original');assert.match(r.reply,/示例设备说明书/);
 const event=f.events.find(e=>e.event==='prepared-evidence-packet');assert.equal(event.outcome,'answerable');assert.equal(event.supplementalSearchEnabled,false);
 assert.deepEqual(p,packet(),'Consumer must not mutate the backend packet');
});
test('Prepared long passages keep late prerequisites without silently slicing at 6000 characters',async()=>{
 const text='正文说明。'.repeat(1400)+'操作前先保存参数，更新期间保持供电。';
 const f=fixture([answer({claims:[{text:'操作之前请保存参数，期间保持供电。',evidenceIds:['prepared-original'],sourceExcerpt:'操作前先保存参数，更新期间保持供电。'}]})]);
 const r=await f.run(packet({evidence:[row({text})]}));assert.equal(r.status,'answer');
 const input=JSON.parse(f.requests[0].messages[1].content);assert.equal(input.preparedEvidence.evidence[0].text,text);assert.match(JSON.stringify(f.requests[0].messages),/更新期间保持供电/);
});
test('An explicitly abridged citation supports only literal ordered fragments from the same original',async()=>{
 const text='板载12个接口，相当于自带接收卡。这里是无关说明。单独带载20万像素。';
 const claim={text:'板载12个接口，相当于自带接收卡，单独带载20万像素。',evidenceIds:['prepared-original'],sourceExcerpt:'板载12个接口，相当于自带接收卡；... 单独带载20万像素。'};
 const f=fixture([answer({claims:[claim]})],{maxAnswerRepairs:0});
 const r=await f.run(packet({evidence:[row({text})]}));assert.equal(r.status,'answer',r.error);assert.equal(r.modelCallCount,1);
 const forged=fixture([answer({claims:[{...claim,sourceExcerpt:'板载14个接口...单独带载20万像素。'}]})],{maxAnswerRepairs:0});
 assert.equal((await forged.run(packet({evidence:[row({text})]}))).status,'unavailable');
});
test('A numeric embellishment is replaced by the verified literal parameter, not published as a supported claim',async()=>{
 const text='输入网口：千兆通讯接口。输出网口：2路RJ45，用于级联显示。';
 const f=fixture([answer({claims:[{text:'设备有1路输入和2路输出网口。',evidenceIds:['prepared-original'],sourceExcerpt:text}]})],{maxAnswerRepairs:0});
 const r=await f.run(packet({evidence:[row({text})]}),{purpose:'parameters'});
 assert.equal(r.status,'answer',r.error);assert.match(r.reply,/2路RJ45/);assert.doesNotMatch(r.reply,/1路输入/);assert.equal(r.claims[0].sourceOnly,true);assert.equal(r.evidenceOutcome,'partial');
});
test('A verified answer survives an unrelated unsupported addition, with the omitted part explicitly unconfirmed',async()=>{
 const f=fixture([answer({claims:[answer().claims[0],{text:'还能兼容其他厂商。',evidenceIds:['prepared-original'],sourceExcerpt:'原文中不存在的兼容信息'}]})]);
 const r=await f.run(packet());assert.equal(r.status,'answer');assert.equal(r.claims.length,1);assert.equal(r.evidenceOutcome,'partial');assert.match(r.reply,/其余部分还需核对/);assert.doesNotMatch(r.reply,/兼容其他厂商/);
});
test('Rendered citations use the exact block page supporting each quotation',async()=>{
 const first='章节概述。',last='设备支持有线连接。仅适用于当前版本。';
 const f=fixture([answer()]);const r=await f.run(packet({evidence:[row({text:first+'\n'+last,contextParts:[{charStart:10,charEnd:10+first.length,locator:{page:1}},{charStart:30,charEnd:30+last.length,locator:{page:8}}]})]}));
 assert.equal(r.status,'answer');assert.match(r.reply,/页 8/);assert.equal(r.results[0].locator.page,8);
});
test('A procedure can retain five necessary steps rather than being forced into three claims',async()=>{
 const text=['打开软件','选择设备','保存参数','发送节目','检查播放结果'].join('。');
 const claims=text.split('。').map(step=>({text:step,evidenceIds:['prepared-original'],sourceExcerpt:step}));
 const f=fixture([answer({claims})]);const r=await f.run(packet({evidence:[row({text})]}));
 assert.equal(r.status,'answer');assert.equal(r.claims.length,5);
 const choices=f.requests[0].response_format.schema.oneOf;assert.equal(choices.find(s=>s.properties.action.const==='answer').properties.claims.maxItems,8);
});
test('Metadata remains file identity and cannot be cited as product正文 even when marked read',async()=>{
 const f=fixture([answer()],{maxAnswerRepairs:0});const r=await f.run(packet({evidence:[row({sourceKind:'file-metadata',text:'HD-X1有线连接说明书.pdf',readPerformed:true})]}));
 assert.equal(r.status,'unavailable');assert.equal(r.error,'expert-metadata-not-body');assert.equal(r.results.length,0);
 const choices=f.requests[0].response_format.schema.oneOf;assert.equal(choices.find(s=>s.properties.action.const==='answer').properties.claims.maxItems,0);
});
test('Partial source is explicitly labelled and no model-directed gap search is permitted in this first version',async()=>{
 const f=fixture([answer()]);const r=await f.run(packet({outcome:'partial',gaps:['尚未核对连接后的成功标志'],evidence:[row({knowledgeUnit:{complete:false}})]}));
 assert.equal(r.status,'answer');assert.equal(r.evidenceOutcome,'partial');assert.equal(r.supplementalSearchEnabled,false);assert.equal(f.toolCalls,0);
 assert.match(r.reply,/部分内容/);assert.match(r.reply,/尚未核对连接后的成功标志/);
 const choices=f.requests[0].response_format.schema.oneOf;assert.ok(choices.every(s=>!['search','read','calculate'].includes(s.properties.action.const)));
});
test('A fully read page cannot be represented as a complete procedure when its native unit is incomplete',async()=>{
 const f=fixture([answer({claims:[{text:'完整操作流程：设备支持有线连接。',evidenceIds:['prepared-original'],sourceExcerpt:'设备支持有线连接。'}]})],{maxAnswerRepairs:0});
 const r=await f.run(packet({outcome:'partial',evidence:[row({knowledgeUnit:{complete:false}})],gaps:['后续操作缺失']}));
 assert.equal(r.error,'expert-incomplete-procedure');assert.equal(r.status,'unavailable');
});
test('Cited paraphrases require a real source excerpt and preserve the numeric guard',async()=>{
 const badExcerpt=fixture([answer({claims:[{text:'支持有线连接。',evidenceIds:['prepared-original'],sourceExcerpt:'完全不存在的操作说明'}]})],{maxAnswerRepairs:0});
 assert.equal((await badExcerpt.run(packet())).error,'expert-unsupported-source-excerpt');
 const badNumber=fixture([answer({claims:[{text:'支持20个设备。',evidenceIds:['prepared-original'],sourceExcerpt:'设备支持有线连接。'}]})],{maxAnswerRepairs:0});
 assert.equal((await badNumber.run(packet())).error,'expert-unsupported-number');
 const borrowed=fixture([answer({claims:[{text:'有线连接支持20台设备。',evidenceIds:['prepared-original'],sourceExcerpt:'设备支持有线连接。'}]})],{maxAnswerRepairs:0});
 assert.equal((await borrowed.run(packet({evidence:[row({text:'设备支持有线连接。\n仅另一种产品支持20台设备。'})]}))).error,'expert-unsupported-number');
});
test('An excerpt failure may repair the answer using the existing packet, without a second lookup',async()=>{
 const f=fixture([answer({claims:[{text:'支持有线连接。',evidenceIds:['prepared-original'],sourceExcerpt:'错误摘录'}]}),answer()]);
 const r=await f.run(packet());assert.equal(r.status,'answer');assert.equal(r.modelCallCount,2);assert.equal(f.toolCalls,0);
 assert.equal(r.modelCalls[0].validationFailure,'expert-unsupported-source-excerpt');
});
test('Absence, unparsed content, retrieval failure, and a retrieval miss have distinct truthful notices',async()=>{
 for(const [outcome,pattern]of [['no-record',/已核对的资料范围/],['unparsed',/尚未完成解析/],['search-failed',/资料查询未完成/],['not-retrieved',/尚未取得足以回答的证据/]]){
  const f=fixture([answer({claims:[],question:'请提供完整设备型号。'})]);const r=await f.run(packet({outcome,evidence:[],gaps:[]}));
  assert.equal(r.status,'clarify');assert.equal(r.evidenceOutcome,outcome);assert.match(r.reply,pattern);
  if(outcome!=='no-record')assert.match(r.reply,/不能/);
 }
});
test('Unread prepared candidates and unsupported citations cannot become factual answers',async()=>{
 const unread=fixture([answer()],{maxAnswerRepairs:0});const r=await unread.run(packet({evidence:[row({readPerformed:false,readAvailable:false})]}));assert.equal(r.error,'expert-unread-evidence');
 const guessed=fixture([answer({claims:[{text:'有线连接。',evidenceIds:['guessed-original'],sourceExcerpt:'设备支持有线连接。'}]})],{maxAnswerRepairs:0});assert.equal((await guessed.run(packet())).error,'expert-invalid-citation');
});
test('Unknown model identity stays offline even with prepared evidence; the consumer cannot fake a model answer',async()=>{
 const expert=createEvidenceExpert({transport:async()=>{throw Error('synthetic model offline');}});
 const r=await expert.answer({message:'怎样连接设备',route:{intent:'software'},responsePlan:{evidencePacket:packet()},execute:async()=>{throw Error('must not call');}});
 assert.equal(r.status,'unavailable');assert.equal(r.error,'expert-model-offline');assert.equal(r.modelCallCount,0);
});
