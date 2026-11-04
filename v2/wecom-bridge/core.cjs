'use strict';
const {createHash,randomUUID}=require('node:crypto');
const sessionId=key=>'wecom-'+createHash('sha256').update(key).digest('hex').slice(0,48);
function createCore({baseUrl='http://127.0.0.1:8520',fetchImpl=fetch,timeoutMs=240000,retryDelayMs=1000}={}){
 const base=new URL(baseUrl);if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw Error('loopback-core-required');
 async function request(route,body,timeout=timeoutMs,events={}){
  const started=Date.now();let r;
  for(let attempt=0;;attempt++){
   try{r=await fetchImpl(new URL(route,base),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(events.onText||events.onProgress?{Accept:'application/x-ndjson'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(Math.max(1,timeout-(Date.now()-started)))});break;}
   catch(error){
    // Connection refusal proves the request was never accepted. Retry only
    // this case across a short service restart; never replay an ambiguous POST.
    if(error?.cause?.code!=='ECONNREFUSED'||attempt>=45||Date.now()-started>=Math.min(45000,timeout))throw error;
    await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
   }
  }
  if(r.headers?.get('content-type')?.includes('application/x-ndjson')){
   let pending='',final;const decoder=new TextDecoder();
   const line=s=>{if(!s.trim())return;const e=JSON.parse(s);if(e.type==='text')events.onText?.(e.text);if(e.type==='progress')events.onProgress?.(e.summary);if(e.type==='final')final=e;};
   for await(const chunk of r.body){pending+=decoder.decode(chunk,{stream:true});if(pending.length>16*1024*1024)throw Error('core-response-too-large');let n;while((n=pending.indexOf('\n'))>=0){line(pending.slice(0,n));pending=pending.slice(n+1);}}
   pending+=decoder.decode();if(pending.trim())line(pending);if(!final)throw Error('core-stream-incomplete');return {ok:final.code>=200&&final.code<300,code:final.code,data:final.data};
  }
  const data=await r.json();return {ok:r.ok,code:r.status,data};
 }
 async function answer(key,message,events={}){
  let available=false;try{available=(await request('/v2/offline/capabilities',null,10000)).data.expert?.available===true;}catch{}
  const input={message,sessionId:sessionId(key),source:'wecom',requestId:randomUUID()};
  let result,reason=null;
  if(available){
   try{result=await request('/api/ai/chat',{...input,mode:'expert'},timeoutMs,events);}catch{reason='expert-transport';}
   if(result?.ok&&!['unavailable','busy','error'].includes(result.data.status)&&!result.data.error)return {...result.data,bridgeMode:'expert'};
   if(result?.code===400)return result.data;
   reason||=result?.data.error||'expert-unavailable';
   // Drain a timed out model request before retrying this same conversation.
   if(!result){const drained=await request('/v2/offline/session/interrupt',{sessionId:input.sessionId},10000);if(!drained.ok)throw Error('core-not-ready');}
  }
  if(message.length>240)return {reply:'专家模式暂不可用，已切换快速模式。请把问题缩短到240字以内，我继续帮你查询。',bridgeMode:'quick',fallbackReason:reason||'expert-off'};
  result=await request('/api/ai/chat',{...input,requestId:randomUUID(),mode:'quick'},timeoutMs,events);
  if(!result.ok)throw Error('quick-core-'+result.code);
  return {...result.data,bridgeMode:'quick',fallbackReason:reason||'expert-off'};
 }
 async function binary(route,demand){
  if(!['/v2/ordering/ssm','/v2/ordering/package','/v2/ordering/bom'].includes(route))throw Error('unapproved-export-route');
  const r=await fetchImpl(new URL(route,base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(demand),signal:AbortSignal.timeout(45000)});
  if(!r.ok){let detail;try{detail=await r.json();}catch{}throw Error('export-rejected-'+r.status+': '+(detail?.reason||detail?.message||detail?.error||'current-result-not-exportable'));}
  const parts=[];let size=0;for await(const part of r.body){size+=part.length;if(size>20*1024*1024)throw Error('export-too-large');parts.push(Buffer.from(part));}return Buffer.concat(parts);
 }
 return {answer,request,binary};
}
// Never turn a private/loopback file handle into a public download capability.
function render(data){
 let text=String(data.reply||data.clarifyQuestion||'本次未完成，请稍后再试。');
 text=text.replace(/\[([^\]]+)\]\((?:\/(?:v2|api)\/|https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.)|file:)[^)]+\)/gi,'$1');
 text=text.replace(/https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.)[^\s）)<>]*/gi,'[请在内部网页查看]');
 text=text.replace(/(?:[A-Z]:[\\/])[^\s<>"|]+/gi,'[内部位置]');
 const names=[...new Set((data.results||[]).map(r=>r.name).filter(n=>n&&!text.includes(n)))];
 if(names.length)text+='\n\n相关资料：\n'+names.slice(0,12).map(n=>'• '+n).join('\n');
 if(data.bridgeMode==='quick')text='专家模式暂不可用，本次使用快速模式。\n\n'+text;
 return text;
}
function chunks(text,limit=18000){const out=[];let part='',size=0;for(const char of text){const n=Buffer.byteLength(char);if(size+n>limit){out.push(part);part='';size=0;}part+=char;size+=n;}if(part)out.push(part);return out;}
module.exports={createCore,sessionId,render,chunks};
