'use strict';
// A public adapter for the existing router/expert, with no internal index or session provider.
const {randomUUID}=require('node:crypto');
const {createQuickRetrieval}=require('./quick-retrieval.cjs');
const {parseQuickQuery,matchesConcept}=require('../../domain/knowledge/quick-query.cjs');
const {extractKnownModels}=require('../../domain/identity/extract-models.cjs');
function createPublicChat({app,knowledge,catalog,expert,verifiedDocuments=[],ragflowConfigFile}){
 const approved=new Map(catalog.approvedResources().map(r=>[r.name,r]));
 const hashes=new Map(verifiedDocuments.map(r=>[r.name,r.sha256]));
 const restricted=new Set((knowledge.evidenceDocuments?.()||[]).filter(({document:d})=>d.accessRestricted).map(({document:d})=>d.name));
 const allowed=(name,hash)=>!restricted.has(name)&&approved.has(name)&&hashes.get(name)===hash&&/^[a-f0-9]{64}$/.test(hash||'');
 const originals=(knowledge.evidenceDocuments?.()||[]).filter(({document:d})=>allowed(d.name,d.sha256));
 const reference=r=>r&&allowed(r.originalName,r.originalSha256);
 const products=app.quickBrowse().map(p=>({modelId:p.modelId,displayName:p.displayName,aliases:p.aliases||[],parameters:{},documentCategory:p.documentCategory,
  documents:(p.documents||[]).filter(d=>approved.has(d.name)&&!d.accessRestricted&&!restricted.has(d.name)&&(!d.sha256||allowed(d.name,d.sha256))).map(d=>({name:d.name,kind:d.kind,url:approved.get(d.name).url})),firmware:[],
  claims:(p.claims||[]).filter(c=>(c.sourceReferences||[c.sourceReference]).some(reference)).map(c=>({...c,sourceReferences:(c.sourceReferences||[c.sourceReference]).filter(reference),sourceReference:(c.sourceReferences||[c.sourceReference]).find(reference)}))
 })).filter(p=>p.documents.length||p.claims.length);
 const normalize=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
 const findProducts=q=>products.filter(p=>[p.modelId,p.displayName,...p.aliases].some(a=>normalize(a)===normalize(q)));
 const publicKnowledge={products:()=>products,findProducts};
 const scoped={quickBrowse:()=>products,quickSearch:q=>({records:q?findProducts(q):products}),quickResources:()=>({}),chipLookup:()=>null,
  resourceMedia:{softwareItems:()=>[],videoCategory:()=>({groups:[],topicGroups:[],total:0})},resourceLookup:()=>({items:[]})};
 const lookup={...publicKnowledge,chipLookup:()=>null,softwareItems:()=>[],isSoftware:()=>false};
 const ragflow=ragflowConfigFile?require('./ragflow-answer.cjs').createRagflowAnswers({source:require('./ragflow-source.cjs').createRagflowSource({configFile:ragflowConfigFile,authorize:d=>d.access==='public'&&allowed(d.name,d.sha256)}),knowledge:publicKnowledge,lookup}):null;
 const pages=originals.flatMap(({document:d})=>(d.pages||[]).map(p=>({name:d.name,sha256:d.sha256,text:p.text,locator:{page:p.page},modelIds:extractKnownModels(d.name,lookup),evidenceId:d.sha256+'-public-page-'+p.page,download:approved.get(d.name).url})));
 const claimEvidence=products.flatMap(p=>p.claims.flatMap(c=>(c.sourceReferences||[]).map(r=>({name:r.originalName,sha256:r.originalSha256,text:c.text,
  locator:r.page?{page:r.page}:null,modelIds:[p.modelId],evidenceId:c.claimId,download:approved.get(r.originalName).url,readPerformed:false,readAvailable:true,verificationStatus:'indexed-not-content-verified'}))));
 const evidenceById=new Map(pages.map((r,i)=>[i+1,{...r,blockId:i+1}]));
 async function search(query,kind,options={}){
  const q=parseQuickQuery(query,lookup),models=options.model?[normalize(options.model)]:q.models.map(normalize);
  if(['files','resources','firmware'].includes(kind)){
   const candidates=products.flatMap(p=>(p.documents||[]).map(d=>({...d,modelIds:[p.modelId]}))).filter(d=>!models.length||d.modelIds.some(m=>models.includes(normalize(m)))).filter(d=>!q.categories.length||q.categories.includes(d.kind));
   const unique=[...new Map(candidates.map(d=>[d.name,d])).values()],first=[...new Map(unique.map(d=>[d.modelIds[0],d])).values()];
   return {results:[...new Map([...first,...unique].map(d=>[d.name,d])).values()].slice(0,Math.min(options.limit||6,6)).map(d=>({name:d.name,sha256:hashes.get(d.name)||null,modelIds:d.modelIds,evidenceId:'public-file-'+d.name,text:'已批准公开的文件登记：'+d.name+'。只证明文件及下载入口，不证明正文参数或兼容性。',download:approved.get(d.name).url,sourceKind:'registered-resource-metadata',readPerformed:true,readAvailable:false,contextComplete:false}))};
  }
  if(ragflow&&!['files','resources','firmware'].includes(kind)){try{const found=await ragflow.retrieve(query,{kind,models:q.models});if(found.results.length)return {results:found.results.map(r=>({...r,download:approved.get(r.name).url}))};}catch{ /* Existing authorized search remains available on RAG failure. */ }}
  const words=query.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/gi)||[];
  const source=kind==='products'&&claimEvidence.length?claimEvidence:[...evidenceById.values()];
  const results=source.filter(r=>!models.length||r.modelIds.some(m=>models.includes(normalize(m))))
   .map(r=>({r,score:q.concepts.filter(c=>matchesConcept(c,r.text)).length*10+words.filter(w=>normalize(r.name+' '+r.text).includes(normalize(w))).length}))
   .filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.min(options.limit||24,24)).map(x=>{const r=x.r;if(!r.blockId){const original=[...evidenceById.values()].find(p=>p.name===r.name&&p.sha256===r.sha256&&(!r.locator?.page||p.locator.page===r.locator.page));return original?{...r,blockId:original.blockId}:r;}return r;});
  return {results};
 }
 const retrieval=createQuickRetrieval({app:scoped,knowledge:publicKnowledge,search,searchCases:async()=>({results:[]}),
  originalDocuments:originals,resolveDocuments:async rows=>rows.map(r=>({available:allowed(r.name,r.sha256),url:allowed(r.name,r.sha256)?approved.get(r.name).url:null})),
  filterEvidence:async rows=>rows.filter(r=>allowed(r.name,r.sha256))});
 const sessions=new Map();let active=0,nextReadHandle=1000000;
 const safeReply=text=>catalog.transform(String(text||'')).replace(/\/(?:v2\/(?:offline|resources)|directory-catalog)[^\s）)<>]*/g,'[内部链接不可公开]');
 function visible(output){return {status:output.status||'answer',reply:safeReply(output.reply),actualMode:output.actualMode||'quick',modelStatus:output.modelStatus||'not-used',model:output.model||'v2-public-quick',answerBasis:output.answerBasis||null,modelCallCount:output.modelCallCount||0,evidenceSummary:output.evidenceSummary||null,processingSummary:output.processingSummary||null,
  results:(output.results||[]).filter(r=>approved.has(r.name)).map(r=>({name:r.name,text:r.text?safeReply(r.text):null,download:catalog.transform({name:r.name,url:'approved'}).url})),elapsedMs:output.elapsedMs};}
 async function answer(input,{signal,onAnswerDelta,onAnswerProgress}={}){
  if(!input||typeof input.message!=='string'||!input.message.trim()||input.message.length>8000||!['quick','expert'].includes(input.mode||'quick'))return {code:400,body:{error:'invalid-query',reply:'请输入8000字以内的问题，并选择快速或专家模式。'}};
  if(input.mode==='expert'&&expert?.access&&!expert.access().available){const state=expert.access();return {code:503,body:{status:'unavailable',actualMode:'expert',error:'expert-'+state.reason,reply:state.reply,modelCallCount:0}};}
  if(active>=32)return {code:429,body:{reply:'等待人数较多，请稍后重试。'}};
  for(const [id,s]of sessions)if(Date.now()-s.updatedAt>1800000&&!s.busy)sessions.delete(id);
  const known=typeof input.conversationId==='string'&&sessions.get(input.conversationId);
  if(!known&&sessions.size>=200)return {code:429,body:{reply:'当前咨询较多，请稍后重试。'}};
  const stored=known||{id:randomUUID(),messages:[],facts:{},retrievalHistory:[],updatedAt:Date.now()};
  if(stored.busy)return {code:409,body:{reply:'上一条咨询仍在处理，请稍候。'}};
  const state=structuredClone(stored);
  sessions.set(state.id,stored);stored.busy=true;active++;const started=Date.now();let requestOpen=true,committed=false;
  try{
   signal?.throwIfAborted();
   let output;const mode=input.mode||'quick';
   if(mode==='expert'){
    if(!expert)return {code:503,body:{reply:'专家模型尚未连接，请先使用快速回答。',actualMode:'expert'}};
    const route=require('../../domain/parser/chat-intent.cjs').expertIntent(input.message,lookup,state);
    // Read handles are request-local, issued only by this public search. Never proxy an internal block ID.
    const readable=new Map();
    const execute=async(name,args)=>{
     if(name==='quick_answer'){
      if(!requestOpen)throw Error('expert-invalid-tool');
      let found=null;if(ragflow)try{found=await ragflow.quick(args.query,{state,signal});}catch{}
      found||=await retrieval.answer(args.query,{state});
      const results=(found.results||[]).filter(r=>approved.has(r.name)&&!restricted.has(r.name)&&(!r.sha256||allowed(r.name,r.sha256))).map(r=>({...r,download:approved.get(r.name).url,...(!r.text?{resourceOnly:true}:{})}));
      const directAnswer=found.status==='answer'?{...found,reply:safeReply(found.reply),results}:null;
      return {evidence:require('./shared-quick-evidence.cjs').sharedQuickEvidence({results}),directAnswer,notice:{scope:'explicit-public-allowlist-only',status:found.status,reply:safeReply(found.reply),internalIndexAvailable:false,compatibilityConfirmed:false}};
     }
     if(name==='read_document'){
      const entry=readable.get(args.blockId),offset=args.offset||0;
      if(!requestOpen||!entry||!Number.isInteger(offset)||!entry.offsets.has(offset))throw Error('expert-invalid-tool');
      const r=entry.row,next=offset+5000<r.text.length?offset+5000:null;if(next!==null)entry.offsets.add(next);
      return {evidence:[{...r,blockId:args.blockId,text:r.text.slice(offset,offset+5000),nextOffset:next,readPerformed:true,readAvailable:next!==null,verificationStatus:'public-original-hash-verified'}],notice:{nextOffset:next}};
     }
     if(name==='calculate_ordering')return {notice:{status:'unsupported',reason:'public-calculation-not-enabled'},evidence:[]};
     if(name!=='search_evidence')throw Error('expert-invalid-tool');
     const query=[...(Array.isArray(args.models)?args.models:[]),args.query||''].join(' '),data=await search(query,args.kind,{limit:6});
     if(!requestOpen)throw Error('expert-invalid-tool');
     const evidence=data.results.filter(r=>!args.documents||args.documents.includes(r.name)).map(r=>{if(r.blockId){const handle=++nextReadHandle;readable.set(handle,{row:evidenceById.get(r.blockId),offsets:new Set([0])});return {...r,blockId:handle,readAvailable:true,readPerformed:false};}return r;});
     return {evidence,notice:{scope:'explicit-public-allowlist-only',internalIndexAvailable:false,compatibilityConfirmed:false}};
    };
    const progressFacts={models:route.models||[],results:[],modelCallCount:0};
    const onProgress=(_stage,detail={})=>{Object.assign(progressFacts,detail);onAnswerProgress?.(require('./answer-process.cjs').answerProcess({...progressFacts,results:progressFacts.results.filter(r=>allowed(r.name,r.sha256)),status:progressFacts.generating?'generating':'running'}));};
    onProgress('understanding');
    output=await expert.answer({message:input.message,sessionState:state,route,execute,signal,onAnswerDelta,onProgress});
    output.processingSummary=require('./answer-process.cjs').answerProcess({...output,models:route.models||[],results:(output.results||[]).filter(r=>allowed(r.name,r.sha256))});
   }else{
    let ragAnswer=null;if(ragflow){try{ragAnswer=await ragflow.quick(input.message,{state,signal});}catch{}}
    output=ragAnswer||await retrieval.answer(input.message,{state});
    state.taskState=output.quickContext?.taskState||state.taskState||{lastQuickContext:output.quickContext||null};
    state.retrievalHistory.push({quickContext:output.quickContext});state.retrievalHistory=state.retrievalHistory.slice(-12);
    output.actualMode='quick';
   }
   signal?.throwIfAborted();
   const body=visible({...output,elapsedMs:Date.now()-started});
   if(['unavailable','busy'].includes(output.status))return {code:output.status==='busy'?429:503,body:{...body,conversationId:state.id}};
   state.messages.push({role:'user',content:input.message},{role:'assistant',content:body.reply});state.messages=state.messages.slice(-20);
   state.busy=false;sessions.set(state.id,state);committed=true;
   return {code:output.status==='unavailable'?503:output.status==='busy'?429:200,body:{...body,conversationId:state.id}};
  }finally{requestOpen=false;stored.busy=false;stored.updatedAt=Date.now();if(!committed&&!known)sessions.delete(state.id);active--;}
 }
 return {answer,capabilities:async()=>({modes:['quick','expert'],expert:expert?await expert.status():{available:false},retrievalMode:ragflow?'ragflow-hybrid':'local-index',publicEvidenceDocuments:originals.length}),evidenceCount:originals.length};
}
module.exports={createPublicChat};
