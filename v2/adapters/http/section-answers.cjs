'use strict';
// Both question modes use the same fulltext backend. No secondary source fallback.
function createSectionAnswers(sectionSearch,{materials=null}={}){
 const models=[...new Set((materials?.data?.records||[]).filter(r=>r.kind==='comparison').map(r=>r.model))];
 async function search(query,options){
  if(!sectionSearch)throw Error('fulltext-not-configured');
  return sectionSearch.search(query,options);
 }
 async function answer(query,options){
  let plan=require('../../domain/knowledge/resource-query.cjs').planResourceQuery(query,{models});
  if(plan.social)return {status:'answer',intent:'social',reply:/谢/.test(query)?'不客气，有需要继续问。':'你好！告诉我型号，以及想查的参数、资料或操作。',results:[],modelCallCount:0,answerBasis:'deterministic-social'};
  const fileRequest=['resource','resource-candidates'].includes(plan.answerNeed)&&!plan.documentContent;
  if(!fileRequest&&!plan.operation&&materials){
   const evidence=materials.evidence(query,{targetedOnly:true}).filter(e=>e.sourceKind==='structured-comparison-original');
   if(evidence.length){
    const source=evidence[0],table=JSON.parse(source.text);
    const compared=require('../../domain/knowledge/comparison-answer.cjs').comparisonAnswer({intent:'comparison',decision:{action:'query-parameters',answerNeed:'parameter-overview'}},evidence);
    const render=value=>{const meaning=require('../../domain/knowledge/comparison-value.cjs').comparisonValue(value.value,{conflict:value.conflict,recorded:value.meaning?.state!=='unknown'});return meaning.state==='unknown'?'资料未确认（原值：'+value.value+'）':meaning.state==='uninterpreted-symbol'?'原表符号“'+value.value+'”，含义待核对':value.conflict?value.value+'（来源冲突）':value.value;};
    const reply=compared?.reply||table.rows.slice(0,12).map(row=>row.parameter+'：'+row.values.map(value=>value.model+'＝'+render(value)).join('；')).join('\n');
    const sources=[...new Set(table.rows.flatMap(row=>row.values.flatMap(value=>(value.source||[]).map(ref=>[ref.name,ref.sheet,ref.cell].filter(Boolean).join(' / ')))))];
    return {status:'answer',intent:table.models.length>1?'comparison':'product',reply:reply+'\n\n来源：'+sources.slice(0,5).join('；'),results:[{name:source.name,models:source.modelIds,text:reply,evidenceId:source.evidenceId,sourceKind:source.sourceKind}],parameterComparison:table,modelCallCount:0,retrievalBackend:'knowledge-table',answerBasis:'source-cell-values',queryPlan:plan};
   }
  }
  const found=await search(query,options);
  plan=require('../../domain/knowledge/resource-query.cjs').planResourceQuery(query,{models:[...new Set([...models,...(found.results||[]).flatMap(row=>row.models||[])])]});
  let results;
  if(fileRequest)results=[...new Map((found.results||[]).filter(row=>!plan.categories.length||!row.kind||plan.categories.includes(row.kind)).map(row=>[row.sha256||row.download||row.name,row])).values()].slice(0,3);
  else{
   let candidates=(found.results||[]).filter(row=>!row.kind||['spec','manual','document'].includes(row.kind));
   if(plan.software.length)candidates=candidates.filter(row=>plan.software.some(software=>(row.name+' '+row.text).toLowerCase().includes(software.toLowerCase())));
   results=require('../../domain/knowledge/select-resource-answer.cjs').selectResourceAnswers(candidates,plan,{limit:2});
  }
  const partial=plan.operation&&results.length&&!results.some(row=>/点击|单击|双击|勾选|右键|按下|长按|依次|打开|进入|选择|输入/.test(row.text));
  const excerpt=row=>{
   if(plan.operation||plan.capabilityQuestion||!plan.terms.length)return row.text;
   const {resourceTermMatches}=require('../../domain/knowledge/resource-query.cjs');
   const lines=String(row.text).split('\n').map(text=>({text,score:plan.terms.filter(term=>resourceTermMatches(term,text)).length})).filter(line=>line.score&&/\d|支持|不支持/.test(line.text));
   const best=Math.max(0,...lines.map(line=>line.score));return best?lines.filter(line=>line.score===best).slice(0,3).map(line=>line.text).join('\n'):row.text;
  };
  return {...found,status:results.length?(partial?'partial':'answer'):'not-found',intent:fileRequest?'resources':plan.operation?'operation':'technical',results,queryPlan:plan,
   answerBasis:'sections-sql-bm25-vector',reply:results.length?(fileRequest?'找到以下资料，请核对型号和版本：\n'+results.map(row=>row.name).join('\n'):(partial?'找到相关说明，但本次尚未检索到具体操作步骤：\n':'')+results.map(row=>[row.name,excerpt(row)].filter(Boolean).join('\n')).join('\n\n')):'本次全文检索未找到对应内容，请补充型号或关键词。'};
 }
 return {search,answer};
}
module.exports={createSectionAnswers};
