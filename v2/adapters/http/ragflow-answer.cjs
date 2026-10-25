'use strict';
const {parseQuickQuery,matchesConcept}=require('../../domain/knowledge/quick-query.cjs');
function taskExcerpt(text,q){
 const terms=[...q.operation?.terms||[],...q.literals||[]].map(s=>String(s).replace(/\s/g,'').toLowerCase()).filter(s=>s.length>=2&&!/^(?:操作|设置|软件|使用|支持)$/.test(s));
 const headings=[...String(text).matchAll(/^[ \t]*(\d+(?:[.]\d+)*)(?:[.、．])?[ \t]*([^\n]{2,50})$/gm)].map(m=>({start:m.index,title:m[2],level:m[1].split('.').length}));
 const options=headings.map((h,i)=>({...h,index:i,score:terms.filter(t=>h.title.replace(/\s/g,'').toLowerCase().includes(t)).length})).filter(h=>h.score).sort((a,b)=>b.score-a.score||a.start-b.start);
 const selected=options[0];if(!selected)return text;
 const next=headings.slice(selected.index+1).find(h=>h.level<=selected.level);
 return text.slice(selected.start,next?.start??text.length).trim();
}
function createRagflowAnswers({source,knowledge,lookup=knowledge,clean=s=>s,catalog=null}={}){
 async function retrieve(message,{state={},signal,kind,models,documents}={}){
  const q=parseQuickQuery(message,lookup,state);
  if(q.social||q.intent==='ordering'||q.unknownModels?.length||q.ambiguous)return {q,results:[],skipped:true};
  const scopes=models?.length?models:q.models||[],results=[];
  const query=q.answerQuestion||q.interpretation?.query||message;
  const softwareNames=['HDPlayer','HDSet','HD2018','HD2020','HDShow','HDSign','LCDPlayer','屏掌控','小灰云'];
  const key=s=>String(s).normalize('NFKC').replace(/[\s_-]/g,'').toLowerCase();
  const software=[...new Set([...(q.software||[]),...softwareNames.filter(name=>key(query).includes(key(name)))])];
  for(const model of scopes.length?scopes:[null]){
   const r=await source.search(query,{models:model?[model]:[],documents:documents||[],software,kind:kind||q.intent,signal,limit:scopes.length>1?4:6});results.push(...r.results);
   if(q.intent==='parameters'&&q.attributes?.includes('load')&&model){const extra=await source.search(model+' 最大控制 带载 输出',{models:[model],documents:documents||[],software,kind:'parameters',signal,limit:6});results.push(...extra.results);}
  }
  let selected=[...new Map(results.map(r=>[r.evidenceId,r])).values()];
  if(q.intent==='parameters'&&q.attributes?.includes('load')){const score=r=>/最大控制\s*\d|最大带载|整机.{0,8}带载|单机.{0,8}带载|带载范围/.test(r.text)?3:/每.{0,5}网口.{0,8}(?:控制|带载)/.test(r.text)?1:0;selected.sort((a,b)=>score(b)-score(a));}
  return {q,results:selected};
 }
 async function quick(message,options={}){
  const {q,results,skipped}=await retrieve(message,options);
  if(catalog&&['resources','files','firmware'].includes(q.intent)&&!q.unknownModels?.length){const files=catalog.search(message);if(files.length)return {status:'answer',intent:q.intent,reply:'找到以下文件登记（目录和文件名不代表固件兼容性）：\n'+files.slice(0,10).map(r=>r.name+'\n目录：'+r.directory).join('\n\n')+'\n原件下载尚未接入此索引；可按目录核对。',results:files,modelCallCount:0,answerBasis:'drive-file-metadata'};}
  if(skipped||!results.length||!['parameters','operation','technical','software-function'].includes(q.intent))return null;
  let rows=results;
  if(q.intent==='operation')rows=results.map(r=>({...r,text:taskExcerpt(r.text,q)}));
  if(q.intent==='parameters'){
   const attrs=q.attributes||[];
   if(!attrs.length)return null;
   rows=results.map(r=>{const lines=r.text.split(/\n|(?<=[。；;])/).filter(line=>attrs.some(a=>a==='load'?/带载|控制范围|最大控制\s*\d|\d\s*万(?:点|像素)/.test(line)&&!/输入.{0,12}(?:分辨率|像素)|像素时钟/.test(line):matchesConcept(a,line)));return {...r,text:[...new Set(lines)].slice(0,5).join('\n')};}).filter(r=>r.text);
   if(!attrs.every(a=>rows.some(r=>matchesConcept(a,r.text)))||q.models.some(m=>!rows.some(r=>r.modelIds.includes(m))))return null;
  }
  rows=rows.slice(0,q.models.length>1?6:2).map(r=>({...r,text:clean(r.text)}));
  const seen=new Set();rows=rows.filter(r=>{const k=r.name+'|'+r.text;if(seen.has(k))return false;seen.add(k);return true;});
  const operation=q.intent==='operation';
  return {status:'answer',intent:q.intent,reply:(operation?'以下是匹配资料的相关原文；操作前后步骤及图示尚需核对：\n':'')+rows.map(r=>r.text.slice(0,operation?1300:650)+'\n来源：'+r.name+(r.locator?.page?' · 第'+r.locator.page+'页':'')).join('\n\n'),results:rows,actualMode:'quick',modelCallCount:0,answerBasis:'ragflow-original-excerpt',evidenceSummary:{outcome:'partial',evidenceCount:rows.length,completeUnits:0},quickContext:{query:message,intent:q.intent,models:q.models,software:q.software}};
 }
 return {retrieve,quick};
}
module.exports={createRagflowAnswers,taskExcerpt};
