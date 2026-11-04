'use strict';
const {randomUUID}=require('node:crypto');
const {render,chunks}=require('./core.cjs');
const {createPresentation}=require('./presentation.cjs');
const {orderingLabel}=require('./ordering-label.cjs');
function createResponder({client,core,documents,presentation=createPresentation({core,documents}),state,onError=()=>{},onRecord=()=>{}}){
 const pending=new Map(),seen=new Map(),choices=new Map(),lastResults=new Map();
 function problem(stage,error){
  const text=String(error?.message||error),code=error?.code||(/ack timeout/i.test(text)?'wecom-ack-timeout':/not connected/i.test(text)?'wecom-disconnected':/fetch failed/i.test(text)?'core-transport':'operation-failed');
  state.lastError={stage,code,at:new Date().toISOString()};onError(stage,error);
 }
 const markdown=(target,text)=>client.sendMessage(target,{msgtype:'markdown',markdown:{content:text}});
 async function handle(frame){
  const b=frame.body||{},target=b.chattype==='single'?b.from?.userid:b.chatid;
  if(!b.from?.userid||!target)return;
  const key=b.chattype==='single'?'u:'+b.from.userid:'g:'+b.chatid+':u:'+b.from.userid,id=b.msgid||frame.headers?.req_id;
  if(id&&seen.has(id))return;if(id)seen.set(id,Date.now());
  for(const [k,t]of seen)if(Date.now()-t>3600000)seen.delete(k);
  state.received++;state.lastInboundAt=new Date().toISOString();
  const record=(type,detail={})=>{try{onRecord({type,at:new Date().toISOString(),messageId:id,chatKey:key,...detail});}catch(error){state.auditFailures=(state.auditFailures||0)+1;problem('audit',error);}};
  record('received',{frame});
  const stream=randomUUID();
  const waiting=client.replyStream(frame,stream,'正在查询，请稍候…',false).catch(error=>{state.notificationFailures++;problem('waiting-notice',error);});
  const previous=pending.get(key)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
   let stage='input',delivered=false;
   let streamTail=waiting,lastStreamAt=0,closed=false;
   const update=text=>{if(closed||Date.now()-lastStreamAt<2500||typeof text!=='string'||!text)return;lastStreamAt=Date.now();const preview=chunks(render({reply:text}),17500)[0];streamTail=streamTail.then(()=>client.replyStream(frame,stream,preview,false)).catch(error=>{state.notificationFailures++;problem('progress-stream',error);});};
   async function finish(text){
    closed=true;const output=chunks(text);await streamTail;
    try{await client.replyStream(frame,stream,output[0],true);}
    catch(error){problem('final-stream',error);for(const piece of chunks(output[0],3000))await markdown(target,piece);}
    for(const part of output.slice(1))for(const piece of chunks(part,3000))await markdown(target,piece);
    delivered=true;
   }
   try{
    const parts=[];if(b.msgtype==='text')parts.push(b.text?.content||'');
    const items=b.msgtype==='mixed'?b.mixed?.msg_item||[]:b.msgtype==='image'?[{msgtype:'image',image:b.image}]:[];
    for(const item of items){
     if(item.msgtype==='text')parts.push(item.text?.content||'');
     if(item.msgtype==='image'){stage='image';const file=await client.downloadFile(item.image.url,item.image.aeskey);const ocr=await core.request('/api/ocr',{imageBase64:file.buffer.toString('base64')});if(!ocr.data.ok||!ocr.data.text)throw Error('image-unreadable');parts.push(ocr.data.text);}
    }
    let message=parts.join('\n').replace(/^@[^\s@]+\s*/,'').trim();
    if(!message||message.length>8000){await finish('请用文字或清晰图片描述问题，文字不超过8000字。');state.completed++;return;}
    const selection=/^(?:选择|回复)?\s*(\d{1,2})[、.)）]?$/.exec(message),saved=choices.get(key);
    if(selection&&saved&&saved.expires>Date.now()&&saved.rows[Number(selection[1])-1])message=saved.rows[Number(selection[1])-1].message;
    stage='core';let data;
    const previousResult=lastResults.get(key),batch=message==='全部方案';
    if(batch&&!(previousResult?.result?.options?.length)){await finish('当前会话没有可逐项交付的配单方案，请先提出配单需求。');state.completed++;return;}
    if(message==='重发附件'&&lastResults.has(key))data=lastResults.get(key);
    else if(batch)data=previousResult;
    else data=await core.answer(key,message,{onText:update,onProgress:summary=>{const steps=(summary?.steps||[]).filter(s=>s.label&&s.detail).slice(-2);if(steps.length)update(steps.map(s=>s.label+'：'+s.detail).join('\n'));}});
    async function deliverData(data,batchMode=false){
    record('core-result',{data});lastResults.set(key,data);
    stage='presentation';const plan=presentation.plan(data);choices.set(key,{rows:plan.choices||[],expires:Date.now()+900000});
    const receipt={planned:plan.items.length,sent:0,failed:0,notices:0,handled:plan.handled};record('planned',{items:plan.items.map(i=>({id:i.id,type:i.type,name:i.name})),handled:plan.handled});
    stage='final-reply';const body=plan.text+(plan.notices?.length?'\n\n'+plan.notices.join('\n'):'');if(batchMode){for(const piece of chunks(body,3000))await markdown(target,piece);}else await finish(body);
    for(const item of plan.items){
     try{
      const output=await presentation.resolve(item);
      if(output.type==='notice'){await markdown(target,output.text);receipt.notices++;record('item',{itemId:item.id,name:item.name,status:'notice'});continue;}
      if(!Buffer.isBuffer(output.buffer)||!output.buffer.length||output.buffer.length>20*1024*1024)throw Error('invalid-media-bytes');
      const type=['image','video'].includes(output.type)?output.type:'file';
      if(output.brand||output.language)await markdown(target,[output.brand,output.language,output.name].filter(Boolean).join(' · '));
      const uploaded=await client.uploadMedia(output.buffer,{type,filename:output.name});if(!uploaded.media_id)throw Error('upload-not-confirmed');
      await client.sendMediaMessage(target,type,uploaded.media_id);receipt.sent++;state[type==='image'?'imagesSent':type==='video'?'videosSent':'filesSent']=(state[type==='image'?'imagesSent':type==='video'?'videosSent':'filesSent']||0)+1;
      record('item',{itemId:item.id,name:output.name,mediaType:type,status:'sent',bytes:output.buffer.length});
     }catch(error){receipt.failed++;state.fileFailures++;problem('deliver-'+item.type,error);record('item',{itemId:item.id,name:item.name,status:'failed',code:state.lastError.code});await markdown(target,item.name+' 未发送成功；其他内容继续发送。可回复“重发附件”重试。').catch(error=>problem('item-failure-notice',error));}
    }
    state.lastDelivery=receipt;if(receipt.failed)state.partial=(state.partial||0)+1;else state.completed++;
    record('completed',{status:receipt.failed?'partial':'complete',receipt});state.lastMode=data.bridgeMode;state.lastCompletedAt=new Date().toISOString();
    }
    if(!batch)await deliverData(data);
    else{
     const ids=data.result.options.map(o=>o.id).filter(id=>Number.isSafeInteger(id)&&id>0);
     if(ids.length>20)throw Error('too-many-ordering-options');
     const originalId=orderingLabel(data.result)?.id;
     await finish('开始按方案依次发送，共'+ids.length+'个。每个方案的正文和附件均带方案标识。');
     let switched=false;
     let batchFinished=false;
     try{for(const optionId of ids){stage='select-batch-option';const selected=await core.answer(key,'配单方案：'+optionId);if(selected.result?.selectedOptionId!==optionId||!selected.result?.plan&&!selected.result?.nativeOrdering)throw Error('ordering-option-not-confirmed');switched=true;await deliverData(selected,true);}batchFinished=true;}
     catch(error){await markdown(target,'全部方案交付中断，尚未发送的方案不会冒用其他方案数据，请重新选择需要的方案。');throw error;}
     finally{
      if(switched&&originalId){try{const restored=await core.answer(key,'配单方案：'+originalId);if(restored.result?.selectedOptionId!==originalId)throw Error('restore-not-confirmed');lastResults.set(key,restored);const p=presentation.plan(restored);choices.set(key,{rows:p.choices||[],expires:Date.now()+900000});await markdown(target,(batchFinished?'全部方案交付结束':'批量交付已中断')+'，当前选择恢复为方案'+originalId+'。');}catch(error){problem('restore-option',error);await markdown(target,'批量交付后未能恢复原方案，请回复方案序号重新选择。');}}
     }
    }
   }catch(error){state.failed++;problem(stage,error);record('failed',{stage,code:state.lastError.code});if(!delivered)await finish(stage==='core'?'问答服务暂时未能连接，本次查询未完成，请稍后重试。':'本次查询未完成，请稍后重试；图片问题也可以直接发文字。').catch(error=>problem('failure-notice',error));}
  });
  pending.set(key,work);try{await work;}finally{if(pending.get(key)===work)pending.delete(key);}
 }
 return {handle,active:()=>pending.size};
}
module.exports={createResponder};
