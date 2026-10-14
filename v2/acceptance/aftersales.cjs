'use strict';
const {report}=require('./report.cjs');
const {modelId}=require('../domain/identity/model-id.cjs');
function createAftersalesAudit(knowledge){const cases=new Map(knowledge.cases().map(c=>[c.stableId,c]));return (result,demand=result.normalizedDemand)=>{
 const r=report('aftersales');try{const d=result.diagnosis;
  if(!d){r.check('missing-symptom-followup',result.status!=='ready');return r.finish();}
  const observations=new Map((demand?.observations||[]).map(o=>[o.checkId,o.result])),models=(demand?.providedDevices||[]).map(x=>modelId(x.modelId));
  r.check('no-unobserved-conclusion',!d.conclusion||(d.state==='user-reported-resolution'&&d.conclusion.kind==='customer-observation'&&observations.get(d.activeCaseId+'-resolution')==='pass'));
  for(const candidate of d.candidates||[]){const c=cases.get(candidate.caseId);r.check('candidate-source:'+candidate.caseId,Boolean(c&&candidate.sourceReference?.sha256===c.sourceReference?.sha256&&candidate.sourceReference?.originalId===c.originalId));
   if(c)r.check('candidate-model-isolation:'+c.stableId,!models.length||!c.modelIds.length||models.some(m=>c.modelIds.includes(m)));
  }
  for(const branch of d.branches||[])if(!['untried','in-progress'].includes(branch.status)){const c=cases.get(branch.caseId),nodes=c?.workflow?.nodes||[],id=branch.checkId;
   const allowed=branch.status==='scope-rejected'?id===c?.stableId+'-scope':branch.status==='phenomenon-persists'?id===c?.stableId+'-resolution':branch.status==='step-condition-rejected'?nodes.some(n=>n.requiresConditionConfirmation&&id===n.checkId+'-condition'):branch.status==='historical-result-not-reproduced'?nodes.some(n=>n.historicalResult==='pass'&&id===n.checkId):false;
   r.check('observed-branch-rejection:'+branch.caseId,Boolean(c&&allowed&&observations.get(id)==='fail'&&branch.observation?.result==='fail'&&branch.sourceReference?.sha256===c.sourceReference?.sha256));
  }
  if(!d.activeCaseId){r.check('insufficient-evidence-asks-more',result.status==='needs_input'&&Boolean(result.missing_parameters?.length));return r.finish();}
  const c=cases.get(d.activeCaseId);r.check('active-case-exists',Boolean(c));if(!c)return r.finish();
  const nodes=c.workflow?.nodes||c.checks,returned=d.checks||[],observationNodes=new Set(nodes.map(n=>n.checkId));
  r.check('all-source-steps-retained',nodes.every(n=>returned.some(x=>x.checkId===n.checkId&&x.text===n.text)));
  r.check('no-invented-steps',returned.every(x=>observationNodes.has(x.checkId)||[c.stableId+'-scope',c.stableId+'-resolution'].includes(x.checkId)||nodes.some(n=>n.requiresConditionConfirmation&&x.checkId===n.checkId+'-condition'&&x.text==='请核对本步原文中的前提或条件是否满足：'+n.text)));
  r.check('scope-asked-before-execution',observations.get(c.stableId+'-scope')==='pass'||d.state==='confirm-scope');
  r.check('needs-input-has-question',result.status!=='needs_input'||Boolean(result.missing_parameters?.length));
  if(['execute-checks','observe-step-result','confirm-step-condition'].includes(d.state))r.check('active-step-identified',returned.some(x=>x.checkId===d.activeCheckId));
  for(const n of nodes)if(n.requiresConditionConfirmation&&observations.has(n.checkId))r.check('conditional-step-confirmed:'+n.checkId,observations.get(n.checkId+'-condition')==='pass');
  if(d.conclusion)r.check('no-cause-proven-by-similarity',d.conclusion.kind==='customer-observation'&&d.state==='user-reported-resolution');
  if(result.status==='ready'||d.conclusion){const visited=d.workflowPath||[],prefix=visited.length>0&&visited.every((entry,i)=>nodes[i]?.checkId===entry.checkId&&observations.get(entry.checkId)===entry.result&&['pass','fail','completed'].includes(entry.result));
   const last=nodes[visited.length-1],outcome=visited.at(-1)?.result;
   const terminal=prefix&&((visited.length===nodes.length&&!(last.historicalResult==='pass'&&outcome==='fail')&&!(last.historicalResult!=='unknown'&&outcome==='completed'))||(last.historicalResult==='fail'&&outcome==='pass'));
   r.check('verified-path-before-resolution',terminal);
  }
  r.pending('actual-fault-outcome','现场故障原因、实际解决效果不能由模拟反馈或同源命中自动证明',{caseId:c.stableId,source:c.sourceReference});
 }catch(error){r.check('diagnosis-output-structure',false,error.message);}return r.finish();};}
module.exports={createAftersalesAudit};
