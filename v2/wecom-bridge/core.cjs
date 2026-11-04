'use strict';
const {createHash,randomUUID}=require('node:crypto');
const sessionId=key=>'wecom-'+createHash('sha256').update(key).digest('hex').slice(0,48);
function createCore({baseUrl='http://127.0.0.1:8520',fetchImpl=fetch,timeoutMs=240000}={}){
 const base=new URL(baseUrl);if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw Error('loopback-core-required');
 async function request(route,body,timeout=timeoutMs){
  const r=await fetchImpl(new URL(route,base),{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeout)});
  const data=await r.json();return {ok:r.ok,code:r.status,data};
 }
 async function answer(key,message){
  let available=false;try{available=(await request('/v2/offline/capabilities',null,10000)).data.expert?.available===true;}catch{}
  const input={message,sessionId:sessionId(key),source:'wecom',requestId:randomUUID()};
  let result,reason=null;
  if(available){
   try{result=await request('/api/ai/chat',{...input,mode:'expert'});}catch{reason='expert-transport';}
   if(result?.ok&&!['unavailable','busy','error'].includes(result.data.status)&&!result.data.error)return {...result.data,bridgeMode:'expert'};
   if(result?.code===400)return result.data;
   reason||=result?.data.error||'expert-unavailable';
   // Drain a timed out model request before retrying this same conversation.
   if(!result){const drained=await request('/v2/offline/session/interrupt',{sessionId:input.sessionId},10000);if(!drained.ok)throw Error('core-not-ready');}
  }
  if(message.length>240)return {reply:'专家模式暂不可用，已切换快速模式。请把问题缩短到240字以内，我继续帮你查询。',bridgeMode:'quick',fallbackReason:reason||'expert-off'};
  result=await request('/api/ai/chat',{...input,requestId:randomUUID(),mode:'quick'});
  if(!result.ok)throw Error('quick-core-'+result.code);
  return {...result.data,bridgeMode:'quick',fallbackReason:reason||'expert-off'};
 }
 return {answer,request};
}
// Never turn a private/loopback file handle into a public download capability.
function render(data){
 let text=String(data.reply||data.clarifyQuestion||'本次未完成，请稍后再试。');
 text=text.replace(/\[([^\]]+)\]\((?:\/(?:v2|api)\/|https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.)|file:)[^)]+\)/gi,'$1');
 text=text.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.)[^\s）)<>]*/gi,'[请在内部网页查看]');
 text=text.replace(/(?:[A-Z]:[\\/])[^\s<>"|]+/gi,'[内部位置]');
 const names=[...new Set((data.results||[]).map(r=>r.name).filter(Boolean))];
 if(names.length)text+='\n\n相关资料：\n'+names.slice(0,12).map(n=>'• '+n).join('\n');
 if(data.bridgeMode==='quick')text='专家模式暂不可用，本次使用快速模式。\n\n'+text;
 return text;
}
function chunks(text,limit=18000){const out=[];let part='',size=0;for(const char of text){const n=Buffer.byteLength(char);if(size+n>limit){out.push(part);part='';size=0;}part+=char;size+=n;}if(part)out.push(part);return out;}
module.exports={createCore,sessionId,render,chunks};
