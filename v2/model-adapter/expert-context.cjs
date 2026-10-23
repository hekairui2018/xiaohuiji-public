'use strict';
// Capacity belongs to the running server, not to the model's advertised training window.
function createExpertContext({base,transport}){
 let capacity,source='unavailable';
 function checkBudget({signal,deadline}={}){
  signal?.throwIfAborted();
  if(Number.isFinite(deadline)&&Date.now()>=deadline)throw Error('expert-timeout');
 }
 async function requestJson(route,options,limits){
  checkBudget(limits);
  const remaining=Number.isFinite(limits.deadline)?Math.max(1,Math.ceil(limits.deadline-Date.now())):5000;
  const timeout=AbortSignal.timeout(Math.min(5000,remaining));
  const signal=limits.signal?AbortSignal.any([limits.signal,timeout]):timeout;
  // Also stop awaiting a response body if an injected transport does not itself
  // interrupt body decoding. The signal still cancels the actual HTTP request.
  let aborted;
  const cancellation=new Promise((_,reject)=>{aborted=()=>reject(signal.reason);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();});
  try{
   const pending=(async()=>{const r=await transport(new URL(route,base),{...options,signal});return {r,j:await r.json()};})();
   const result=await Promise.race([pending,cancellation]);checkBudget(limits);return result;
  }finally{signal.removeEventListener('abort',aborted);}
 }
 async function count(text,limits){
  try{const {r,j}=await requestJson('/tokenize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:text})},limits);if(r.ok&&Array.isArray(j.tokens))return {tokens:j.tokens.length,method:'server-tokenizer'};}catch{checkBudget(limits);}
  // A byte bound is deliberately conservative; it is not presented as actual token usage.
  return {tokens:Buffer.byteLength(text,'utf8'),method:'utf8-byte-upper-bound'};
 }
 async function prepare(messages,input,format,outputBudget,limits={}){
  checkBudget(limits);
  if(!capacity){try{const {r,j}=await requestJson('/props',{},limits),n=j.default_generation_settings?.n_ctx;if(r.ok&&Number.isInteger(n)&&n>0){capacity=n;source='server-props';}}catch{checkBudget(limits);}}
  if(!capacity)throw Error('expert-context-unavailable');
  const available=capacity,reserve=outputBudget+2048,originalHistory=input.history.length;let estimate;
  for(;;){
   checkBudget(limits);
   messages[1].content=JSON.stringify(input);
   estimate=await count(JSON.stringify({messages,response_format:format}),limits);
   if(estimate.tokens+reserve<=available)break;
   if(!input.history.length)throw Error('expert-context-capacity');
   // Only evict old complete exchanges at actual capacity pressure; current evidence is retained.
   input.history.shift();while(input.history[0]?.role==='assistant')input.history.shift();
  }
  checkBudget(limits);
  return {capacityTokens:available,capacitySource:source,inputTokens:estimate.tokens,countMethod:estimate.method,reservedOutputTokens:outputBudget,templateSafetyTokens:2048,historyMessages:input.history.length,droppedHistoryMessages:originalHistory-input.history.length,serializedCharacters:JSON.stringify(messages).length};
 }
 return {prepare};
}
module.exports={createExpertContext};
