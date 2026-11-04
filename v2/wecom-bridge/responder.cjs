'use strict';
const {randomUUID}=require('node:crypto');
const {render,chunks}=require('./core.cjs');
const {fileReply}=require('./documents.cjs');
function createResponder({client,core,documents,state,onError=()=>{}}){
 const pending=new Map(),seen=new Map();
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
  const stream=randomUUID();
  const waiting=client.replyStream(frame,stream,'正在查询，请稍候…',false).catch(error=>{state.notificationFailures++;problem('waiting-notice',error);});
  const previous=pending.get(key)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
   let stage='input',delivered=false;
   async function finish(text){
    const output=chunks(text);await waiting;
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
    const message=parts.join('\n').replace(/^@[^\s@]+\s*/,'').trim();
    if(!message||message.length>8000){await finish('请用文字或清晰图片描述问题，文字不超过8000字。');state.completed++;return;}
    stage='core';const data=await core.answer(key,message);
    let files=[];try{files=await documents.prepare(data.results);}catch(error){state.fileFailures++;problem('prepare-files',error);}
    stage='final-reply';await finish(files.length?fileReply(data,files,render):render(data));
    for(const file of files){
     try{const uploaded=await client.uploadMedia(file.buffer,{type:'file',filename:file.name});if(!uploaded.media_id)throw Error('upload-not-confirmed');await client.sendMediaMessage(target,'file',uploaded.media_id);state.filesSent++;}
     catch(error){state.fileFailures++;problem('send-file',error);await markdown(target,'文件发送未完成：'+file.name+'。请稍后重新查询。').catch(error=>problem('file-failure-notice',error));}
    }
    state.completed++;state.lastMode=data.bridgeMode;state.lastCompletedAt=new Date().toISOString();
   }catch(error){state.failed++;problem(stage,error);if(!delivered)await finish(stage==='core'?'问答服务暂时未能连接，本次查询未完成，请稍后重试。':'本次查询未完成，请稍后重试；图片问题也可以直接发文字。').catch(error=>problem('failure-notice',error));}
  });
  pending.set(key,work);try{await work;}finally{if(pending.get(key)===work)pending.delete(key);}
 }
 return {handle,active:()=>pending.size};
}
module.exports={createResponder};
