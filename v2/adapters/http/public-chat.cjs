'use strict';
// A public adapter for the existing router/expert, with no internal index or session provider.
const {randomUUID,randomInt}=require('node:crypto');
const {createQuickRetrieval}=require('./quick-retrieval.cjs');
const {parseQuickQuery,matchesConcept}=require('../../domain/knowledge/quick-query.cjs');
const {sourceLocation}=require('../../domain/knowledge/answer-guidance.cjs');
const {extractKnownModels}=require('../../domain/identity/extract-models.cjs');
const {buildEvidencePacket}=require('../../domain/knowledge/evidence-packet.cjs');
function createPublicChat({app,knowledge,catalog,expert,verifiedDocuments=[],evidenceSource=null,answerSource=null}){
 const verifiedRead=Symbol('public-context-read');
 const approved=new Map(catalog.approvedResources().map(r=>[r.name,r]));
 const hashes=new Map(verifiedDocuments.map(r=>[r.name,r.sha256]));
 const restricted=d=>require('../../domain/knowledge/resource-access.cjs').accessInfo(d,[d]).accessRestricted;
 const sourceDocuments=knowledge.evidenceDocuments?.()||[],sourceProducts=app.quickBrowse();
 const deniedNames=new Set([...sourceDocuments.map(r=>r.document),...sourceProducts.flatMap(p=>p.documents||[])].filter(restricted).map(d=>d.name));
 const allowed=(name,hash)=>approved.has(name)&&!deniedNames.has(name)&&hashes.get(name)===hash&&/^[a-f0-9]{64}$/.test(hash||'');
 // Approval is a content identity, never a cached five-minute OSS signature.
 const urlFor=name=>{if(!approved.has(name))return null;return catalog.transform({name,url:''})?.url||catalog.approvedResources().find(r=>r.name===name)?.url||null;};
 const originals=sourceDocuments.filter(({document:d})=>allowed(d.name,d.sha256)&&!restricted(d));
 const originalNames=new Set(originals.map(({document:d})=>d.name));
 const structuredScope=()=>verifiedDocuments.filter(r=>allowed(r.name,r.sha256));
 const readableNames=new Set([...originalNames,...(evidenceSource?structuredScope().filter(r=>/\.(pdf|docx?)$/i.test(r.name)).map(r=>r.name):[])]);
 const reference=r=>r&&originalNames.has(r.originalName)&&allowed(r.originalName,r.originalSha256);
 const products=sourceProducts.map(p=>({modelId:p.modelId,displayName:p.displayName,aliases:p.aliases||[],parameters:{},documentCategory:p.documentCategory,
  documents:(p.documents||[]).filter(d=>allowed(d.name,d.sha256||hashes.get(d.name))&&!restricted(d)).map(d=>({name:d.name,sha256:d.sha256||hashes.get(d.name),kind:d.kind,url:null})),firmware:[],
  claims:(p.claims||[]).filter(c=>(c.sourceReferences||[c.sourceReference]).some(reference)).map(c=>({...c,sourceReferences:(c.sourceReferences||[c.sourceReference]).filter(reference),sourceReference:(c.sourceReferences||[c.sourceReference]).find(reference)}))
 })).filter(p=>p.documents.length||p.claims.length);
 // Approved current filenames can register an identity even when the older
 // product snapshot has not imported it. Metadata never supplies parameters.
 if(evidenceSource)for(const d of structuredScope()){
  if(!/规格书|specification|datasheet/i.test(d.name))continue;
  const token=d.name.match(/^(?:HD[-_ ]?)?([A-Z]{1,6}\d[A-Z0-9+_-]*(?:[ ]+(?:Pro|Plus|Max))?)(?=[ _]*(?:规格书|Specification|datasheet))/i)?.[1];
  if(!token)continue;const id=require('../../domain/identity/model-id.cjs').modelId(token);
  if(!id)continue;let p=products.find(p=>p.modelId===id);
  if(!p){p={modelId:id,displayName:id,aliases:[],parameters:{},documents:[],firmware:[],claims:[]};products.push(p);}
  if(!p.documents.some(x=>x.name===d.name))p.documents.push({name:d.name,sha256:d.sha256,kind:'spec'});
 }
 const normalize=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
 const findProducts=q=>products.filter(p=>[p.modelId,p.displayName,...p.aliases].some(a=>normalize(a)===normalize(q)));
 const publicKnowledge={products:()=>products,findProducts};
 const softwareNames=['HDPlayer','HDSet','HDShow','HDSign','HD2020','HD2018','LCDPlayer','小灰云','屏掌控单色版','屏掌控'].filter(s=>[...approved.keys()].some(n=>n.toLowerCase().includes(s.toLowerCase())));
 const softwareItems=text=>softwareNames.filter(s=>!text||String(text).replace(/\s/g,'').toLowerCase().includes(s.toLowerCase())).filter(s=>!text||s!=='屏掌控'||!String(text).includes('屏掌控单色版')).map(name=>{const installer=structuredScope().find(r=>/\.(exe|msi|apk|zip)$/i.test(r.name)&&r.name.toLowerCase().includes(name.toLowerCase()));const matches=r=>r.name.toLowerCase().replace(/\s/g,'').includes(name.toLowerCase());const manuals=structuredScope().filter(r=>matches(r)&&/\.(?:pdf|docx?)$/i.test(r.name)&&/手册|说明|manual/i.test(r.name)).map(r=>({name:r.name,sha256:r.sha256,url:urlFor(r.name)}));const videos=structuredScope().filter(r=>matches(r)&&/\.(mp4|webm|mov)$/i.test(r.name)).map(r=>({name:r.name,sha256:r.sha256,url:urlFor(r.name)}));return {name,sourceName:installer?.name,sha256:installer?.sha256,url:installer?urlFor(installer.name):null,manuals,videos};});
 const scoped={quickBrowse:()=>products,quickSearch:q=>({records:q?findProducts(q):products}),quickResources:()=>({}),chipLookup:()=>null,
  resourceMedia:{softwareItems,videoCategory:()=>({groups:[],topicGroups:[],total:0})},resourceLookup:()=>({items:[]})};
 const lookup={...publicKnowledge,chipLookup:()=>null,softwareItems,isSoftware:text=>softwareItems(text).length>0};
 const pages=originals.flatMap(({document:d})=>(d.pages||[]).filter(p=>typeof p.text==='string'&&p.text.length).map(p=>({name:d.name,sha256:d.sha256,text:p.text,locator:{page:p.page},modelIds:extractKnownModels(d.name,lookup),evidenceId:d.sha256+'-public-page-'+p.page})));
 const evidenceById=new Map(pages.map((r,i)=>[i+1,{...r,blockId:i+1}]));
 // Indexed claims are search previews. Reading always returns the verified original page.
 const claimEvidence=products.flatMap(p=>p.claims.flatMap(c=>(c.sourceReferences||[]).map(r=>({name:r.originalName,sha256:r.originalSha256,text:c.text,
  locator:r.page?{page:r.page}:null,modelIds:[p.modelId],evidenceId:r.originalSha256+'-public-claim-'+p.modelId+'-'+c.claimId,
  blockId:[...evidenceById.values()].find(page=>page.name===r.originalName&&(!r.page||page.locator.page===r.page))?.blockId})))).filter(r=>r.blockId&&originalNames.has(r.name));
 async function search(query,kind,options={}){
  const q=parseQuickQuery(query,lookup),models=options.models?options.models.map(normalize):options.model?[normalize(options.model)]:q.models.map(normalize);
  if(evidenceSource){
   const fileRole=['files','resources'].includes(kind)&&q.categories?.length===1&&['video','firmware','software'].includes(q.categories[0])?q.categories[0]:null;
   const data=await evidenceSource.search(query,kind,{...options,...(fileRole&&!options.role?{role:fileRole}:{}),models,authorizedDocuments:structuredScope()});
   const references=answerSource&&q.intent==='aftersales'&&kind==='text'&&!options.role?await answerSource.search(query,'cases',{models,chips:q.chips}):{results:[]};
   const ranked=require('../../domain/knowledge/answer-evidence.cjs').rankAnswerEvidence((data.results||[]).filter(r=>allowed(r.name,r.sha256)&&require('../../domain/knowledge/question-requirements.cjs').meetsRequirements(r,{...q,intent:kind==='products'?'parameters':options.role==='operation'?'operation':q.intent,original:options.question||query}).accepted),{intent:kind==='products'?'parameters':options.role==='operation'?'operation':q.intent,attributes:q.attributes||[],concepts:options.concepts||q.concepts||[],question:options.question||query});
   return {...data,results:[...ranked.map(r=>({...r,download:urlFor(r.name)})),...references.results]};
  }
  const words=query.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/gi)||[];
  const source=kind==='products'?[...claimEvidence,...evidenceById.values()]:[...evidenceById.values()];
  const results=source.filter(r=>(!models.length||r.modelIds.some(m=>models.includes(normalize(m))))&&(!options.documents||options.documents.includes(r.name)))
   .map(r=>({r,score:q.concepts.filter(c=>matchesConcept(c,r.text)).length*10+words.filter(w=>normalize(r.name+' '+r.text).includes(normalize(w))).length}))
   .filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.min(options.limit||24,24)).map(x=>x.r);
  return {results:[...new Map(results.map(r=>[r.evidenceId,{...r,download:urlFor(r.name)}])).values()]};
 }
 const orderingAnswer=app.orderingReferences&&app.understandInput?require('./quick-answer.cjs').createQuickAnswer({app,knowledge:publicKnowledge,search}).answer:null;
 const retrieval=createQuickRetrieval({app:scoped,knowledge:publicKnowledge,search,...(orderingAnswer?{businessAnswer:orderingAnswer}:{}),documentPolicy:documents=>require('../../domain/knowledge/document-versions.cjs').selectDocumentVersions(documents,{includeSigned:true}),searchCases:async()=>({results:[]}),
  ...(evidenceSource?{
   localCatalog:async()=>structuredScope().map(r=>({...r,availabilityState:'present',folders:[r.publicDirectory].filter(Boolean),resourceType:/\.(bin|zbin)$/i.test(r.name)?'firmware':/\.(mp4|webm|mov)$/i.test(r.name)?'video':/\.(exe|msi|apk|zip)$/i.test(r.name)?'software':'document'})),
   searchContext:async({query,role='operation',...options})=>(await search(query,'text',{...options,role,limit:4})).results,
   readContext:async r=>{if(!allowed(r.name,r.sha256))throw Error('public-evidence-not-authorized');const context=await evidenceSource.read(r);if(!allowed(r.name,r.sha256))throw Error('public-evidence-not-authorized');return {...context,[verifiedRead]:{name:r.name,sha256:r.sha256,unitId:r.unitId,context}};}
  }:{}),
  originalDocuments:originals,resolveDocuments:async rows=>rows.map(r=>({available:allowed(r.name,r.sha256),url:allowed(r.name,r.sha256)?urlFor(r.name):null})),
  filterEvidence:async rows=>rows.filter(r=>allowed(r.name,r.sha256)||answerSource?.allowed(r)).map(r=>({...r,download:r.answerOnly?null:urlFor(r.name)}))});
 const sessions=new Map();let active=0;
 const safeReply=text=>catalog.transform(answerSource?answerSource.redact(text):String(text||'')).replace(/\/(?:v2\/(?:offline|resources)|directory-catalog)[^\s）)<>]*/g,'[内部链接不可公开]').replace(/（现场参考(?:；现场参考)*）/g,'').replace(/(?:来源\d*\s*[:：]|来源资料\s*[:：])\s*现场参考[^\n]*/g,'').replace(/现场参考(?:\s*·[^\n]*)?/g,'').replace(/找到 \d+ 条相关原文，适用条件仍需核对；历史措施已保留在资料详情中。/g,'已有可参考的处理线索，仍需核对现场适用条件。');
 function visible(output){return {status:output.status||'answer',reply:safeReply(output.reply),actualMode:output.actualMode||'quick',modelStatus:output.modelStatus||'not-used',model:output.model||'v2-public-quick',
  answerBasis:output.answerBasis||null,expertSuggestion:output.expertSuggestion||null,modelCallCount:output.modelCallCount||0,
  ...(output.evidenceSummary?{evidenceSummary:output.evidenceSummary}:{}),
  ...(output.requestedMode?{requestedMode:output.requestedMode}:{}),
  ...(output.modeNotice?{modeNotice:output.modeNotice}:{}),
  ...(output.result?.operation==='ordering'?{intent:'ordering',result:{operation:'ordering',planningStatus:output.result.planningStatus||output.result.status,exportAllowed:false,plan:output.result.plan?{screen:output.result.plan.screen,architecture:output.result.plan.architecture,directOutputs:output.result.plan.directOutputs,builtInRegions:output.result.plan.builtInRegions,module:{size:output.result.plan.module.size,interface:output.result.plan.module.interface,dotPitch:output.result.plan.module.dotPitch,resolution:output.result.plan.module.resolution},controller:{model:output.result.plan.controller.model},ports:output.result.plan.ports.map(p=>({id:p.id,points:p.points,receivers:p.receivers}))}:null,previewBom:output.result.previewBom||output.result.bom||[],topologySvg:output.result.topologySvg||null,assumptions:output.result.assumptions||[],options:output.result.options||[]}}:{}),
  interpretation:output.interpretation?{corrections:output.interpretation.corrections}:null,
  results:[...new Map((output.results||[]).filter(r=>allowed(r.name,r.sha256)).map(r=>[JSON.stringify([r.name,sourceLocation(r.locator)]),{name:r.name,text:r.text?safeReply(r.text):null,location:sourceLocation(r.locator),download:urlFor(r.name)}])).values()],elapsedMs:output.elapsedMs};}
 async function answer(input,{signal}={}){
  if(!input||typeof input.message!=='string'||!input.message.trim()||input.message.length>8000||!['quick','expert'].includes(input.mode||'quick'))return {code:400,body:{error:'invalid-query',reply:'请输入8000字以内的问题，并选择快速或专家模式。'}};
  if(active>=4)return {code:429,body:{reply:'当前咨询较多，请稍后重试。'}};
  for(const [id,s]of sessions)if(Date.now()-s.updatedAt>1800000&&!s.busy)sessions.delete(id);
  const known=typeof input.conversationId==='string'&&sessions.get(input.conversationId);
  if(!known&&sessions.size>=200){const disposable=[...sessions].find(([,s])=>s.failed&&!s.busy);if(disposable)sessions.delete(disposable[0]);if(sessions.size>=200)return {code:429,body:{reply:'当前咨询较多，请稍后重试。'}};}
  const state=known||{id:randomUUID(),messages:[],facts:{},retrievalHistory:[],updatedAt:Date.now()};
  if(state.busy)return {code:409,body:{reply:'上一条咨询仍在处理，请稍候。'}};
  sessions.set(state.id,state);state.busy=true;active++;const started=Date.now();let requestOpen=true;
  try{
   signal?.throwIfAborted();
   // Commit only completed requests; cancelled work cannot mutate the next consultation.
   const draft=structuredClone(state);delete draft.busy;
   let output;const mode=input.mode||'quick';
   const queryPlan=retrieval.plan(input.message,draft),responsePlan=require('../../domain/knowledge/answer-plan.cjs').answerPlan(queryPlan,{documents:structuredScope()});
   const diagnostic=require('../../domain/parser/customer-language.cjs').diagnosticContext(input.message,draft,{hintIntent:queryPlan.intent,models:queryPlan.models});draft.diagnosticState=diagnostic;
   // Resolve the task and select its evidence once, before choosing a presenter.
   const resolved=responsePlan.identityUncertain?{status:'clarify',reply:'设备型号还没有确认。请核对清晰的型号和完整后缀，确认前不能按相近型号确定带载或刷写固件。',results:[]}:await retrieval.answer(input.message,{state:draft});
   const engineering=queryPlan.taskPlan.ordering&&orderingAnswer?resolved:null;
   if(resolved.quickContext){draft.taskState=resolved.quickContext.taskState;draft.retrievalHistory.push({quickContext:resolved.quickContext});draft.retrievalHistory=draft.retrievalHistory.slice(-12);}
   const engineeringReady=!!engineering?.result?.plan&&['conditional','ready','formal'].includes(engineering.result.planningStatus||engineering.result.status);
   const calculation=engineeringReady?{evidenceId:'calculation-public-preview',name:'已校验的条件配单',text:JSON.stringify({conditional:engineering.result.exportAllowed===false,exportAllowed:false,screen:engineering.result.plan.screen,module:engineering.result.plan.module,bom:engineering.result.previewBom||engineering.result.bom,assumptions:engineering.result.assumptions,scope:'模组接口、扫描和芯片等假设仍需现场确认；条件方案不能直接生成导入配置。'}),sourceKind:'validated-ordering-calculation',verificationStatus:'geometry-and-static-rule-checked',readPerformed:true,nextOffset:null,contextComplete:true,knowledgeUnit:{kind:'calculation',complete:true},modelIds:[],referenceOnly:true}:null;
   const authorize=row=>row.sourceKind==='validated-ordering-calculation'?!!calculation&&row.evidenceId===calculation.evidenceId&&row.text===calculation.text:row.answerOnly?answerSource?.allowed(row)===true:allowed(row.name,row.sha256);
   const read=async(row,{offset=0}={})=>{
    signal?.throwIfAborted();if(!requestOpen||!authorize(row))throw Error('public-evidence-not-authorized');
    if(row.sourceKind==='validated-ordering-calculation')return row;
    if(row.answerOnly){const data=await answerSource.read(row,{offset});if(!data||!requestOpen||!authorize(row))throw Error('public-evidence-not-authorized');return data;}
    const saved=row[verifiedRead];
    if(offset===0&&saved&&saved.name===row.name&&saved.sha256===row.sha256&&saved.unitId===row.unitId){
     const data=saved.context;return {...row,...data,excerpt:row.text,originalContext:data.text,readPerformed:true,verificationStatus:'public-original-hash-verified',sourceKind:'public-original'};
    }
    if(evidenceSource&&row.unitId){const data=await evidenceSource.read(row,{offset});if(!requestOpen||!authorize(row))throw Error('public-evidence-not-authorized');return {...row,...data,readPerformed:true,verificationStatus:'public-original-hash-verified',sourceKind:'public-original'};}
    const page=[...evidenceById.values()].find(p=>p.name===row.name&&p.sha256===row.sha256&&(!row.locator?.page||p.locator.page===row.locator.page));
    if(!page)throw Error('public-original-body-unavailable');
    const next=offset+5000<page.text.length?offset+5000:null;
    return {...page,text:page.text.slice(offset,offset+5000),readOffset:offset,readPerformed:true,readAvailable:next!==null,nextOffset:next,contextComplete:next===null,sourceKind:'public-original',verificationStatus:'public-original-hash-verified'};
   };
   const packet=await buildEvidencePacket({question:resolved.queryPlan||queryPlan,resolution:calculation?{...resolved,results:[calculation,...resolved.results||[]]}:resolved,authorize,read,limit:queryPlan.models.length>1?Math.min(8,queryPlan.models.length*3):3});
   const businessPlan=require('../../domain/knowledge/consultation-plan.cjs').consultationPlan(resolved.queryPlan||queryPlan,packet,{software:softwareItems('')});
   const summary={outcome:packet.outcome,evidenceCount:packet.evidence.length,completeUnits:packet.evidence.filter(e=>e.unitComplete===true).length,gapCount:packet.gaps.length};
   // Keep the selected quick answer and its read evidence in the same request.
   const prepared={...resolved,results:packet.evidence,evidenceSummary:summary};
   const readRows=packet.evidence.filter(e=>e.readPerformed&&!e.metadataOnly),textKey=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');
   const unmatched=(resolved.results||[]).filter(r=>typeof r.text==='string'&&r.text.trim()).some(r=>!readRows.some(e=>textKey(e.text).includes(textKey(r.text))));
   if(!engineering&&unmatched&&readRows.length)prepared.reply=readRows.map(e=>(e.excerpt||e.text)+'\n'+(e.answerOnly?'':'来源：'+e.name+(e.locator?.page?' · 第'+e.locator.page+'页':''))).join('\n\n');
   else if(!engineering&&unmatched&&!readRows.length&&!packet.evidence.some(e=>e.metadataOnly)){prepared.status='not-found';prepared.reply='已定位相关记录，但本次未能完成原文核对，暂时不能据此确认答案。这不表示资料中没有记载。';}
   // Build short parameter answers from the verified original, never from a
   // stale index claim or an unrelated full chapter used only as context.
   if(queryPlan.intent==='parameters'&&queryPlan.attributes.length&&readRows.length){
    const seenLines=new Set(),excerpts=readRows.map(e=>require('./quick-retrieval.cjs').parameterAnswerExcerpt(queryPlan,e)).filter(Boolean).map(e=>({...e,text:e.text.split('\n').filter(line=>{const key=e.sha256+'|'+textKey(line);if(seenLines.has(key))return false;seenLines.add(key);return true;}).join('\n')})).filter(e=>e.text);
    if(excerpts.length){prepared.status='answer';prepared.reply=excerpts.map(e=>e.text+(e.conditions?.length?'\n适用条件：'+e.conditions.join('；'):'')+'\n来源：'+e.name+' · '+require('../../domain/knowledge/answer-guidance.cjs').sourceLocation(require('../../domain/knowledge/evidence-location.cjs').quotationLocation(e,e.text.split('\n')[0]))).join('\n\n');}
   }
   const wantsAnalysis=/分析|解释|比较|对比|原因|为什么|怎么|怎样|如何/.test(input.message);
   const direct=mode==='expert'&&!wantsAnalysis&&(queryPlan.intent==='resources'&&packet.evidence.length&&packet.evidence.every(e=>e.metadataOnly)||responsePlan.purpose==='clarification'&&resolved.status==='clarify');
   if(direct){output={...prepared,actualMode:'quick',requestedMode:'expert',modelCallCount:0,modelStatus:'not-used',modeNotice:queryPlan.intent==='resources'?'已直接定位资料，无需等待模型生成。':'先确认这一项必要条件，已有信息会保留。'};}
   else if(mode==='expert'){
    if(!expert)return {code:503,body:{reply:'专家模型尚未连接，请先使用快速回答。',actualMode:'expert',evidenceSummary:summary}};
    const route={...require('../../domain/parser/chat-intent.cjs').expertIntent(queryPlan.interpretation.query,lookup,draft),models:queryPlan.models,hintIntent:queryPlan.intent};
    // Read handles are request-local, issued only by this public search. Never proxy an internal block ID.
    const readable=new Map(),issued=new Map();let sequence=randomInt(100000000,900000000);
    const execute=async(name,args)=>{
     signal?.throwIfAborted();if(!requestOpen||!args||typeof args!=='object'||Array.isArray(args))throw Error('expert-invalid-tool');
     if(name==='read_document'){
      const handle=readable.get(args.blockId),offset=args.offset??0;
      if(!handle||!Number.isInteger(offset)||!handle.offsets.has(offset))throw Error('expert-invalid-tool');
      const r=handle.row;
      if(r.answerOnly){if(!answerSource?.allowed(r))throw Error('expert-invalid-tool');const result=await answerSource.read(r,{offset});if(!result||!requestOpen)throw Error('expert-invalid-tool');if(result.nextOffset!==null)handle.offsets.add(result.nextOffset);return {evidence:[{...result,blockId:args.blockId,readPerformed:true,readAvailable:result.nextOffset!==null}],notice:{nextOffset:result.nextOffset,referenceOnly:true}};}
      if(!allowed(r.name,r.sha256))throw Error('expert-invalid-tool');
      if(evidenceSource&&r.unitId){
       const context=await evidenceSource.read(r,{offset});if(!allowed(r.name,r.sha256)||!requestOpen)throw Error('expert-invalid-tool');
       if(context.nextOffset!==null)handle.offsets.add(context.nextOffset);
       return {notice:{nextOffset:context.nextOffset,totalChars:context.totalChars,contextBoundary:context.contextBoundary,visualContextRequired:context.knowledgeUnit?.visualContextRequired},
        evidence:[{...r,text:context.text,knowledgeUnit:context.knowledgeUnit,blockId:args.blockId,readOffset:offset,readPerformed:true,readAvailable:context.nextOffset!==null,nextOffset:context.nextOffset,verificationStatus:'public-original-hash-verified'}]};
      }
      const next=offset+5000<r.text.length?offset+5000:null;if(next!==null)handle.offsets.add(next);
      return {notice:{nextOffset:next,totalChars:r.text.length,contextBoundary:'approved-original-page'},evidence:[{...r,blockId:args.blockId,download:urlFor(r.name),evidenceId:r.evidenceId+'-offset-'+offset,text:r.text.slice(offset,offset+5000),readOffset:offset,readPerformed:true,readAvailable:next!==null,nextOffset:next,verificationStatus:'public-original-hash-verified'}]};
     }
     if(name==='calculate_ordering'){
      if(!engineering)return {notice:{status:'needs-input'},evidence:[]};
      const result=engineering.result,ready=!!result?.plan&&['conditional','ready','formal'].includes(result.planningStatus||result.status);
      return {notice:{status:ready?'ready':'needs-input',conditional:result?.exportAllowed===false},evidence:[{evidenceId:'calculation-public-preview',name:'已校验的条件配单',text:JSON.stringify({conditional:result?.exportAllowed===false,exportAllowed:false,screen:result?.plan?.screen,module:result?.plan?.module,bom:result?.previewBom||result?.bom,pending:result?.progressive?.pending,assumptions:result?.assumptions,scope:'候选模组的扫描方式、接口及芯片未由客户确认，只能条件预览；现场不同必须重算，不能直接生成导入配置。'}),sourceKind:'validated-ordering-calculation',verificationStatus:ready?'geometry-and-static-rule-checked':'not-a-plan',readPerformed:true,readAvailable:false,modelIds:[],referenceOnly:true}]};
     }
     if(name!=='search_evidence')throw Error('expert-invalid-tool');
     if(typeof args.query!=='string'||!args.query.trim()||args.query.length>240||!['products','resources','cases','faq','firmware','text','files'].includes(args.kind)||args.models&&(!Array.isArray(args.models)||args.models.length>4||args.models.some(m=>typeof m!=='string'||m.length>64))||args.documents&&(!Array.isArray(args.documents)||!args.documents.length||args.documents.length>4||args.documents.some(n=>typeof n!=='string'||!readableNames.has(n))))throw Error('expert-invalid-tool');
     const explicit=extractKnownModels(args.query||'',lookup);let models=Array.isArray(args.models)?args.models:explicit.length?explicit:route.models?.length?route.models:[];
     // A model may propose a new search expression, never change a customer's
     // confirmed device, chip or version to make a result easier to obtain.
     const confirmedModels=queryPlan.models||[];
     if(confirmedModels.length&&models.some(m=>!confirmedModels.some(id=>normalize(id)===normalize(m))))throw Error('expert-invalid-tool');
     if(confirmedModels.length&&!models.length)models=confirmedModels;
     if(args.chips&&queryPlan.chips?.length&&args.chips.some(c=>!queryPlan.chips.includes(c)))throw Error('expert-invalid-tool');
     const requestedVersions=queryPlan.versions?.filter(v=>v.kind!=='hardware').map(v=>v.value)||[];
     if(args.version&&requestedVersions.length&&!requestedVersions.some(v=>String(v).replace(/^V/i,'')===String(args.version).replace(/^V/i,'')))throw Error('expert-invalid-tool');
     const query=[...models,args.query||''].join(' ');
     const referenceAllowed=['aftersales','operation','software-operation','software-function','technical'].includes(route.hintIntent||route.intent);
     const options={limit:12,models,documents:args.documents,concepts:args.concepts,chips:args.chips,version:args.version,question:input.message,...(args.role?{role:args.role}: {})};
     const data=answerSource&&referenceAllowed&&['cases','faq'].includes(args.kind)?await answerSource.search(query,args.kind,options):await search(query,args.kind,options);
     const evidence=data.results.map(r=>{if(evidenceSource&&!r.bodyParsed)return {...r,blockId:undefined,readAvailable:false,readPerformed:false,verificationStatus:'public-original-hash-verified;metadata-only'};
      const ids=r.mentionedModels?.length?r.mentionedModels:r.modelIds?.length?r.modelIds:extractKnownModels(r.name,lookup);
      const sourceRow={...r,modelIds:ids,scope:{...r.scope,mentionedModels:ids,compatibilityConfirmed:false}};
      const key=r.unitId||r.blockId;let handle=issued.get(key);if(!handle){handle=++sequence;issued.set(key,handle);readable.set(handle,{row:r.unitId?sourceRow:evidenceById.get(r.blockId),offsets:new Set([0])});}return {...sourceRow,blockId:handle,readAvailable:true,readPerformed:false,verificationStatus:r.answerOnly?'conditional-reference':'public-original-hash-verified'};});
     return {evidence,notice:{scope:'explicit-public-allowlist-only',internalIndexAvailable:false,compatibilityConfirmed:false}};
    };
    // A packet read handle is scoped to this request, never an index block ID.
    packet.evidence=packet.evidence.map(row=>{const handle=++sequence;readable.set(handle,{row,offsets:new Set([0,...(row.nextOffset==null?[]:[row.nextOffset])])});return {...row,blockId:handle};});
    output=await expert.answer({message:input.message,sessionState:draft,route,execute,signal,responsePlan:{...responsePlan,evidencePacket:packet,businessPlan,search:null,...(engineeringReady?{calculate:true}: {})}});
    if(engineering){output={...engineering,...output,result:engineering.result,reply:engineering.reply+(output.status==='unavailable'?'\n专家补充暂不可用；以上清单由已校验的计算流程生成。':output.reply?'\n\n专家补充：'+output.reply:''),status:engineering.status,actualMode:output.status==='unavailable'?'quick':'expert'};}
    else if(output.status==='unavailable'&&resolved.status==='answer'&&packet.evidence.some(e=>e.readPerformed&&!e.metadataOnly)){
     output={...prepared,actualMode:'quick',requestedMode:'expert',modelStatus:'failed',modelCallCount:output.modelCallCount||0,modeNotice:'专家暂未完成，以下为快速检索的原文依据。',reply:'专家暂未完成，以下为快速检索的原文依据。\n\n'+prepared.reply};
    }
   }else{
    output=prepared;
    output.actualMode='quick';
    if(diagnostic?.requiresTopology&&queryPlan.intent==='aftersales')output.reply=output.reply.replace(/(?:当前卡在哪个操作环节，屏幕或软件显示什么现象？|目前已做过哪项检查，结果怎样？|异常位置一直固定，还是会变化？)$/, '现场是控制卡直接接模组，还是通过外接接收卡？已有的型号、现象和发布结果会保留。');
   }
   signal?.throwIfAborted();const body=visible({...output,evidenceSummary:output.evidenceOutcome?{...summary,outcome:output.evidenceOutcome,gapCount:output.evidenceGaps?.length??summary.gapCount}:summary,elapsedMs:Date.now()-started});
   if(output.status!=='busy'){draft.failed=output.status==='unavailable';draft.messages.push({role:'user',content:input.message},{role:'assistant',content:body.reply});draft.messages=draft.messages.slice(-20);Object.assign(state,draft);}
   return {code:output.status==='unavailable'?503:output.status==='busy'?429:200,body:{...body,conversationId:state.id}};
  }finally{requestOpen=false;state.busy=false;state.updatedAt=Date.now();active--;if(!known&&!state.messages.length)sessions.delete(state.id);}
 }
 const evidenceCount=evidenceSource?new Set(structuredScope().filter(r=>/\.(pdf|docx?)$/i.test(r.name)).map(r=>r.sha256)).size:originals.length;
 return {answer,capabilities:async()=>({modes:['quick','expert'],expert:expert?await expert.status():{available:false},publicEvidenceDocuments:evidenceCount}),evidenceCount};
}
module.exports={createPublicChat};
