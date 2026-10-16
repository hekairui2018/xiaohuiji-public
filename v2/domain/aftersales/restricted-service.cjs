'use strict';
const {createAftersalesService}=require('./service.cjs'),{consumeCase}=require('./consume-case.cjs'),{retrieve,faultTags}=require('./retrieval.cjs');
const citations=c=>(c.sourceReferences||[]).map(ref=>Object.fromEntries(Object.entries(ref).filter(([key])=>!['excerpt','conditions'].includes(key))));
function createRestrictedAftersales(knowledge,policy){
 if(policy.knowledgeVersion!==knowledge.version)throw Error('Case whitelist knowledge version mismatch');
 const enabled=new Set(policy.enabledIds),helpers=new Set(policy.referenceHelperIds),all=knowledge.cases(),reviews=knowledge.evidenceCaseReviews?.()||[];
 const service=createAftersalesService({cases:()=>all.filter(c=>enabled.has(c.stableId)),evidenceCaseReviews:()=>reviews});
 const references=all.filter(c=>helpers.has(c.stableId)).map(c=>consumeCase(c,reviews));
 return demand=>{
  const result=service(demand);if(result.diagnosis?.candidates?.length)return {...result,caseActivation:{mode:'whitelist',knowledgeVersion:policy.knowledgeVersion}};
  const ranked=retrieve(demand,references).slice(0,3),candidates=ranked.map(({case:c,evidence})=>({caseId:c.stableId,legacyId:c.legacyId,usage:'reference-only-followup',verificationStatus:'reference_only',possibleCause:null,scope:c.scope,sourceReference:c.sourceReference,sourceReferences:citations(c),matchingEvidence:evidence,solutionStatus:'not-enabled-for-diagnosis'}));
  return {status:'needs_input',caseActivation:{mode:'whitelist',knowledgeVersion:policy.knowledgeVersion},diagnosis:{state:ranked.length?'reference-only-followup':'no-enabled-case',classification:{tags:faultTags((demand.symptoms||[]).join(' ')),status:'hypotheses-not-diagnosis'},candidates,branches:[],checks:[],conclusion:null,historicalSolution:null,sourceReference:ranked[0]?.case.sourceReference,sourceReferences:ranked[0]?citations(ranked[0].case):[],incompleteEvidenceReason:ranked.length?'检索到适用条件待现场核对的参考记录，仅用于补充条件，不提供确定原因或处理方案。\n待核对条件：'+JSON.stringify(candidates.map(c=>({modelIds:ranked.find(r=>r.case.stableId===c.caseId).case.modelIds,...c.scope}))):'当前没有符合启用条件的诊断案例。请补充完整型号、现象、触发条件及芯片/扫描信息；不会引用未启用案例给出结论。'},missing_parameters:[{path:'/symptoms',reason:'补充现场型号、故障现象与适用条件，参考记录不能代替已验证的排查流程'}]};
 };
}
module.exports={createRestrictedAftersales};
