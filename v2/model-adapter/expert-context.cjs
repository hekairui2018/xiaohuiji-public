'use strict';
// Capacity belongs to the running server, not to the model's advertised training window.
function createExpertContext({base,transport}){
 let capacity,source='unavailable';
 async function count(text){
  try{const r=await transport(new URL('/tokenize',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:text}),signal:AbortSignal.timeout(5000)});const j=await r.json();if(r.ok&&Array.isArray(j.tokens))return {tokens:j.tokens.length,method:'server-tokenizer'};}catch{}
  // A byte bound is deliberately conservative; it is not presented as actual token usage.
  return {tokens:Buffer.byteLength(text,'utf8'),method:'utf8-byte-upper-bound'};
 }
 async function prepare(messages,input,format,outputBudget){
  if(!capacity){try{const r=await transport(new URL('/props',base),{signal:AbortSignal.timeout(5000)}),j=await r.json(),n=j.default_generation_settings?.n_ctx;if(r.ok&&Number.isInteger(n)&&n>0){capacity=n;source='server-props';}}catch{}}
  if(!capacity)throw Error('expert-context-unavailable');
  const available=capacity,reserve=outputBudget+2048,originalHistory=input.history.length;let estimate;
  for(;;){
   messages[1].content=JSON.stringify(input);
   estimate=await count(JSON.stringify({messages,response_format:format}));
   if(estimate.tokens+reserve<=available)break;
   if(!input.history.length)throw Error('expert-context-capacity');
   // Only evict old complete exchanges at actual capacity pressure; current evidence is retained.
   input.history.shift();while(input.history[0]?.role==='assistant')input.history.shift();
  }
  return {capacityTokens:available,capacitySource:source,inputTokens:estimate.tokens,countMethod:estimate.method,reservedOutputTokens:outputBudget,templateSafetyTokens:2048,historyMessages:input.history.length,droppedHistoryMessages:originalHistory-input.history.length,serializedCharacters:JSON.stringify(messages).length};
 }
 return {prepare};
}
module.exports={createExpertContext};
