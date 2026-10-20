'use strict';
// Request-scoped, bounded, short-lived execution facts. No prompt/tool text.
function createRequestProgress({now=Date.now,max=256,ttl=10*60*1000}={}){
 const requests=new Map(),key=(session,request)=>JSON.stringify([session,request]);
 const valid=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(s);
 function begin(session,request){
  if(!valid(request))return ()=>{};
  for(const [k,v]of requests)if(now()-v.updatedAt>ttl)requests.delete(k);
  const k=key(session,request);if(requests.has(k))throw Error('progress-request-reused');
  while(requests.size>=max)requests.delete(requests.keys().next().value);
  const entry={stage:'understanding',sequence:0,done:false,updatedAt:now()};requests.set(k,entry);
  return stage=>{if(!['understanding','searching','reading','evidence-found','composing','completed','failed'].includes(stage)||entry.done)return;entry.stage=stage;entry.sequence++;entry.updatedAt=now();entry.done=['completed','failed'].includes(stage);};
 }
 function get(session,request){const entry=valid(request)&&requests.get(key(session,request));return entry&&now()-entry.updatedAt<=ttl?{...entry}:null;}
 return {begin,get};
}
module.exports={createRequestProgress};
