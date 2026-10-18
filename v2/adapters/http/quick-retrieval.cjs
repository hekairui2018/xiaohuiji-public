'use strict';
const {parseQuickQuery,matchesConcept,concepts,norm}=require('../../domain/knowledge/quick-query.cjs');
const {extractKnownModels}=require('../../domain/identity/extract-models.cjs');
const {modelId}=require('../../domain/identity/model-id.cjs');
const {createQuickService}=require('./quick-service.cjs');
function createQuickRetrieval({app,knowledge,search,searchCases,localCatalog,resolveDocuments,localizeMedia=async x=>x,originalDocuments=[]}){
 const indexedProducts=new Map((knowledge?.products?.()||[]).map(p=>[p.modelId,p]));
 const lookup={findProducts:id=>knowledge?.findProducts?.(id)||(indexedProducts.has(id)?[indexedProducts.get(id)]:app?.quickSearch?.(id).records||[]),isSoftware:t=>!!app?.resourceMedia?.softwareItems(t).length};
 const quick=app&&createQuickService(app,{localCatalog,resolveDocuments});
 const originalByModel=new Map();for(const {document:d} of originalDocuments)for(const id of extractKnownModels(d.name,lookup)){if(!originalByModel.has(id))originalByModel.set(id,[]);originalByModel.get(id).push(d);}
 async function answer(message,{state={},facts={}}={}){
  const q=parseQuickQuery(message,lookup,state),trace=[],lists=[],failures=[];
  if(!q.social){if(!q.models.length&&facts.modelIds?.length)q.models=facts.modelIds.map(modelId).filter(m=>lookup.findProducts(m).length).slice(0,3);q.chips=[...new Set([...q.chips,...facts.chips||[]])];for(const [field,kind]of [['hardwareVersions','hardware'],['firmwareVersions','firmware'],['softwareVersions','software']])for(const value of facts[field]||[])q.versions.push({kind,value});}
  const base={intent:'retrieval',kind:'all',query:q.original,queryPlan:q,results:[],retrievalTrace:trace,modelCallCount:0};
  if(q.social)return {...base,intent:'social',reply:/谢|thanks/.test(q.original)?'不客气。':'你好！我可以查询产品参数、资料和历史售后案例，请告诉我型号或问题。'};
  const add=(source,rows)=>lists.push({source,rows:rows.slice(0,8)});
  async function call(name,fn){const at=Date.now();try{const rows=await fn();trace.push({name,elapsedMs:Date.now()-at,count:rows.length});return rows;}catch{failures.push(name);trace.push({name,elapsedMs:Date.now()-at,count:0,unavailable:true});return [];}}
  async function textSearch(query){const rows=await Promise.all((q.models.length?q.models.slice(0,3):[null]).map(model=>search(query,'text',{limit:8,model:model?.replace(/^HD-/,''),version:q.versions.find(v=>v.kind==='version')?.value})));return rows.flatMap(d=>d.results||[]).slice(0,16).map(r=>{const parts=(r.text||'').split(' | '),faq=/FAQ|FQA|常见问题|问答/i.test(r.name||'')&&parts.length>=3;return {...r,type:faq?'faq':'passage',...(faq?{standardQuestion:parts[1],standardAnswer:parts[2],faqExact:norm(q.original).replace(/[\s，。！？!?]/g,'')===norm(parts[1]).replace(/[\s，。！？!?]/g,'')}:{} )};});}
  // Structured catalog preparation is shared by all categories for a model.
  const products=quick?await call('exact-product-catalog',async()=>{const rows=await Promise.all(q.models.slice(0,3).map(async id=>({id,data:await localizeMedia(await quick.search(id))})));return rows.flatMap(({id,data})=>(data.results||[]).filter(p=>p.modelId===id));}):[];
  const wanted=q.categories.length?q.categories:['spec','manual','firmware'];
  for(const category of wanted){const docs=products.flatMap(p=>(p.docGroups||[]).filter(g=>g.key===category).flatMap(g=>g.items.map(d=>({...d,associatedModel:p.modelId,category}))));add('catalog',docs.map(d=>({type:'document',name:d.name,category,modelIds:[d.associatedModel],text:d.reviewRequired?'资料关联仍需核对现场条件。':null,download:d.available?d.url:null,downloadUrl:d.downloadUrl,sha256:d.sha256,evidenceId:d.sha256?'file-'+d.sha256:d.resourceVersionId,documentVersion:d.documentVersion,available:d.available,associationStatus:d.associationStatus,hardwareConfirmed:false})));}
  const claims=[];
  for(const id of q.models)for(const p of lookup.findProducts(id))for(const c of (q.attributes.length?p.claims||[]:[])){
   const refs=(c.sourceReferences||[c.sourceReference]).filter(r=>r?.originalSha256&&r.originalName&&r.verificationStatus==='verified');
   if(c.verificationStatus!=='verified'||!refs.length)continue;
   if(q.attributes.length&&!q.attributes.some(a=>matchesConcept(a,c.text)))continue;
   for(const ref of refs.slice(0,1))claims.push({type:'parameter',name:ref.originalName,text:c.text,modelIds:[id],evidenceId:c.claimId,sha256:ref.originalSha256,locator:ref.page?{page:ref.page}:ref.locator,download:'/v2/resources/original/'+ref.originalSha256,field:c.field,verified:true});
  }
  add('parameters',claims);
  if(q.attributes.length){const raw=[];for(const id of q.models)for(const d of (originalByModel.get(id)||[]).slice(0,3))for(const page of (d.pages||[]).slice(0,20)){
   const lines=page.text.split(/\n|(?<=[。；;])/).filter(t=>/\d/.test(t)&&q.attributes.some(a=>matchesConcept(a,t)));
   if(lines.length)raw.push({type:'parameter',name:d.name,sha256:d.sha256,modelIds:[id],text:lines.slice(0,3).join('\n'),locator:{page:page.page},evidenceId:d.sha256+'-page-'+page.page,field:'original-parameter-excerpt',verified:false});
  }
  const bounded=raw.slice(0,6);if(bounded.length&&resolveDocuments){const resolutions=await call('parameter-original-resolution',async()=>resolveDocuments(bounded));for(const [i,r]of bounded.entries())if(resolutions[i]?.available){r.download=resolutions[i].url;add('original-parameters',[r]);}}
  }
  // Source plans are hints, not a single business destination. Explicit document
  // requests may finish from the directory; ambiguous/fault inputs query both cases and text.
  const explicitDocs=q.categories.length&&!q.symptoms.length&&!q.attributes.length&&!q.compatibility;
  const tasks=[];
  if(!explicitDocs&&!q.deniedFault)tasks.push(call('case-index',async()=>{const data=await searchCases(q.query,null,{...facts,...(q.models.length?{modelIds:q.models}:{})});return (data.results||[]).map(r=>({...r,type:'case',name:r.title||r.phenomenon,text:r.sourceExcerpt||r.phenomenon,download:r.sources?.find(s=>s.original)?.original||'/v2/offline/case?id='+encodeURIComponent(r.id),sourceStatus:r.sources?.some(s=>s.original)?'registered-original':'indexed-case-record-not-original-file',evidenceId:r.id}));}).then(rows=>add('cases',rows)));
  if(quick&&q.categories.includes('software'))tasks.push(call('software-catalog',async()=>{const d=await quick.software(q.query);return (d.software?.items||[]).map(r=>({type:'document',category:'software',name:r.name,text:r.purpose,download:r.url||r.downloadUrl}));}).then(rows=>add('catalog',rows)));
  if(q.categories.includes('video'))tasks.push(call('video-catalog',async()=>{const d=await localizeMedia({video:{groups:[{videos:app?.resourceLookup?.(q.query)?.items||[]}]}});return (d.video?.groups||[]).flatMap(g=>g.videos||[]).map(r=>({type:'document',category:'video',name:r.name,download:r.publicUrl||r.url}));}).then(rows=>add('catalog',rows)));
  const goodCatalog=lists.some(l=>l.source==='catalog'&&l.rows.some(r=>r.available&&r.download));
  const searchTerms=q.symptoms.length?[...q.symptoms.map(id=>concepts.find(c=>c.id===id).words[0]),...(q.concepts.includes('wifi')?['Wi-Fi']:[])]:q.attributes.length?q.attributes.map(id=>concepts.find(c=>c.id===id).words[0]):q.categories.map(c=>({manual:'说明书',spec:'规格书',firmware:'固件',software:'软件',video:'视频'}[c]));
  const lexical=[...q.models.map(m=>m.replace(/^HD-/,'')),...searchTerms].join(' ')||q.query;
  if(!explicitDocs||!goodCatalog)tasks.push(call('fts5-primary',()=>textSearch(lexical)).then(rows=>add('text',rows)));
  await Promise.all(tasks);
  let ranked=rank(q,lists,lookup);
  // One bounded synonym retry, never dropping exact models/category/version constraints.
  if(!ranked.length&&!explicitDocs&&q.concepts.length){const alternate=[...q.models.map(m=>m.replace(/^HD-/,'')),...q.concepts.filter(id=>!['local','cable'].includes(id)).slice(0,3).map(id=>concepts.find(c=>c.id===id).words[1]||concepts.find(c=>c.id===id).words[0])].join(' ');if(alternate&&alternate!==lexical){const rows=await call('fts5-synonym',()=>textSearch(alternate));add('text-expanded',rows);ranked=rank(q,lists,lookup);}}
  const results=ranked.slice(0,4).map(({candidate,signals})=>({...candidate,rankingSignals:signals}));
  let reply=[];
  if(q.compatibility)reply.push('当前检索结果不能确认 '+q.models.join('、')+' 的固件通用或跨型号兼容。文件名相似、目录关联均不代表兼容依据，请勿据此互刷。');
  const parameter=results.filter(r=>r.type==='parameter'||r.type==='passage'&&q.attributes.length&&/\d/.test(r.text||'')&&/像素|万点|宽|高|pixels|width|height|control range|接口|网口|HDMI|USB|HUB75/i.test(r.text||''));
  if(q.attributes.length){if(parameter.length)reply.push(...parameter.map(r=>`${q.models.join('、')}：${r.text}\n来源：${r.name}${r.locator?' · '+JSON.stringify(r.locator):''}`));else reply.push('未找到能核验所问参数的结构字段或原文，不以文件名或未核验数值代替答案。');}
  if(parameter.length>1)reply.push('以上按各份资料原文分别列出；不同版次或语言的数值若不一致，不合并为统一参数，请核对所用设备和资料版次。');
  const cases=results.filter(r=>r.type==='case');
  if(cases.length){reply.push('以下为相关历史案例，适用型号、芯片、版本和现场条件仍需逐项核对，不是当前故障的确定原因。');for(const r of cases)reply.push(`${r.name}\n适用条件：${JSON.stringify({models:r.modelIds||[],...r.scope})}\n历史记录：${r.historicalMeasure||r.text}\n来源：${(r.sources||[]).map(s=>s.name+(s.locator?' · '+JSON.stringify(s.locator):'')).join('；')||'已有案例索引'}`);}
  const docs=results.filter(r=>r.type==='document');if(docs.length)reply.push('找到对应资料：'+docs.map(r=>r.name+(r.documentVersion?'（'+r.documentVersion+'）':'')).join('；')+'。文件关联不代表固件适用或兼容确认。');
  if(results.some(r=>r.type==='passage')&&!q.attributes.length)reply.push('找到相关原文片段，请核对原文及适用条件；关键词命中不等于已确认结论。');
  for(const r of results.filter(r=>r.type==='faq'))reply.push(`${r.faqExact?'已有FAQ标准答案（原问题完全匹配）':'FAQ原记录（适用条件待核对）'}：${r.standardQuestion}\n${r.standardAnswer}\n来源：${r.name}${r.locator?' · '+JSON.stringify(r.locator):''}`);
  if(!results.length)reply.push(q.categories.length?'未找到满足准确型号和资料类别约束的已确认资料，不会用其他类别冒充。':'未找到足够相关的公司资料。请补充准确型号或现场条件，复杂描述可使用专家模式。');
  if(q.contextUsed)reply.unshift('沿用上一轮问题作为检索线索；本次反馈不代表故障原因已排除。');
  if(q.versions.length)reply.push('已保留版本约束；资料版次不等于硬件版本或固件兼容确认。');
  if(failures.length)reply.push('部分资料来源暂不可用，本次未检索到不代表资料不存在。');
  return {...base,kind:results.length&&results.every(r=>r.type==='case')?'cases':'all',status:results.length?'answer':'not-found',reply:reply.join('\n\n'),results,sourceFailures:failures,sourceAvailability:{faq:'复用已索引FAQ/FQA表格原文；只有带问题/答案列且原问题完全匹配才直出标准答案，其余是条件待核对的原记录'},candidateCount:lists.reduce((n,l)=>n+l.rows.length,0),retrievalPolicy:'bounded-multisource; exact-identities; calibrated-signals-and-rrf'};
 }
 return {answer};
}
function rank(q,lists,lookup){
 const merged=new Map();
 for(const list of lists)for(const [i,r]of list.rows.entries()){
  const title=r.name||'',body=r.text||'',all=title+' '+body,named=[...new Set([...(r.modelIds||[]),...extractKnownModels(all,lookup)])];
  const titleModels=extractKnownModels(title,lookup);if(q.models.length&&r.type!=='case'&&titleModels.length&&!q.models.some(m=>titleModels.includes(m)))continue;
  const modelMatch=q.models.filter(m=>named.includes(m));
  // Cases without an asserted model remain explicitly conditional; a different
  // asserted model is a conflict. Documents/parameters require exact identities.
  if(q.models.length&&(named.length&&!modelMatch.length||r.type!=='case'&&!modelMatch.length))continue;
  if(q.unknownModels.length)continue;
  if(q.categories.length&&!q.compatibility&&!q.symptoms.length){if(r.type==='case')continue;const cat=r.category||(/说明书|手册|manual/i.test(title)?'manual':/规格书|specification|datasheet/i.test(title)?'spec':/\.bin\b|固件/i.test(title)?'firmware':null);if(!q.categories.includes(cat))continue;}
  if(q.deniedFault&&r.type==='case')continue;
  if(q.versions.length&&!q.versions.every(v=>{const known=v.kind==='hardware'?r.scope?.hardwareVersions||[]:v.kind==='firmware'?r.scope?.firmwareVersions||[]:v.kind==='software'?r.scope?.softwareVersions||[]:[...(r.versions||[]),r.documentVersion].filter(Boolean);return known.some(x=>norm(x).replace(/^v/,'')===norm(v.value).replace(/^v/,''));}))continue;
  if(q.chips.length&&r.scope?.chips?.length&&!q.chips.some(c=>r.scope.chips.some(k=>norm(k)===norm(c))))continue;
  const core=q.symptoms.length?[...q.symptoms,...(q.concepts.includes('wifi')?['wifi']:[])]:q.attributes.length?q.attributes:q.concepts.filter(id=>!['local','cable'].includes(id));
  const matched=core.filter(id=>matchesConcept(id,all)),titleHits=core.filter(id=>matchesConcept(id,title));
  const literalHits=q.literals.filter(w=>norm(all).includes(norm(w)));
  // Specific discovery + wifi is a conjunction, not a generic network match.
  if(core.includes('wifi')&&core.includes('discovery')&&q.discoveryTarget!=='device'){
   const focus=norm(r.type==='case'?r.phenomenon:body);
   const discovery=/(?:wifi|无线|ssid|热点)[^。\n；]{0,12}(?:搜不到|搜索不到|无法搜索|找不到|不广播)|(?:搜不到|搜索不到|无法搜索|找不到|不广播)[^。\n；]{0,12}(?:wifi|无线|ssid|热点)/.test(focus);
   if(!discovery||/(?:搜不到|找不到|无法找到)设备|控制卡(?:无法|搜索不到|搜不到)[^。\n；]{0,6}wifi|连接上wifi|wifi正常|wifi连接正常|已连接wifi|连接wifi正常|(?:wifi|热点)[^。\n；]{0,20}(?:连接上|已连接|连接正常)/.test(focus))continue;
  }
  if(core.length&&!matched.length)continue;
  if(r.type!=='parameter'&&core.length>1&&matched.length<Math.ceil(core.length*0.75))continue;
  if(!core.length&&!q.models.length&&literalHits.length<2&&!q.literals.some(w=>w.length>=4&&norm(all).includes(norm(w))))continue;
  if(q.attributes.length&&r.type==='passage'&&!matched.length)continue;
  if(r.type==='document'&&!r.download)continue;
  if(q.compatibility&&r.type==='case'&&!/兼容|通用|互刷/.test(all))continue;
  if(q.compatibility&&r.type==='passage'&&!/兼容|通用|互刷|firmware|固件/i.test(body))continue;
  const key=r.evidenceId||r.sha256||r.download||JSON.stringify([title,body]);
  const signals={exactModel:modelMatch.length,modelUnknown:r.type==='case'&&!named.length,coverage:core.length?matched.length/core.length:0,titleMatches:titleHits.length,categoryMatch:q.categories.includes(r.category),structured:r.type==='parameter',matchedConcepts:matched,literalMatches:literalHits};
  const score=modelMatch.length*12+(signals.structured?12:0)+signals.coverage*10+titleHits.length*2+(signals.categoryMatch?8:0)+literalHits.length+(r.type==='case'&&q.symptoms.length?5:0)+(r.faqExact?20:0);
  const existing=merged.get(key);if(existing){existing.rrf+=1/(60+i+1);existing.sources.add(list.source);}else merged.set(key,{candidate:r,signals,score,rrf:1/(60+i+1),sources:new Set([list.source])});
 }
 return [...merged.values()].sort((a,b)=>b.score-a.score||b.rrf-a.rrf||a.candidate.name.localeCompare(b.candidate.name));
}
module.exports={createQuickRetrieval,rank};
