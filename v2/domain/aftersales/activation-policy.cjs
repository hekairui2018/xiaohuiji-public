'use strict';
const {consumeCase}=require('./consume-case.cjs'),{faultTags}=require('./retrieval.cjs');
const norm=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
function buildCaseActivation(knowledge){
 const cases=(knowledge.cases()||[]).map(c=>consumeCase(c,knowledge.evidenceCaseReviews?.()||[])),modelFrequency={},faultFrequency={};
 for(const c of cases){for(const m of c.modelIds||[])modelFrequency[m]=(modelFrequency[m]||0)+1;for(const tag of faultTags(c.phenomenon))faultFrequency[tag]=(faultFrequency[tag]||0)+1;}
 const rows=cases.map(c=>{
  const originals=(c.sourceReferences||[]).filter(r=>r.originalSha256&&r.originalPath),text=norm(originals.map(r=>r.excerpt||'').join('\n'));
  const nonempty=key=>Array.isArray(c.scope?.[key])&&c.scope[key].length>0;
  // Empty fields never mean universal applicability. Display cases need module conditions.
  const scopeComplete=c.domain==='display'?nonempty('chips')&&nonempty('pitches')&&nonempty('scans'):(c.modelIds||[]).length>0&&['softwareVersions','firmwareVersions','additionalConditions'].some(nonempty);
  const scopeSupported=scopeComplete&&Object.values(c.scope||{}).filter(Array.isArray).flat().every(v=>text.includes(norm(v)));
  const reasons=[];
  if(!['verified','verified_by_case','reference_only'].includes(c.verificationStatus))reasons.push('verification-not-established');
  if(c.verificationStatus==='reference_only')reasons.push('reference-only-not-a-solution');
  if(!originals.length)reasons.push('original-source-missing');
  if(!scopeComplete||!scopeSupported)reasons.push('scope-incomplete-or-not-supported');
  if(!c.checks.length)reasons.push('executable-checks-missing');
  else if(c.checks.some(ch=>!text.includes(norm(ch.text))||!/检查|核对|确认|查看|检测|测试|调整|调试|更换|重插|插拔|发送|设置|排查|尝试/.test(ch.text)))reasons.push('checks-not-complete-source-supported-actions');
  if(!(c.modelIds||[]).some(id=>modelFrequency[id]>=30))reasons.push('high-frequency-model-not-established');
  if(!faultTags(c.phenomenon).some(tag=>faultFrequency[tag]>=20))reasons.push('high-frequency-fault-not-established');
  if(c.caseStatus!=='closed_loop'||!originals.some(r=>/问题已解决|故障已消失|最终(?:已)?恢复正常|(?:客户|现场)[^。\n]{0,15}已恢复正常|处理后[^。\n]{0,15}恢复正常/.test(r.excerpt||'')&&!/未恢复正常|没有恢复正常|无法恢复正常|问题未解决/.test(r.excerpt||'')))reasons.push('field-outcome-not-established');
  const tier=!reasons.length?'enabled':c.verificationStatus==='reference_only'&&originals.length&&scopeSupported?'reference-helper':'internal-only';
  return {caseId:c.stableId,legacyId:c.legacyId,verificationStatus:c.verificationStatus,tier,reasons,scope:c.scope,modelIds:c.modelIds,sourceReferences:originals,requiredFollowup:reasons.map(reason=>({'verification-not-established':'核对独立原记录并标记验证状态','original-source-missing':'补可追溯原始记录','scope-incomplete-or-not-supported':'补型号、芯片、扫描、模组及版本适用条件','executable-checks-missing':'从原文补操作步骤和现场观察点','checks-not-complete-source-supported-actions':'区分原因说明与可执行步骤，逐项核对原文','high-frequency-model-not-established':'补可靠业务频次依据或明确批准试点范围','high-frequency-fault-not-established':'补故障频次依据或明确批准试点范围','field-outcome-not-established':'补原现场结果记录；历史方案描述不等于验证成功','reference-only-not-a-solution':'维持参考状态，不能当确定方案'}[reason]))};
 });
 const reasons={},primaryReasons={};for(const r of rows.filter(r=>r.tier!=='enabled')){for(const reason of r.reasons)reasons[reason]=(reasons[reason]||0)+1;const primary=r.reasons[0];primaryReasons[primary]=(primaryReasons[primary]||0)+1;}
 return {schemaVersion:'1.0',knowledgeVersion:knowledge.version,total:rows.length,enabledIds:rows.filter(r=>r.tier==='enabled').map(r=>r.caseId),referenceHelperIds:rows.filter(r=>r.tier==='reference-helper').map(r=>r.caseId),internalOnlyIds:rows.filter(r=>r.tier==='internal-only').map(r=>r.caseId),counts:{enabled:rows.filter(r=>r.tier==='enabled').length,notEnabled:rows.filter(r=>r.tier!=='enabled').length,referenceHelpers:rows.filter(r=>r.tier==='reference-helper').length,internalOnly:rows.filter(r=>r.tier==='internal-only').length},reasons,primaryReasons,frequencyBasis:{kind:'case-library-frequency-proxy-not-customer-usage',modelThreshold:30,faultThreshold:20,modelFrequency,faultFrequency},rows};
}
module.exports={buildCaseActivation};
