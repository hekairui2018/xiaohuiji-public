'use strict';
const {operationTarget,operationCoverage}=require('../../domain/knowledge/operation-target.cjs');
const {selectOperationEvidence}=require('./expert-operation-evidence.cjs');
async function prepareOperationEvidence({rows=[],plan,search,read,documents=[]}){
 const target=operationTarget(plan),original=rows;
 let selected=selectOperationEvidence(rows,plan);
 if(target.steps.length&&!operationCoverage(selected.map(r=>r.originalText||r.text).join('\n'),target).complete&&documents.length){
  const first=target.steps[0];
  for(const alias of first.aliases){
   // The native proximity API accepts at most four document identities.
   // Keep all allowed documents, querying bounded batches instead of silently
   // losing later manuals or submitting an invalid oversized filter.
   for(let offset=0;offset<documents.length;offset+=4){
    const found=await search({kind:'text',query:[...(plan.software||[]),alias,first.object].join(' ').slice(0,240),concepts:[alias,first.object],documents:documents.slice(offset,offset+4)});
    for(const candidate of (found.evidence||[]).slice(0,2)){
     if(operationCoverage(candidate.text,target).primarySupported!==true)continue;
     const body=await read({blockId:candidate.blockId});rows.push(...(body?.evidence||[]));
    }
    selected=selectOperationEvidence(rows,plan);if(operationCoverage(selected.map(r=>r.originalText||r.text).join('\n'),target).complete)break;
   }
   if(operationCoverage(selected.map(r=>r.originalText||r.text).join('\n'),target).complete)break;
  }
 }
 const coverage=operationCoverage(selected.map(r=>r.originalText||r.text).join('\n'),target);
 // Coverage proves action/object text was located, not that an entire workflow
 // or its hardware applicability has been independently verified.
 return {rows:selected,target,coverage,sourceNames:[...new Set(original.map(r=>r.name).filter(Boolean))],complete:!target.steps.length||coverage.complete};
}
function incompleteOperationAnswer(prepared){
 if(prepared.complete)return null;
 const missing=prepared.coverage.steps.filter(s=>!s.instructionLocated).map(s=>s.aliases[0]+s.object);
 const available=prepared.coverage.steps.filter(s=>s.instructionLocated).map(s=>s.aliases[0]+s.object);
 return {status:'answer',actualMode:'expert',intent:'operation',reply:(prepared.sourceNames.length?'已找到相关手册。':'')+(available.length?'当前原文可确认“'+available.join('、')+'”；':'')+'当前检索尚未核实“'+missing.join('、')+'”的完整操作步骤，不能用其他功能的步骤代替。请提供当前软件版本或对应界面截图，以便继续核对。',
  claims:[],question:'',results:prepared.rows.map(e=>({...e,text:null})),evidence:prepared.rows,modelCallCount:0,toolCallCount:0,toolRequestCount:0,modelCalls:[],toolTrace:[],elapsedMs:0,grounding:'incomplete-target-operation; not-a-proof-of-document-absence'};
}
module.exports={prepareOperationEvidence,incompleteOperationAnswer};
