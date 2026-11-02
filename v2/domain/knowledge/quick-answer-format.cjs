'use strict';
const {comparisonValue}=require('./comparison-value.cjs');
function literal(value){
 const meaning=comparisonValue(value.value,{conflict:value.conflict,recorded:value.meaning?.state!=='unknown'});
 return meaning.state==='unknown'?'资料未注明（原值：'+value.value+'）':meaning.state==='uninterpreted-symbol'?'原表符号“'+value.value+'”，含义待核对':value.conflict?value.value+'（来源冲突）':value.value;
}
function tableAnswer(evidence){
 const source=evidence[0],table=JSON.parse(source.text);
 const rows=table.rows;
 const compared=table.models.length>1?require('./comparison-answer.cjs').comparisonAnswer({intent:'comparison',decision:{action:'query-parameters',answerNeed:'parameter-overview'}},evidence):null;
 const reply=compared?.reply||rows.slice(0,12).map(row=>row.parameter+'：'+row.values.map(value=>value.model+'＝'+literal(value)).join('；')).join('\n');
 return {status:'answer',intent:table.models.length>1?'comparison':'product',reply:reply+'\n\n来源：产品速查表',
  results:[{name:'产品速查表',models:source.modelIds,text:reply,evidenceId:source.evidenceId,sourceKind:source.sourceKind}],parameterComparison:table,
  modelCallCount:0,retrievalBackend:'knowledge-table',answerBasis:'source-cell-values'};
}
function sqlAnswer(found){
 const results=found.results||[],faq=found.kind==='faq',empty=found.kind==='empty-points';
 const references=rows=>rows.map(r=>r.name+' / '+Object.values(r.locator||{}).join(' / ')).join('；');
 const descriptions=results.map(row=>{
  const value=row.unknown?'未注明（不能据此判断不支持）':row.value;
  return (row.models?.length?'适用型号：'+row.models.join('／')+'\n':'')+(faq?'参考问题：'+row.parameter+'\n解答：'+value:row.parameter+'：'+value)+(row.conditions?'\n条件／备注：'+row.conditions:'')+'\n来源：'+references([row]);
 });
 const caution=empty?'同一规格存在以下多组空点位置，需按实际模组核对，不能直接任选一组：\n':faq?'找到以下相关标准问答，请核对所列适用条件：\n':'';
 return {status:faq||empty?'partial':'answer',intent:faq?'faq':'product',reply:caution+descriptions.join('\n\n'),results,
  modelCallCount:0,retrievalBackend:found.retrievalBackend,answerBasis:faq?'faq-source-row':'parameter-source-cell'};
}
module.exports={literal,tableAnswer,sqlAnswer};
