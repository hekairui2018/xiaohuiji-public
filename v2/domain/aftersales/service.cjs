'use strict';
const {retrieve,faultTags}=require('./retrieval.cjs');
const {evaluateWorkflow}=require('./evaluate-workflow.cjs');
const {branchEvidence,rejected}=require('./branch-evidence.cjs');
const {consumeCase}=require('./consume-case.cjs');
const {modelId}=require('../identity/model-id.cjs');
function createAftersalesService(knowledge){
 const reviews=knowledge?.evidenceCaseReviews?.()||[];
 const cases=(knowledge?.cases()||[]).map(c=>consumeCase(c,reviews));
 return demand=>{
  if(!demand.symptoms?.length)return {status:'unsupported',reason:'no-diagnostic-input',plan:null};
  const ranked=retrieve(demand,cases),observations=new Map();
  for(const o of demand.observations||[]){if(observations.has(o.checkId))return {status:'conflict',reason:'duplicate-observation-id'};observations.set(o.checkId,o);}
  const candidates=ranked.slice(0,3).map(r=>({caseId:r.case.stableId,legacyId:r.case.legacyId,domain:r.case.domain,possibleCause:r.case.verificationStatus==='reference_only'?null:r.case.possibleCause,matchingEvidence:r.evidence,sourceReference:r.case.sourceReference,sourceReferences:r.case.sourceReferences,verificationStatus:r.case.verificationStatus,evidencePolicy:r.case.evidencePolicy,scope:r.case.scope,solutionStatus:r.case.verificationStatus==='reference_only'?'reference-only-not-a-confirmed-solution':r.case.solutionStatus}));
  const classification={tags:faultTags(demand.symptoms.join(' ')),domains:[...new Set(candidates.map(c=>c.domain))],status:'hypotheses-not-diagnosis'};
  const executable=ranked.slice(0,3).filter(r=>r.case.checks.length&&r.case.executableEvidence);
  const branches=executable.map(r=>branchEvidence(r.case,observations));
  const top=ranked[0]?.case;
  if((top?.verificationStatus==='verified_by_case'||top?.workflow?.version==='literal-record-actions-1')&&!top.checks.length){
   const branch=branchEvidence(top,observations);branches.unshift(branch);
   if(!rejected(branch)){
    const confirmed=observations.get(top.stableId+'-scope')?.result==='pass';
    const scopeCheck={checkId:top.stableId+'-scope',text:'请先核对原案例的设备、模组及带载条件；相似现象不能代替适用条件',scope:{modelIds:top.modelIds,...top.scope},sourceReference:top.sourceReference};
    const reason=top.workflow?.version==='literal-record-actions-1'?'本记录保留了有出处的历史观察和待核实操作，但当前没有可自动执行的排查步骤。请补充现场条件；不会改用其他案例的步骤代替。':'这份原记录有现象和历史处理结果，但缺少可执行排查步骤。请补充现场观察、接线和带载信息；不会把其他案例的流程当作本案例已验证方案。';
    return {status:'needs_input',diagnosis:{state:confirmed?'insufficient-executable-evidence':'confirm-scope',classification,candidates,branches,activeCaseId:top.stableId,activeCheckId:confirmed?null:scopeCheck.checkId,checks:[scopeCheck],workflowPath:[],historicalSolution:null,solutionStatus:'source-record-without-executable-checks',verificationStatus:top.verificationStatus,sourceReference:top.sourceReference,sourceReferences:top.sourceReferences,incompleteEvidenceReason:confirmed?reason:null,conclusion:null},missing_parameters:[{path:'/observations',reason}]};
   }
  }
  const chosen=executable.find(r=>!rejected(branches.find(b=>b.caseId===r.case.stableId)));
  if(!chosen)return {status:'needs_input',diagnosis:{state:branches.length?'supported-branches-exhausted':ranked.length?'insufficient-executable-evidence':'no-supported-hypothesis',classification,candidates,branches,conclusion:null},missing_parameters:[{path:'/symptoms',reason:'当前有源流程已不适用或未复现效果。请补充现场变化、触发条件或完整现象；不会据此宣布原因已排除或故障已修复'}]};
  const c=chosen.case,scopeCheck={checkId:c.stableId+'-scope',text:'请核对本案例的设备及适用条件是否与现场一致',scope:{modelIds:c.modelIds,...c.scope},sourceReference:c.sourceReference};
  const resolutionCheck={checkId:c.stableId+'-resolution',text:'按有来源的排查完成后，原故障现象是否已消失？',sourceReference:c.sourceReference};
  const checks=(c.workflow?.nodes||c.checks).map(check=>({...check,sourceReference:c.sourceReference,sourceReferences:c.sourceReferences.filter(ref=>!ref.supportedField||ref.supportedCheckId===(check.parentCheckId||check.checkId)),verificationStatus:c.verificationStatus,evidencePolicy:c.evidencePolicy}));
  const scopeConfirmed=observations.get(scopeCheck.checkId)?.result==='pass';
  const flow=evaluateWorkflow(checks,observations);
  const resolution=observations.get(resolutionCheck.checkId)?.result;
  const knownValue=value=>typeof value==='string'&&Boolean(value.trim())&&!/^(unknown|未知|不知道|不清楚|未提供|待确认|none|null|n\/a)$/i.test(value.trim());
  const hasValues=values=>Array.isArray(values)&&values.some(knownValue);
  const provided=field=>field==='modelIds'?Boolean(demand.providedDevices?.some(d=>modelId(d.modelId))):field==='scans'?Boolean(demand.module?.scan?.denominator>0||hasValues(demand.requirements?.scans)):hasValues(demand.requirements?.[field]);
  const usedNodes=scopeConfirmed&&c.workflow?.version==='literal-record-actions-1'?checks.filter(node=>node.checkId===flow.activeNode?.checkId||observations.has(node.checkId)):[];
  const parameterNode=usedNodes.find(node=>(node.requiredParameters||[]).some(field=>!provided(field)));
  const required=(parameterNode?.requiredParameters||[]).filter(field=>!provided(field));
  const labels={modelIds:'设备型号',chips:'驱动芯片',scans:'扫描方式',firmwareVersions:'设备固件版本',softwareVersions:'调试软件版本'};
  const parameterCheck=required.length?{checkId:parameterNode.checkId+'-parameters',text:'此步需要补充现场参数：'+required.map(field=>labels[field]||field).join('、')+'。仅回复条件一致不能代替这些参数。',requiredParameters:required,sourceReference:c.sourceReference}:null;
  const state=!scopeConfirmed?'confirm-scope':parameterCheck?'missing-step-parameters':flow.state!=='verify-phenomenon'?flow.state:resolution==='pass'?'user-reported-resolution':resolution==='fail'?'unresolved-after-checks':'verify-phenomenon';
  const conditionCheck=flow.state==='confirm-step-condition'?{checkId:flow.activeCheckId,text:'请核对本步原文中的前提或条件是否满足：'+flow.activeNode.text,sourceReference:c.sourceReference}:null;
  return {status:state==='user-reported-resolution'?'ready':'needs_input',diagnosis:{state,classification,candidates,branches,activeCaseId:c.stableId,activeCheckId:state==='confirm-scope'?scopeCheck.checkId:parameterCheck?parameterCheck.checkId:flow.activeCheckId,workflowPath:flow.path,checks:[scopeCheck,...checks,...(conditionCheck?[conditionCheck]:[]),...(parameterCheck?[parameterCheck]:[]),resolutionCheck],
   historicalSolution:c.verificationStatus==='reference_only'?null:c.historicalSolution,solutionStatus:c.verificationStatus==='reference_only'?'reference-only-not-a-confirmed-solution':c.solutionStatus,caseStatus:c.caseStatus,verificationStatus:c.verificationStatus,evidencePolicy:c.evidencePolicy,
   conclusion:state==='user-reported-resolution'?{kind:'customer-observation',text:'客户报告完成排查后现象消失；不等于已证明最终故障原因'}:null,
   sourceReference:c.sourceReference,sourceReferences:c.sourceReferences},missing_parameters:state==='user-reported-resolution'?[]:parameterCheck?required.map(field=>({path:field==='modelIds'?'/providedDevices':field==='scans'?'/module/scan':'/requirements/'+field,reason:'请提供此步需要核对的'+(labels[field]||field)+'，未知信息不能当作已确认'})):[{path:'/observations',reason:state==='confirm-scope'?'请核对并补充案例列出的型号、芯片、扫描方式及适用条件；未知条件不能当作已确认':'按排查状态提交现场观察；未验证前不输出最终故障结论'}]};
 };
}
module.exports={createAftersalesService};
