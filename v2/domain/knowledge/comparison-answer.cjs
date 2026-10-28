'use strict';
const {comparisonValue}=require('./comparison-value.cjs');
// This path answers a parameter overview, not an engineering suitability task.
// Facts are rendered from aligned source cells; the full table remains visible.
function comparisonAnswer(route,evidence){
 if(route?.decision?.action!=='query-parameters'||route.decision.answerNeed!=='parameter-overview')return null;
 const source=evidence.find(e=>e.sourceKind==='structured-comparison-original'&&e.readPerformed===true);
 if(!source)return null;
 let table;try{table=JSON.parse(source.text);}catch{return null;}
 if(table.models?.length!==2||!table.rows?.length)return null;
 const differences=table.rows.filter(r=>r.different);
 const rows=(differences.length?differences:table.rows).slice(0,5);
 const render=v=>{
  const meaning=comparisonValue(v.value,{recorded:v.meaning?.state!=='unknown',conflict:v.conflict});
  const raw=String(v.value);
  if(meaning.state==='unknown')return '资料未确认（原值：'+raw+'）';
  if(meaning.state==='uninterpreted-symbol')return '原表符号“'+raw+'”，图例未确认';
  if(meaning.state==='conflict')return raw+'（来源冲突，待核对）';
  return raw;
 };
 const name=(spec)=>[spec.brand&&spec.brand!=='未明确'?spec.brand:'',spec.model].filter(Boolean).join('');
 const names=table.models.map(name);
 const claims=rows.map(row=>({text:row.parameter+'：'+row.values.map((v,i)=>(names[i]||v.model)+'＝'+render(v)).join('；')+'。',evidenceIds:[source.evidenceId]}));
 const intro=differences.length?'原表记录的主要差异如下，完整参数见两列对比表。':'原表未显示参数值差异，完整记录见两列对比表。';
 return {status:'answer',actualMode:'expert',intent:route.intent,reply:intro+'\n\n'+claims.map(c=>c.text).join('\n'),claims,question:'',parameterComparison:table,
  results:[{...source,text:null}],evidence:[source],modelCallCount:0,toolCallCount:0,toolRequestCount:0,modelCalls:[],toolTrace:[],elapsedMs:0,grounding:'deterministic-source-cell-comparison; suitability-not-inferred'};
}
module.exports={comparisonAnswer};
