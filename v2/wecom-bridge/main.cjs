'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
const {randomUUID}=require('node:crypto');
const {createCore,render,chunks}=require('./core.cjs');
const configFile=process.argv[2];if(!configFile)throw Error('explicit-private-config-required');
const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));
if(!cfg.botId||!cfg.secret||!cfg.sdkRoot)throw Error('missing-private-config');
const SDK=createRequire(path.resolve(cfg.sdkRoot,'package.json'))('@wecom/aibot-node-sdk');
const core=createCore(cfg),pending=new Map(),seen=new Map();
const state={authenticated:false,received:0,completed:0,failed:0,lastMode:null,lastInboundAt:null,lastCompletedAt:null};
const logger={debug(){},log(){},info(){},warn(){},error(){}};
const client=new SDK.WSClient({botId:cfg.botId,secret:cfg.secret,maxReconnectAttempts:-1,maxAuthFailureAttempts:-1,logger});
client.on('authenticated',()=>{state.authenticated=true;console.log('authenticated');});
client.on('disconnected',()=>{state.authenticated=false;});
client.on('reconnecting',()=>{state.authenticated=false;});
client.on('error',()=>console.error('wecom-connection-error'));
function identity(body){return body.chattype==='single'?'u:'+body.from?.userid:'g:'+body.chatid+':u:'+body.from?.userid;}
async function handle(frame){
 const b=frame.body||{},key=identity(b),id=b.msgid||frame.headers?.req_id;
 if(!b.from?.userid||b.chattype!=='single'&&!b.chatid)return;
 if(id&&seen.has(id))return;if(id)seen.set(id,Date.now());
 for(const [k,t]of seen)if(Date.now()-t>3600000)seen.delete(k);
 state.received++;state.lastInboundAt=new Date().toISOString();
 const stream=randomUUID();
 // The original callback frame is retained for reply acknowledgements.
 await client.replyStream(frame,stream,'正在查询，请稍候…',false);
 const previous=pending.get(key)||Promise.resolve();
 const work=previous.catch(()=>{}).then(async()=>{
  try{
   const parts=[];
   if(b.msgtype==='text')parts.push(b.text?.content||'');
   const items=b.msgtype==='mixed'?b.mixed?.msg_item||[]:b.msgtype==='image'?[{msgtype:'image',image:b.image}]:[];
   for(const item of items){
    if(item.msgtype==='text')parts.push(item.text?.content||'');
    if(item.msgtype==='image'){
     const file=await client.downloadFile(item.image.url,item.image.aeskey);
     const ocr=await core.request('/api/ocr',{imageBase64:file.buffer.toString('base64')});
     if(!ocr.data.ok||!ocr.data.text)throw Error('image-unreadable');parts.push(ocr.data.text);
    }
   }
   const message=parts.join('\n').replace(/^@[^\s@]+\s*/,'').trim();
   if(!message||message.length>8000){await client.replyStream(frame,stream,'请用文字或清晰图片描述问题，文字不超过8000字。',true);return;}
   const data=await core.answer(key,message),output=chunks(render(data));
   await client.replyStream(frame,stream,output[0],true);
   const target=b.chattype==='single'?b.from.userid:b.chatid;
   for(const part of output.slice(1))await client.sendMessage(target,{msgtype:'markdown',markdown:{content:part}});
   state.completed++;state.lastMode=data.bridgeMode;state.lastCompletedAt=new Date().toISOString();
  }catch{state.failed++;await client.replyStream(frame,stream,'本次查询未完成，请稍后重试；图片问题也可以直接发文字。',true).catch(()=>{});}
 });
 pending.set(key,work);try{await work;}finally{if(pending.get(key)===work)pending.delete(key);}
}
for(const kind of ['text','image','mixed'])client.on('message.'+kind,frame=>handle(frame).catch(()=>{state.failed++;}));
client.on('message.voice',frame=>client.replyStream(frame,randomUUID(),'请用文字或图片发送问题。',true).catch(()=>{}));
const server=http.createServer((req,res)=>{if(req.url!=='/health'){res.writeHead(404);return res.end();}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'xiaohuiji-v2-wecom',version:'20261104-01',pid:process.pid,...state,active:pending.size}));});
server.on('error',()=>{client.disconnect();process.exit(1);});
server.listen(cfg.port||8522,'127.0.0.1',()=>client.connect());
process.on('SIGTERM',()=>{client.disconnect();server.close(()=>process.exit(0));});
