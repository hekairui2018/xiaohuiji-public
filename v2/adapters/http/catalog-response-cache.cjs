'use strict';
const {gzip}=require('node:zlib'),{promisify}=require('node:util');
const compress=promisify(gzip);
function createCatalogResponseCache({ttl=30000,maxEntries=32,staleMs=0,now=Date.now}={}){
 const entries=new Map();
 function build(key,load,previous){
  const entry={time:now(),data:null,previous};
  entry.result=Promise.resolve().then(load).then(async body=>{
   const plain=Buffer.from(JSON.stringify(body)),gz=await compress(plain);
   entry.data={plain,gzip:gz};entry.buildMs=now()-entry.time;entry.time=now();entry.previous=null;return entry.data;
  }).catch(error=>{if(entries.get(key)===entry){if(previous?.data)entries.set(key,previous);else entries.delete(key);}throw error;});
  entries.set(key,entry);if(entries.size>maxEntries)entries.delete(entries.keys().next().value);
  return entry;
 }
 async function get(key,load){
  let entry=entries.get(key);let state='hit';
  if(!entry){entry=build(key,load);state='miss';}
  else if(!entry.data&&entry.previous?.data&&staleMs&&now()-entry.previous.time<ttl+staleMs)return {data:entry.previous.data,state:'refreshing',buildMs:entry.previous.buildMs};
  else if(entry.data&&now()-entry.time>=ttl){
   if(staleMs&&now()-entry.time<ttl+staleMs){const previous=entry;entry=build(key,load,previous);entry.result.catch(()=>{});return {data:previous.data,state:'refreshing',buildMs:previous.buildMs};}
   entry=build(key,load,entry);state='expired';
  }
  return {data:await entry.result,state,buildMs:entry.buildMs};
 }
 async function respond(req,res,key,load){
  const started=now(),{data,state,buildMs}=await get(key,load);
  const compressed=String(req.headers['accept-encoding']||'').split(',').some(part=>{const [encoding,...params]=part.trim().split(';');const quality=params.find(p=>/^\s*q\s*=/i.test(p));return encoding.toLowerCase()==='gzip'&&(!quality||Number(quality.split('=')[1])>0);});
  const payload=compressed?data.gzip:data.plain;
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Accept-Encoding','Server-Timing':`catalog;dur=${now()-started};desc="${state}", catalog_build;dur=${buildMs||0}`,...(compressed?{'Content-Encoding':'gzip'}:{}),'Content-Length':payload.length});
  res.end(payload);
 }
 respond.prepare=(key,load)=>get(key,load);
 return respond;
}
module.exports={createCatalogResponseCache};
