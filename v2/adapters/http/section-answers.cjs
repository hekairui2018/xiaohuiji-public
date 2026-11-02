'use strict';
// Quick mode shares the existing file registry and section index. It owns no cases or calculator.
const {planResourceQuery,resourceTermMatches}=require('../../domain/knowledge/resource-query.cjs');
const {selectResourceAnswers}=require('../../domain/knowledge/select-resource-answer.cjs');
const {tableAnswer,sqlAnswer}=require('../../domain/knowledge/quick-answer-format.cjs');
const {operationContext,operationScope,videoRelevance,procedureTarget,procedureComplete,operationExcerpt,registeredModels}=require('../../domain/knowledge/quick-operation-context.cjs');
const dedupe=rows=>[...new Map(rows.map(r=>[r.sha256||r.fileId||r.download||r.name,r])).values()];
const procedurePlan=plan=>({...plan,operation:true,answerNeed:'procedure',documentContent:true,terms:plan.terms.filter(t=>!/^(?:哪|何|怎|咋)/.test(t))});
function createSectionAnswers(sectionSearch,{materials=null,chipLookup=null}={}){
 const models=[...new Set([...registeredModels,...(materials?.data?.records||[]).filter(r=>r.kind==='comparison').map(r=>r.model)])];
 async function search(query,options){if(!sectionSearch)throw Error('fulltext-not-configured');return sectionSearch.search(query,options);}
 async function structured(query,kind,plan){
  if(!sectionSearch?.knowledge)return null;
  return sectionSearch.knowledge(query,{kind,models:plan.models,focus:plan.terms,software:operationContext(query,plan).software,unknown:plan.unknownModels});
 }
 async function answer(query,options){
  let plan=planResourceQuery(query,{models});
  if(plan.social)return {status:'answer',intent:'social',reply:/谢/.test(query)?'不客气，有需要继续问。':'你好！告诉我型号，以及想查的参数、资料或操作。',results:[],modelCallCount:0,answerBasis:'deterministic-social'};
  const decide=require('../../domain/parser/chat-intent.cjs').decideAction;
  const semantic=decide(query,{models:plan.models,software:plan.software});
  const how=semantic.intent!=='aftersales'&&(plan.operation||/怎么|如何|怎样|在哪.{0,5}(?:改|设|调|找)|哪里.{0,5}(?:改|设|调|找)/.test(query));
  const literalExtension=/\.(mp4|webm|mov|bin|ssr|ssx|exe|msi|apk)(?=\s|$)/i.exec(query)?.[1].toLowerCase();
  if(literalExtension)plan={...plan,categories:[/mp4|webm|mov/.test(literalExtension)?'video':literalExtension==='bin'?'firmware':/exe|msi|apk/.test(literalExtension)?'software':'module-config']};
  const fileRequest=semantic.intent!=='aftersales'&&['resource','resource-candidates'].includes(plan.answerNeed)&&!plan.documentContent&&!/怎么|如何|怎样/.test(query);
  if(fileRequest){
   if(!sectionSearch?.registry)throw Error('file-registry-not-configured');
   const found=await sectionSearch.registry(query,{limit:20});
   let rows=dedupe(found.results||[]).filter(r=>!plan.categories.length||!r.kind||plan.categories.includes(r.kind));
   if(plan.unknownModels.length)rows=rows.filter(r=>plan.unknownModels.every(m=>(r.name+' '+(r.models||[]).join(' ')).toUpperCase().includes(m.toUpperCase().replace(/^HD-/,''))));
   if(plan.categories.includes('firmware')&&chipLookup){
    const chip=chipLookup(query,plan.models.map(modelId=>({modelId})));
    if(chip){const eligible=new Set((chip.files||[]).map(f=>f.file||f.name));rows=rows.filter(r=>eligible.has(r.name));}
   }
   const exact=rows.filter(r=>r.queryMatch?.exact!==false);if(exact.length)rows=exact;rows=rows.slice(0,3);
   const approximate=rows.some(r=>r.queryMatch?.exact===false);
   return {...found,status:rows.length?'answer':'not-found',intent:'resources',results:rows,queryPlan:plan,modelCallCount:0,answerBasis:'file-registry-columns',
    reply:rows.length?(approximate?'未找到所有条件一致的文件，以下仅为相近候选，请核对差异：\n':'找到以下资料，请核对型号和版本：\n')+rows.map(r=>r.name).join('\n'):'未找到对应文件。请核对完整型号、版本或文件名。'};
  }
  if(how)plan=procedurePlan(plan);
  let faq=null;
  if(semantic.intent!=='parameters'){
   faq=await structured(query,'faq',plan);
   const exact=faq?.results?.filter(row=>row.exactQuestion);
   if(exact?.length)return {...sqlAnswer({...faq,results:exact}),intent:how?'operation':'faq',queryPlan:plan};
  }
  if(semantic.intent!=='aftersales'&&chipLookup&&(!how||/选|译码|智能设置/.test(query))){
   const chip=chipLookup(query,plan.models.map(modelId=>({modelId})));
   if(chip){
    const decoder=chip.items.every(r=>r.page===11)||chip.view?.primary?.isDecoder;
    const facts=decoder?[{label:'类型',text:'译码'},{label:'HDSet译码选择或替代项',text:chip.items.map(r=>r.models.join('／')+'：'+r.smartSelection).join('；')}]:chip.view.primary.facts;
    const reply=chip.view.primary.chip+'\n'+facts.map(f=>f.label+'：'+f.text).join('\n')+'\n来源：'+chip.view.source+(decoder?'\n替代项指软件中的译码选择，不代表实体芯片或固件可以互换。':'');
    return {status:'answer',intent:'chips',reply,results:[{name:chip.view.source,text:reply,sourceKind:'chip-mapping-original',models:chip.items.flatMap(r=>r.models)}],modelCallCount:0,answerBasis:'registered-chip-relations'};
   }
  }
  if(!how&&semantic.intent!=='aftersales'&&materials){
   const evidence=materials.evidence(query,{targetedOnly:true}).filter(e=>e.sourceKind==='structured-comparison-original');
   if(evidence.length){
    const table=JSON.parse(evidence[0].text),usable=table.rows.some(r=>r.values.some(v=>v.meaning?.state!=='unknown'))&&(table.models.length>1||plan.overview||plan.parameterOverview||plan.terms.some(t=>table.rows.some(r=>resourceTermMatches(t,r.parameter)||r.values.some(v=>resourceTermMatches(t,v.value)))));
    if(usable)return {...tableAnswer(evidence),queryPlan:plan};
   }
  }
  const empty=/空点|空灯|缺点位置/.test(query);
  if(!how&&semantic.intent!=='aftersales'||empty){
   const found=await structured(query,empty?'empty-points':'parameter',plan);
   if(found?.results?.some(r=>!r.unknown))return {...sqlAnswer(found),queryPlan:plan};
  }
  faq=faq||await structured(query,'faq',plan);
  if(faq?.results?.length){
   faq.results=faq.results.filter(row=>semantic.intent!=='operation'||decide(row.parameter,{models:row.models||[]}).intent==='operation').slice(0,3);
   if(faq.results.length)return {...sqlAnswer(faq),intent:how?'operation':'faq',queryPlan:plan};
  }
  if(plan.unknownModels.length)return {status:'not-found',intent:'technical',reply:'当前资料尚未确认 '+plan.unknownModels.join('、')+' 的对应内容，请核对完整型号或版本。',results:[],modelCallCount:0,answerBasis:'unresolved-identity'};
  let found=await search(query,options);
  plan=planResourceQuery(query,{models:[...new Set([...models,...(found.results||[]).flatMap(r=>r.models||[])])]});
  if(how)plan=procedurePlan(plan);
  const context=how?operationContext(query,plan):{queries:[query],software:[],example:false};
  // Local playback software calls programme publication “发送”. Cloud
  // publication and sending other objects retain their separate meanings.
  const softwareFocus=['HDPlayer','屏掌控'].some(s=>context.software.includes(s))?(context.focus||plan.focus).replace(/(?:发布|发送)节目/g,'发送节目 节目更新'):(context.focus||plan.focus);
  const sources=[found];
  if(how&&context.software.length&&sectionSearch.softwareSections)sources.push(await sectionSearch.softwareSections(context.software.join(' ')+' '+softwareFocus,{software:context.software}));
  if(how)for(const expanded of context.queries.slice(1))sources.push(await search(expanded,options));
  if(how&&sectionSearch.registry)for(const software of context.software)sources.push(await sectionSearch.registry(software+' '+(plan.focus||plan.terms.join(' '))+' 操作视频',{limit:50}));
  const all=[...new Map(sources.flatMap(s=>s.results||[]).map(r=>[r.evidenceId||(r.fileId||r.name)+'|'+JSON.stringify(r.locator)+'|'+r.text,r])).values()].filter(row=>!how||operationScope(row,context,plan));
  let candidates=all.filter(r=>!r.kind||['spec','manual','document'].includes(r.kind));
  if(how)candidates=candidates.map(row=>({...row,text:operationExcerpt(row.text,row.attributes?.subjectType==='software'?planResourceQuery(softwareFocus,{models}):plan)}));
  const target=how?procedureTarget(query,plan):null;
  if(how)candidates=candidates.filter(r=>r.kind!=='spec'||procedureComplete(r.text,target));
  if(target?.steps.length){
   const supported=candidates.filter(r=>procedureComplete(r.text,target));
   if(supported.length)candidates=supported;
  }
  const selectionPlan=how&&context.example?procedurePlan(planResourceQuery(context.queries.at(-1),{models})):plan;
  let results=selectResourceAnswers(candidates,selectionPlan,{limit:2});
  const softwareCandidates=candidates.filter(r=>r.attributes?.subjectType==='software');
  if(how&&softwareCandidates.length){
   const softwarePlan=procedurePlan(planResourceQuery(context.software.join(' ')+' '+softwareFocus,{models}));
   const headingScore=row=>softwarePlan.terms.filter(t=>resourceTermMatches(t,String(row.text).split('\n')[0])).length;
   const bestHeading=Math.max(...softwareCandidates.map(headingScore));
   const selected=selectResourceAnswers(bestHeading?softwareCandidates.filter(r=>headingScore(r)===bestHeading):softwareCandidates,softwarePlan,{limit:2});
   if(selected.length){results=selected;context.example=false;context.softwareManual=true;}
  }
  if(how&&context.software.length&&!context.softwareManual){
   const common=candidates.filter(r=>context.software.some(s=>(r.name+' '+r.text).toLowerCase().includes(s.toLowerCase())));
   const softwarePlan=procedurePlan(planResourceQuery(context.software[0]+' '+(plan.focus||plan.terms.join(' ')),{models}));
   results=dedupe([...results,...selectResourceAnswers(common,softwarePlan,{limit:2})]).slice(0,2);
  }
  // A procedure needs its entry and surrounding steps, not only the shortest
  // keyword-bearing sentence. Keep the existing section as the evidence unit.
  if(how)results=results.map(row=>{const original=candidates.find(r=>r.evidenceId? r.evidenceId===row.evidenceId:r.name===row.name&&r.sha256===row.sha256);return original?{...row,text:original.text,locator:original.locator}:row;});
  if(how)results=results.map(row=>({...row,text:operationExcerpt(row.text,plan)}));
  const videos=how?dedupe(all.filter(r=>r.kind==='video')).map(r=>({row:r,score:videoRelevance(r,plan,context)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,2).map(r=>r.row):[];
  const partial=how&&results.length&&!results.some(r=>procedureComplete(r.text,target));
  const excerpt=row=>{
   if(how||plan.capabilityQuestion||!plan.terms.length)return row.text;
   const lines=String(row.text).split('\n').map(text=>({text,score:plan.terms.filter(term=>resourceTermMatches(term,text)).length})).filter(line=>line.score&&/\d|支持|不支持/.test(line.text));
   const best=Math.max(0,...lines.map(line=>line.score));return best?lines.filter(line=>line.score===best).slice(0,3).map(line=>line.text).join('\n'):row.text;
  };
  const example=context.mobileReference?'以下为手机软件的操作参考，请先核对设备型号是否支持该软件与连接方式：\n':context.example?'未指定设备型号，以下提供相关设备手册的操作示例，请先核对设备与软件适用情况：\n':'';
  const reply=results.length?example+(partial?'找到相关说明，但本次尚未检索到完整操作步骤：\n':'')+results.map(r=>'原文件：'+r.name+'\n'+excerpt(r)).join('\n\n'):videos.length?'找到相关操作视频，请选择适用教程。':'本次未找到足够的对应内容'+(plan.models.length?'（已识别型号：'+plan.models.join('、')+'）':'')+'。';
  return {...found,status:results.length?(partial?'partial':'answer'):videos.length?'partial':'not-found',intent:how?'operation':'technical',results:[...results,...videos],queryPlan:plan,modelCallCount:0,answerBasis:'sections-sql-bm25-vector',reply};
 }
 return {search,answer};
}
module.exports={createSectionAnswers};
