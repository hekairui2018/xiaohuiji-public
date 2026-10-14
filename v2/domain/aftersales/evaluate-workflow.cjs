'use strict';
function evaluateWorkflow(nodes,observations){
 const path=[];
 for(const node of nodes){
  const conditionId=node.checkId+'-condition';
  if(node.requiresConditionConfirmation&&observations.get(conditionId)?.result==='fail')return {state:'condition-not-met',activeCheckId:conditionId,activeNode:node,path};
  if(node.requiresConditionConfirmation&&observations.get(conditionId)?.result!=='pass')return {state:'confirm-step-condition',activeCheckId:conditionId,activeNode:node,path};
  const result=observations.get(node.checkId)?.result;
  if(!result||result==='unknown')return {state:'execute-checks',activeCheckId:node.checkId,activeNode:node,path};
  path.push({checkId:node.checkId,result});
  if(result==='completed'&&node.historicalResult!=='unknown')return {state:'observe-step-result',activeCheckId:node.checkId,activeNode:node,path};
  if(node.historicalResult==='fail'&&result==='pass')return {state:'verify-phenomenon',activeCheckId:null,path,reason:'Observed result differs from the historical failed check; verify the original fault before more actions'};
  if(node.historicalResult==='pass'&&result==='fail')return {state:'unresolved-after-checks',activeCheckId:node.checkId,activeNode:node,path,reason:'Historical terminal action did not reproduce its result'};
 }
 return {state:'verify-phenomenon',activeCheckId:null,path};
}
module.exports={evaluateWorkflow};
