'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomUUID,createHash}=require('node:crypto');

const privateKey=/(?:password|passwd|api[ _-]?key|authorization|access[_-]?token|refresh[_-]?token|secret|cookie|credential|密码|口令|密钥|令牌|customer[_-]?name|contact[_-]?name|phone|mobile[_-]?number|email|客户姓名|联系人|手机号|身份证|住址|联系地址)|^(?:token|pwd)$/i;
function redact(value,depth=0){
 if(depth>48)return '[层级上限，已省略]';
 if(typeof value==='string'){
  if(/^[\s]*[\[{]/.test(value)){try{return JSON.stringify(redact(JSON.parse(value),depth+1));}catch{}}
  return value.replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi,'[认证凭据已脱敏]')
   .replace(/((?:api[ _-]?key|password|passwd|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|authorization|密码|口令|密钥|令牌|联系人|客户姓名|联系地址|住址)["']?\s*[:=：]\s*["']?)[^\s"',;}，；]+/gi,'$1[已脱敏]')
   .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已脱敏]')
   .replace(/(?<![\w])(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g,'[电话已脱敏]')
   .replace(/(?<!\w)\d{17}[0-9X](?!\w)/gi,'[证件号已脱敏]')
   .replace(/[A-Z]:[\\/][^\n\r"<>|]+/gi,'[本地路径已脱敏]');
 }
 if(Array.isArray(value))return value.map(item=>redact(item,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,privateKey.test(key)?'[已脱敏]':redact(item,depth+1)]));
 return value;
}

function createCapture({enabled=false,maxRecords=20,maxBytes=64*1024*1024,maxRecordBytes=8*1024*1024,maxEventBytes=2*1024*1024,maxEvents=256,maxPendingBytes=8*1024*1024}={}){
 const context=new AsyncLocalStorage(),records=new Map(),queue=[];let bytes=0,pendingBytes=0,scheduled=false,dropped=0;
 function trim(){while(records.size>maxRecords||bytes>maxBytes){const first=records.keys().next().value;if(first===undefined)break;bytes-=records.get(first).bytes;records.delete(first);dropped++;}}
 function drain(){scheduled=false;let work=0;while(queue.length&&work++<8){const {record,event,raw,size}=queue.shift();pendingBytes-=size;if(!records.has(record.id))continue;
   try{event.data=redact(JSON.parse(raw));const added=Buffer.byteLength(JSON.stringify(event));if(record.events.length>=maxEvents||record.bytes+added>maxRecordBytes){record.omitted++;continue;}record.events.push(event);record.bytes+=added;bytes+=added;trim();}catch{record.omitted++;}
  }if(queue.length){scheduled=true;setImmediate(drain);}}
 function event(type,data,record=context.getStore()){
  if(!enabled||!record||!records.has(record.id))return;
  try{const raw=JSON.stringify(data??null),size=Buffer.byteLength(raw);if(size>maxEventBytes||pendingBytes+size>maxPendingBytes||queue.length>=128){record.omitted++;return;}
   queue.push({record,event:{sequence:++record.sequence,type,at:new Date().toISOString(),elapsedMs:Date.now()-record.started},raw,size});pendingBytes+=size;if(!scheduled){scheduled=true;setImmediate(drain);}
  }catch{record.omitted++;}
 }
 async function run(input,fn){
  if(!enabled)return fn();
  const session=input.sessionState?.id||'',record={id:randomUUID(),session:session?createHash('sha256').update(session).digest('hex').slice(0,16):null,started:Date.now(),startedAt:new Date().toISOString(),status:'running',question:redact(input.sessionState?.messages?.filter(m=>m.role==='user').at(-1)?.content||input.message||''),events:[],sequence:0,bytes:0,omitted:0};
  record.bytes=Buffer.byteLength(JSON.stringify(record));bytes+=record.bytes;records.set(record.id,record);trim();
  return context.run(record,async()=>{event('customer.input',{message:input.message,originalQuestion:record.question,sessionState:input.sessionState,route:input.route});try{const output=await fn();record.status=output.status||'completed';event('assistant.final',output);return output;}catch(error){record.status='failed';event('request.error',{name:error.name,message:error.message});throw error;}finally{record.elapsedMs=Date.now()-record.started;record.finishedAt=new Date().toISOString();}});
 }
 function wrapTransport(transport){return async(url,options={})=>{
  const record=context.getStore();if(!enabled||!record)return transport(url,options);
  const callId=randomUUID(),path=new URL(url).pathname,started=Date.now();
  event('model.request',{callId,path,method:options.method||'GET',payload:options.body?parse(options.body):null,headers:'不记录请求头，避免泄露凭据'});
  try{const response=await transport(url,options);let recorded=false;
   return new Proxy(response,{get(target,key){if(key==='json')return async()=>{try{const raw=await target.json();if(!recorded){recorded=true;event('model.response',{callId,path,status:target.status??(target.ok?200:500),elapsedMs:Date.now()-started,body:raw},record);}return raw;}catch(error){event('model.response-error',{callId,path,elapsedMs:Date.now()-started,message:error.message},record);throw error;}};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  }catch(error){event('model.transport-error',{callId,path,elapsedMs:Date.now()-started,name:error.name,message:error.message},record);throw error;}
 };}
 const summary=r=>({id:r.id,session:r.session,question:r.question.slice(0,160),startedAt:r.startedAt,status:r.status,elapsedMs:r.elapsedMs??Date.now()-r.started,eventCount:r.events.length,omitted:r.omitted,bytes:r.bytes});
 return {enabled,event,run,wrapTransport,list:()=>[...records.values()].reverse().map(summary),get:id=>{const r=records.get(id);return r?{...summary(r),question:r.question,events:r.events}:null;},status:()=>({enabled,storage:'memory-only',records:records.size,bytes,pendingBytes,dropped,maxRecords,maxBytes,maxRecordBytes,maxEventBytes,maxEvents}),clear(){records.clear();queue.length=0;bytes=0;pendingBytes=0;},async flush(){while(scheduled||queue.length)await new Promise(resolve=>setImmediate(resolve));}};
}
function parse(raw){try{return JSON.parse(raw);}catch{return raw;}}
module.exports={createCapture,redact};
