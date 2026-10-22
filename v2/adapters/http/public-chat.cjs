'use strict';
// A public adapter for the existing router/expert, with no internal index or session provider.
const {randomUUID}=require('node:crypto');
const {createQuickRetrieval}=require('./quick-retrieval.cjs');
const {parseQuickQuery,matchesConcept}=require('../../domain/knowledge/quick-query.cjs');
const {extractKnownModels}=require('../../domain/identity/extract-models.cjs');
function createPublicChat({app,knowledge,catalog,expert,verifiedDocuments=[]}){
 const approved=new Map(catalog.approvedResources().map(r=>[r.name,r]));
 const hashes=new Map(verifiedDocuments.map(r=>[r.name,r.sha256]));
 const allowed=(name,hash)=>approved.has(name)&&hashes.get(name)===hash&&/^[a-f0-9]{64}$/.test(hash||'');
 const originals=(knowledge.evidenceDocuments?.()||[]).filter(({document:d})=>allowed(d.name,d.sha256));
 const reference=r=>r&&allowed(r.originalName,r.originalSha256);
 const products=app.quickBrowse().map(p=>({modelId:p.modelId,displayName:p.displayName,aliases:p.aliases||[],parameters:{},documentCategory:p.documentCategory,
  documents:(p.documents||[]).filter(d=>approved.has(d.name)&&!d.accessRestricted).map(d=>({name:d.name,kind:d.kind,url:approved.get(d.name).url})),firmware:[],
  claims:(p.claims||[]).filter(c=>(c.sourceReferences||[c.sourceReference]).some(reference)).map(c=>({...c,sourceReferences:(c.sourceReferences||[c.sourceReference]).filter(reference),sourceReference:(c.sourceReferences||[c.sourceReference]).find(reference)}))
 })).filter(p=>p.documents.length||p.claims.length);
 const normalize=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
 const findProducts=q=>products.filter(p=>[p.modelId,p.displayName,...p.aliases].some(a=>normalize(a)===normalize(q)));
 const publicKnowledge={products:()=>products,findProducts};
 const scoped={quickBrowse:()=>products,quickSearch:q=>({records:q?findProducts(q):products}),quickResources:()=>({}),chipLookup:()=>null,
  resourceMedia:{softwareItems:()=>[],videoCategory:()=>({groups:[],topicGroups:[],total:0})},resourceLookup:()=>({items:[]})};
 const lookup={...publicKnowledge,chipLookup:()=>null,softwareItems:()=>[],isSoftware:()=>false};
 const pages=originals.flatMap(({document:d})=>(d.pages||[]).map(p=>({name:d.name,sha256:d.sha256,text:p.text,locator:{page:p.page},modelIds:extractKnownModels(d.name,lookup),evidenceId:d.sha256+'-public-page-'+p.page,download:approved.get(d.name).url})));
 const claimEvidence=products.flatMap(p=>p.claims.flatMap(c=>(c.sourceReferences||[]).map(r=>({name:r.originalName,sha256:r.originalSha256,text:c.text,
  locator:r.page?{page:r.page}:null,modelIds:[p.modelId],evidenceId:c.claimId,download:approved.get(r.originalName).url,readPerformed:true,readAvailable:false,verificationStatus:'public-original-hash-verified'}))));
 const evidenceById=new Map(pages.map((r,i)=>[i+1,{...r,blockId:i+1}]));
 async function search(query,kind,options={}){
  const q=parseQuickQuery(query,lookup),models=options.model?[normalize(options.model)]:q.models.map(normalize);
  const words=query.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/gi)||[];
  const source=kind==='products'&&claimEvidence.length?claimEvidence:[...evidenceById.values()];
  const results=source.filter(r=>!models.length||r.modelIds.some(m=>models.includes(normalize(m))))
   .map(r=>({r,score:q.concepts.filter(c=>matchesConcept(c,r.text)).length*10+words.filter(w=>normalize(r.name+' '+r.text).includes(normalize(w))).length}))
   .filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,Math.min(options.limit||24,24)).map(x=>x.r);
  return {results};
 }
 const retrieval=createQuickRetrieval({app:scoped,knowledge:publicKnowledge,search,searchCases:async()=>({results:[]}),
  originalDocuments:originals,resolveDocuments:async rows=>rows.map(r=>({available:allowed(r.name,r.sha256),url:allowed(r.name,r.sha256)?approved.get(r.name).url:null})),
  filterEvidence:async rows=>rows.filter(r=>allowed(r.name,r.sha256))});
 const sessions=new Map();let active=0;
 const safeReply=text=>catalog.transform(String(text||'')).replace(/\/(?:v2\/(?:offline|resources)|directory-catalog)[^\s）)<>]*/g,'[内部链接不可公开]');
 function visible(output){return {status:output.status||'answer',reply:safeReply(output.reply),actualMode:output.actualMode||'quick',modelStatus:output.modelStatus||'not-used',model:output.model||'v2-public-quick',
  results:(output.results||[]).filter(r=>approved.has(r.name)).map(r=>({name:r.name,text:r.text?safeReply(r.text):null,download:catalog.transform({name:r.name,url:'approved'}).url})),elapsedMs:output.elapsedMs};}
 async function answer(input,{signal}={}){
  if(!input||typeof input.message!=='string'||!input.message.trim()||input.message.length>8000||!['quick','expert'].includes(input.mode||'quick'))return {code:400,body:{error:'invalid-query',reply:'请输入8000字以内的问题，并选择快速或专家模式。'}};
  if(active>=4)return {code:429,body:{reply:'当前咨询较多，请稍后重试。'}};
  for(const [id,s]of sessions)if(Date.now()-s.updatedAt>1800000&&!s.busy)sessions.delete(id);
  const known=typeof input.conversationId==='string'&&sessions.get(input.conversationId);
  if(!known&&sessions.size>=200)return {code:429,body:{reply:'当前咨询较多，请稍后重试。'}};
  const state=known||{id:randomUUID(),messages:[],facts:{},retrievalHistory:[],updatedAt:Date.now()};
  if(state.busy)return {code:409,body:{reply:'上一条咨询仍在处理，请稍候。'}};
  sessions.set(state.id,state);state.busy=true;active++;const started=Date.now();
  try{
   let output;const mode=input.mode||'quick';
   if(mode==='expert'){
    if(!expert)return {code:503,body:{reply:'专家模型尚未连接，请先使用快速回答。',actualMode:'expert'}};
    const route=require('../../domain/parser/chat-intent.cjs').expertIntent(input.message,lookup,state);
    // Read handles are request-local, issued only by this public search. Never proxy an internal block ID.
    const readable=new Set();
    const execute=async(name,args)=>{
     if(name==='read_document'){
      if(!readable.has(args.blockId))throw Error('expert-invalid-tool');
      const r=evidenceById.get(args.blockId);return {evidence:[{...r,readPerformed:true,readAvailable:false,verificationStatus:'public-original-hash-verified'}]};
     }
     if(name==='calculate_ordering')return {notice:{status:'unsupported',reason:'public-calculation-not-enabled'},evidence:[]};
     if(name!=='search_evidence')throw Error('expert-invalid-tool');
     const query=[...(Array.isArray(args.models)?args.models:[]),args.query||''].join(' '),data=await search(query,args.kind,{limit:6});
     const evidence=data.results.filter(r=>!args.documents||args.documents.includes(r.name)).map(r=>{if(r.blockId)readable.add(r.blockId);return {...r,readAvailable:!!r.blockId,readPerformed:!r.blockId,verificationStatus:'public-original-hash-verified'};});
     return {evidence,notice:{scope:'explicit-public-allowlist-only',internalIndexAvailable:false,compatibilityConfirmed:false}};
    };
    output=await expert.answer({message:input.message,sessionState:state,route,execute,signal});
   }else{
    output=await retrieval.answer(input.message,{state});
    state.retrievalHistory.push({quickContext:output.quickContext});state.retrievalHistory=state.retrievalHistory.slice(-12);
    output.actualMode='quick';
   }
   const body=visible({...output,elapsedMs:Date.now()-started});
   state.messages.push({role:'user',content:input.message},{role:'assistant',content:body.reply});state.messages=state.messages.slice(-20);
   return {code:output.status==='unavailable'?503:output.status==='busy'?429:200,body:{...body,conversationId:state.id}};
  }finally{state.busy=false;state.updatedAt=Date.now();active--;}
 }
 return {answer,capabilities:async()=>({modes:['quick','expert'],expert:expert?await expert.status():{available:false},publicEvidenceDocuments:originals.length}),evidenceCount:originals.length};
}
module.exports={createPublicChat};
