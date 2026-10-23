'use strict';
// A public adapter for the existing router/expert, with no internal index or session provider.
const {randomUUID,randomInt}=require('node:crypto');
const {createQuickRetrieval}=require('./quick-retrieval.cjs');
const {parseQuickQuery,matchesConcept}=require('../../domain/knowledge/quick-query.cjs');
const {sourceLocation}=require('../../domain/knowledge/answer-guidance.cjs');
const {extractKnownModels}=require('../../domain/identity/extract-models.cjs');
function createPublicChat({app,knowledge,catalog,expert,verifiedDocuments=[]}){
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
 const reference=r=>r&&originalNames.has(r.originalName)&&allowed(r.originalName,r.originalSha256);
 const products=sourceProducts.map(p=>({modelId:p.modelId,displayName:p.displayName,aliases:p.aliases||[],parameters:{},documentCategory:p.documentCategory,
  documents:(p.documents||[]).filter(d=>allowed(d.name,d.sha256||hashes.get(d.name))&&!restricted(d)).map(d=>({name:d.name,sha256:d.sha256||hashes.get(d.name),kind:d.kind,url:null})),firmware:[],
  claims:(p.claims||[]).filter(c=>(c.sourceReferences||[c.sourceReference]).some(reference)).map(c=>({...c,sourceReferences:(c.sourceReferences||[c.sourceReference]).filter(reference),sourceReference:(c.sourceReferences||[c.sourceReference]).find(reference)}))
 })).filter(p=>p.documents.length||p.claims.length);
 const normalize=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
 const findProducts=q=>products.filter(p=>[p.modelId,p.displayName,...p.aliases].some(a=>normalize(a)===normalize(q)));
 const publicKnowledge={products:()=>products,findProducts};
 const scoped={quickBrowse:()=>products,quickSearch:q=>({records:q?findProducts(q):products}),quickResources:()=>({}),chipLookup:()=>null,
  resourceMedia:{softwareItems:()=>[],videoCategory:()=>({groups:[],topicGroups:[],total:0})},resourceLookup:()=>({items:[]})};
 const lookup={...publicKnowledge,chipLookup:()=>null,softwareItems:()=>[],isSoftware:()=>false};
 const pages=originals.flatMap(({document:d})=>(d.pages||[]).filter(p=>typeof p.text==='string'&&p.text.length).map(p=>({name:d.name,sha256:d.sha256,text:p.text,locator:{page:p.page},modelIds:extractKnownModels(d.name,lookup),evidenceId:d.sha256+'-public-page-'+p.page})));
 const evidenceById=new Map(pages.map((r,i)=>[i+1,{...r,blockId:i+1}]));
 // Indexed claims are search previews. Reading always returns the verified original page.
 const claimEvidence=products.flatMap(p=>p.claims.flatMap(c=>(c.sourceReferences||[]).map(r=>({name:r.originalName,sha256:r.originalSha256,text:c.text,
  locator:r.page?{page:r.page}:null,modelIds:[p.modelId],evidenceId:r.originalSha256+'-public-claim-'+p.modelId+'-'+c.claimId,
  blockId:[...evidenceById.values()].find(page=>page.name===r.originalName&&(!r.page||page.locator.page===r.page))?.blockId})))).filter(r=>r.blockId&&originalNames.has(r.name));
 async function search(query,kind,options={}){
  const q=parseQuickQuery(query,lookup),models=options.models?options.models.map(normalize):options.model?[normalize(options.model)]:q.models.map(normalize);
  const words=query.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/gi)||[];
  const source=kind==='products'?[...claimEvidence,...evidenceById.values()]:[...evidenceById.values()];
  const results=source.filter(r=>(!models.length||r.modelIds.some(m=>models.includes(normalize(m))))&&(!options.documents||options.documents.includes(r.name)))
   .map(r=>({r,score:q.concepts.filter(c=>matchesConcept(c,r.text)).length*10+words.filter(w=>normalize(r.name+' '+r.text).includes(normalize(w))).length}))
   .filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.min(options.limit||24,24)).map(x=>x.r);
  return {results:[...new Map(results.map(r=>[r.evidenceId,{...r,download:urlFor(r.name)}])).values()]};
 }
 const retrieval=createQuickRetrieval({app:scoped,knowledge:publicKnowledge,search,documentPolicy:documents=>require('../../domain/knowledge/document-versions.cjs').selectDocumentVersions(documents,{includeSigned:true}),searchCases:async()=>({results:[]}),
  originalDocuments:originals,resolveDocuments:async rows=>rows.map(r=>({available:allowed(r.name,r.sha256),url:allowed(r.name,r.sha256)?urlFor(r.name):null})),
  filterEvidence:async rows=>rows.filter(r=>allowed(r.name,r.sha256)).map(r=>({...r,download:urlFor(r.name)}))});
 const sessions=new Map();let active=0;
 const safeReply=text=>catalog.transform(String(text||'')).replace(/\/(?:v2\/(?:offline|resources)|directory-catalog)[^\s）)<>]*/g,'[内部链接不可公开]');
 function visible(output){return {status:output.status||'answer',reply:safeReply(output.reply),actualMode:output.actualMode||'quick',modelStatus:output.modelStatus||'not-used',model:output.model||'v2-public-quick',
  answerBasis:output.answerBasis||null,expertSuggestion:output.expertSuggestion||null,
  interpretation:output.interpretation?{corrections:output.interpretation.corrections}:null,
  results:[...new Map((output.results||[]).filter(r=>allowed(r.name,r.sha256)).map(r=>[JSON.stringify([r.name,sourceLocation(r.locator)]),{name:r.name,text:r.text?safeReply(r.text):null,location:sourceLocation(r.locator),download:urlFor(r.name)}])).values()],elapsedMs:output.elapsedMs};}
 async function answer(input,{signal}={}){
  if(!input||typeof input.message!=='string'||!input.message.trim()||input.message.length>8000||!['quick','expert'].includes(input.mode||'quick'))return {code:400,body:{error:'invalid-query',reply:'请输入8000字以内的问题，并选择快速或专家模式。'}};
  if(active>=4)return {code:429,body:{reply:'当前咨询较多，请稍后重试。'}};
  for(const [id,s]of sessions)if(Date.now()-s.updatedAt>1800000&&!s.busy)sessions.delete(id);
  const known=typeof input.conversationId==='string'&&sessions.get(input.conversationId);
  if(!known&&sessions.size>=200)return {code:429,body:{reply:'当前咨询较多，请稍后重试。'}};
  const state=known||{id:randomUUID(),messages:[],facts:{},retrievalHistory:[],updatedAt:Date.now()};
  if(state.busy)return {code:409,body:{reply:'上一条咨询仍在处理，请稍候。'}};
  sessions.set(state.id,state);state.busy=true;active++;const started=Date.now();let requestOpen=true;
  try{
   signal?.throwIfAborted();
   // Commit only completed requests; cancelled work cannot mutate the next consultation.
   const draft=structuredClone(state);delete draft.busy;
   let output;const mode=input.mode||'quick';
   if(mode==='expert'){
    if(!expert)return {code:503,body:{reply:'专家模型尚未连接，请先使用快速回答。',actualMode:'expert'}};
    const route=require('../../domain/parser/chat-intent.cjs').expertIntent(input.message,lookup,draft);
    // Read handles are request-local, issued only by this public search. Never proxy an internal block ID.
    const readable=new Map(),issued=new Map();let sequence=randomInt(100000000,900000000);
    const execute=async(name,args)=>{
     signal?.throwIfAborted();if(!requestOpen||!args||typeof args!=='object'||Array.isArray(args))throw Error('expert-invalid-tool');
     if(name==='read_document'){
      const handle=readable.get(args.blockId),offset=args.offset??0;
      if(!handle||!Number.isInteger(offset)||!handle.offsets.has(offset))throw Error('expert-invalid-tool');
      const r=handle.row;if(!allowed(r.name,r.sha256))throw Error('expert-invalid-tool');
      const next=offset+5000<r.text.length?offset+5000:null;if(next!==null)handle.offsets.add(next);
      return {notice:{nextOffset:next,totalChars:r.text.length,contextBoundary:'approved-original-page'},evidence:[{...r,blockId:args.blockId,download:urlFor(r.name),evidenceId:r.evidenceId+'-offset-'+offset,text:r.text.slice(offset,offset+5000),readOffset:offset,readPerformed:true,readAvailable:next!==null,nextOffset:next,verificationStatus:'public-original-hash-verified'}]};
     }
     if(name==='calculate_ordering')return {notice:{status:'unsupported',reason:'public-calculation-not-enabled'},evidence:[]};
     if(name!=='search_evidence')throw Error('expert-invalid-tool');
     if(typeof args.query!=='string'||!args.query.trim()||args.query.length>240||!['products','resources','cases','faq','firmware','text','files'].includes(args.kind)||args.models&&(!Array.isArray(args.models)||args.models.length>4||args.models.some(m=>typeof m!=='string'||m.length>64))||args.documents&&(!Array.isArray(args.documents)||!args.documents.length||args.documents.length>4||args.documents.some(n=>typeof n!=='string'||!originalNames.has(n))))throw Error('expert-invalid-tool');
     const explicit=extractKnownModels(args.query||'',lookup),models=Array.isArray(args.models)?args.models:explicit.length?explicit:route.models?.length?route.models:[];
     const query=[...models,args.query||''].join(' '),data=await search(query,args.kind,{limit:6,models,documents:args.documents});
     const evidence=data.results.map(r=>{let handle=issued.get(r.blockId);if(!handle){handle=++sequence;issued.set(r.blockId,handle);readable.set(handle,{row:evidenceById.get(r.blockId),offsets:new Set([0])});}return {...r,blockId:handle,readAvailable:true,readPerformed:false,verificationStatus:'public-original-hash-verified'};});
     return {evidence,notice:{scope:'explicit-public-allowlist-only',internalIndexAvailable:false,compatibilityConfirmed:false}};
    };
    output=await expert.answer({message:input.message,sessionState:draft,route,execute,signal});
   }else{
    output=await retrieval.answer(input.message,{state:draft});
    draft.taskState=output.quickContext?.taskState||draft.taskState;
    draft.retrievalHistory.push({quickContext:output.quickContext});draft.retrievalHistory=draft.retrievalHistory.slice(-12);
    output.actualMode='quick';
   }
   signal?.throwIfAborted();const body=visible({...output,elapsedMs:Date.now()-started});
   if(!['unavailable','busy'].includes(output.status)){draft.messages.push({role:'user',content:input.message},{role:'assistant',content:body.reply});draft.messages=draft.messages.slice(-20);Object.assign(state,draft);}
   return {code:output.status==='unavailable'?503:output.status==='busy'?429:200,body:{...body,conversationId:state.id}};
  }finally{requestOpen=false;state.busy=false;state.updatedAt=Date.now();active--;if(!known&&!state.messages.length)sessions.delete(state.id);}
 }
 return {answer,capabilities:async()=>({modes:['quick','expert'],expert:expert?await expert.status():{available:false},publicEvidenceDocuments:originals.length}),evidenceCount:originals.length};
}
module.exports={createPublicChat};
