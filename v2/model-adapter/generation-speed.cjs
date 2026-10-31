'use strict';
function generationSpeed(calls=[]){
 const rows=calls.filter(c=>c.httpStatus===200&&Number.isFinite(c.usage?.completion_tokens)&&c.usage.completion_tokens>0);
 if(!rows.length)return null;
 const decoded=rows.every(c=>c.timings?.predicted_n>0&&c.timings?.predicted_ms>0);
 const tokens=rows.reduce((sum,c)=>sum+(decoded?c.timings.predicted_n:c.usage.completion_tokens),0);
 const ms=rows.reduce((sum,c)=>sum+(decoded?c.timings.predicted_ms:c.elapsedMs),0);
 if(!Number.isFinite(ms)||ms<=0)return null;
 const rate=decoded&&rows.every(c=>Number.isFinite(c.timings.predicted_per_second)&&c.timings.predicted_per_second>0)?rows.reduce((sum,c)=>sum+c.timings.predicted_per_second*c.timings.predicted_ms,0)/ms:tokens*1000/ms;
 return {tokensPerSecond:Math.round(rate*10)/10,tokens,elapsedMs:ms,kind:decoded?'decode':'generation-average',includesThinking:rows.some(c=>(c.usage?.completion_tokens_details?.reasoning_tokens||c.reasoningTokens||0)>0),callCount:rows.length};
}
module.exports={generationSpeed};
