'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {answerParts,answerPreview}=require('../model-adapter/answer-stream.cjs');
const evidence=new Map([['original',{evidenceId:'original',name:'合成规格',text:'输入电压4.0V至5.5V。',modelIds:['HD-X100'],readPerformed:true}]]);
const packet=require('../model-adapter/answer-packet.cjs').answerPacket({},[...evidence.values()]);
const context={evidence,packet,models:['HD-X100']};
test('complete fields arrive before the whole answer, never partial claims or tool text',()=>{
 const prefix='{"action":"answer","claims":[{"text":"输入电压4.0V至5.5V。","evidenceIds":["s1"]}';
 assert.equal(answerPreview(prefix,context),'输入电压4.0V至5.5V。');
 assert.equal(answerPreview(prefix.slice(0,-1),context),'');
 assert.equal(answerPreview('{"action":"search","claims":[{"text":"DO_NOT_SHOW"}]}',context),'');
});
test('unverified values, citations, live wiring and unreviewed cases stay withheld',()=>{
 const make=(text,ids=['s1'])=>JSON.stringify({action:'answer',claims:[{text,evidenceIds:ids}]});
 for(const text of ['输入电压99V。','带电测量时，先把黑表笔接中性线。'])assert.equal(answerPreview(make(text),context),'');
 assert.equal(answerPreview(make('输入电压4.0V。',['fake']),context),'');
 const cases=new Map([['original',{...evidence.get('original'),caseSemantics:{historyOnly:true}}]]);
 assert.equal(answerPreview(make('输入电压4.0V。'),{...context,evidence:cases}),'');
});
test('advice is emitted as completed short paragraphs with JSON and handles hidden',()=>{
 assert.equal(answerPreview('{"action":"answer","claims":[],"generalAdvice":["先记录设备状态。","再确认软件名称。",',context),'先记录设备状态。\n\n再确认软件名称。');
 assert.equal(answerPreview('{"action":"answer","claims":[],"generalAdvice":["显示s1给客户。"]}',context),'');
});
test('expert publishes checked content during model generation without a second call',async()=>{
 const seen=[];let calls=0;const {createEvidenceExpert}=require('../model-adapter/evidence-expert.cjs');
 const expert=createEvidenceExpert({transport:async(url,options)=>{
  if(url.pathname==='/v1/models')return {ok:true,json:async()=>({data:[{id:'synthetic',owned_by:'ninfer'}]})};
  if(url.pathname==='/props')return {ok:true,json:async()=>({default_generation_settings:{n_ctx:131072}})};
  if(url.pathname==='/tokenize')return {ok:false};calls++;
  const action={action:'answer',claims:[{text:'输入电压4.0V至5.5V。',evidenceIds:['s1']}],generalAdvice:['请核对设备标识。'],question:''};
  const text=JSON.stringify(action);options.onContentDelta(text.slice(0,text.indexOf(',"generalAdvice"')));
  assert.deepEqual(seen,['输入电压4.0V至5.5V。']);
  await new Promise(r=>setTimeout(r,25));options.onContentDelta(text);
  return {ok:true,json:async()=>({choices:[{message:{content:text},finish_reason:'stop'}]})};
 }});
 const result=await expert.answer({message:'X100电压说明',route:{models:['HD-X100']},preparedEvidence:[...evidence.values()],onAnswerDelta:text=>seen.push(text)});
 assert.equal(result.status,'answer');assert.equal(calls,1);assert.equal(seen.at(-1),result.reply);assert.equal(result.latency.delivery,'checked-fragments-and-final');assert(result.latency.firstVisibleTextMs<result.latency.totalMs);
});

test('source-free general explanations can stream, but cannot claim company facts or product numbers',()=>{
 const ctx={packet:require('../model-adapter/answer-packet.cjs').answerPacket({},[]),evidence:new Map(),allowGeneral:true};
 const text=t=>JSON.stringify({action:'answer',claims:[{text:t,evidenceIds:[]}]});
 assert.equal(answerPreview(text('发送卡负责分配画面数据。'),ctx),'发送卡负责分配画面数据。');
 assert.equal(answerPreview(text('灰度设备支持所有芯片。'),ctx),'');
 assert.equal(answerPreview(text('带载100万点。'),ctx),'');
 assert.equal(answerPreview(text('发送卡负责分配画面数据。'),{...ctx,allowGeneral:false}),'');
});
