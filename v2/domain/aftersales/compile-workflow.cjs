'use strict';
const {createHash}=require('node:crypto');
// Split only explicitly ordered root steps. Never split comma conditions or substeps.
function compileWorkflow(checks){
 const nodes=[];
 for(const check of checks){const markers=[...check.text.matchAll(/(?:^|\s)(\d{1,2})[、.)）](?!\d)/g)];
  const ordered=markers.length>1&&markers.every((m,i)=>Number(m[1])===i+1);
  const boundaries=ordered?[0,...markers.slice(1).map(m=>m.index),check.text.length]:[0,check.text.length];
  for(let i=0;i<boundaries.length-1;i++){const start=boundaries[i],end=boundaries[i+1],text=check.text.slice(start,end);
   const negative=/无效果|没有改善|没有变化|没有效果|仍.{0,8}(异常|黑屏|花屏)|横线还在|未解决/.test(text);
   const positive=/恢复正常|显示正常|重新调试正常|已解决/.test(text);
   nodes.push({checkId:ordered?'node-'+createHash('sha256').update(check.checkId+'|'+start+'|'+text).digest('hex').slice(0,24):check.checkId,parentCheckId:check.checkId,text,sourceSpan:{start,end},
    requiresConditionConfirmation:/如果|假如|若|仅当|只有|前提|条件/.test(text),historicalResult:negative&&!positive?'fail':positive&&!negative?'pass':'unknown',verificationStatus:'literal-source-supported'});
  }
 }
 return {version:'source-sequence-1',nodes:nodes.map((n,i)=>({...n,nextCheckId:nodes[i+1]?.checkId||null})),policy:'Historical observations are branches to verify, never fault conclusions'};
}
module.exports={compileWorkflow};
