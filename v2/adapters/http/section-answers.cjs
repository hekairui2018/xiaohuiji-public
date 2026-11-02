'use strict';
// Both question modes use the same fulltext backend. No secondary source fallback.
function createSectionAnswers(sectionSearch){
 async function search(query,options){
  if(!sectionSearch)throw Error('fulltext-not-configured');
  return sectionSearch.search(query,options);
 }
 async function answer(query,options){
  const found=await search(query,options),results=(found.results||[]).slice(0,3);
  return {...found,status:results.length?'answer':'not-found',intent:'technical',results,
   answerBasis:'sections-sql-bm25-vector',reply:results.length?results.map(row=>[row.name,row.text].filter(Boolean).join('\n')).join('\n\n'):'本次全文检索未找到对应内容，请补充型号或关键词。'};
 }
 return {search,answer};
}
module.exports={createSectionAnswers};
