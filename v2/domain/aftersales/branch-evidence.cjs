'use strict';
const {evaluateWorkflow}=require('./evaluate-workflow.cjs');
function branchEvidence(c,observations){
 const scope=observations.get(c.stableId+'-scope');
 if(scope?.result==='fail')return {caseId:c.stableId,status:'scope-rejected',checkId:scope.checkId,observation:scope,sourceReference:c.sourceReference};
 if(scope?.result!=='pass')return {caseId:c.stableId,status:'untried',sourceReference:c.sourceReference};
 const flow=evaluateWorkflow(c.workflow?.nodes||c.checks,observations);
 if(flow.state==='condition-not-met')return {caseId:c.stableId,status:'step-condition-rejected',checkId:flow.activeCheckId,observation:observations.get(flow.activeCheckId),sourceReference:c.sourceReference};
 if(flow.state==='unresolved-after-checks')return {caseId:c.stableId,status:'historical-result-not-reproduced',checkId:flow.activeCheckId,observation:observations.get(flow.activeCheckId),sourceReference:c.sourceReference};
 const resolution=observations.get(c.stableId+'-resolution');
 if(flow.state==='verify-phenomenon'&&resolution?.result==='fail')return {caseId:c.stableId,status:'phenomenon-persists',checkId:resolution.checkId,observation:resolution,sourceReference:c.sourceReference};
 return {caseId:c.stableId,status:'in-progress',sourceReference:c.sourceReference};
}
const rejected=b=>!['untried','in-progress'].includes(b.status);
module.exports={branchEvidence,rejected};
