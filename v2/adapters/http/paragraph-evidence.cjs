'use strict';
// Transport adapter for the EXISTING role/search and role/read APIs. It neither
// changes public approval nor creates another retriever or intent classifier.
function createParagraphEvidence({resourceBase,authorizedDocuments}){
 const base=new URL(resourceBase);
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.username||base.password||base.pathname!=='/')throw Error('paragraph-source-requires-loopback');
 if(typeof authorizedDocuments!=='function')throw Error('paragraph-source-requires-caller-authorization');
 async function scope(){
  const rows=await authorizedDocuments();
  if(!Array.isArray(rows)||rows.length>20000||rows.some(r=>!r||typeof r.name!=='string'||!r.name||!/^[a-f0-9]{64}$/.test(r.sha256||'')))throw Error('invalid-paragraph-authorization');
  return rows;
 }
 async function request(route,body){
  const response=await fetch(new URL(route,base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('paragraph-source-unavailable');
  return response.json();
 }
 // Never expose local source paths, database IDs as public capabilities, or
 // compatibility assertions inferred from a filename.
 function evidence(row){return {
  name:row.name,sha256:row.sha256,text:row.kind==='file'?'':row.text,
  unitId:row.unitId,blockId:row.blockId,role:row.role,kind:row.kind,
  evidenceId:'unit-'+row.unitId,locator:row.knowledgeUnit?.sourceSpans?.find(s=>s.role==='body'&&s.locator)?.locator||row.locator,versions:row.versions||[],
  mentionedModels:row.mentionedModels||[],knowledgeUnit:row.knowledgeUnit,
  sourceStatus:row.kind==='file'?'registered-metadata-only':'original-structured-text',
  bodyParsed:row.knowledgeUnit?.bodyParsed===true,compatibilityConfirmed:false,
  score:row.score,readAnchor:row.readAnchor,proximity:row.proximity,caseMatch:row.caseMatch,
  category:({parameter:'spec',operation:'manual',video:'video',firmware:'firmware',software:'software'})[row.role]||null
 };}
 async function search(query,kind='text',options={}){
  let grants=await scope();
  if(options.authorizedDocuments)grants=grants.filter(r=>options.authorizedDocuments.some(a=>a.name===r.name&&a.sha256===r.sha256));
  const byHash=new Map();
  for(const r of grants){if(!byHash.has(r.sha256))byHash.set(r.sha256,new Set());byHash.get(r.sha256).add(r.name);}
  const role=options.role||({products:'parameter',firmware:'firmware',cases:'case',faq:'faq',video:'video',files:'all',resources:'all'})[kind]||'text';
  const proposed=options.concepts?.length?options.concepts:String(query).match(/[A-Za-z0-9]+(?:[-_.+][A-Za-z0-9]+)*|[\u3400-\u9fff]{2,8}/g)||[];
  const concepts=[...new Set(proposed.filter(w=>typeof w==='string'&&w.trim()&&w.length<=32).map(w=>w.trim()))].slice(0,6);
  if(!concepts.length)return {results:[],candidateCount:0,elapsedMs:0};
  const data=await request('/role/search',{q:String(query).slice(0,240),role,concepts,models:options.models||[options.model].filter(Boolean),
   documents:options.documents,authorized_keys:[...byHash.keys()],limit:Math.min(options.limit||6,32),version:options.version,chips:options.chips});
  const seen=new Set();
  const results=(data.results||[]).flatMap(row=>{
   const names=byHash.get(row.sha256),location=row.locations?.find(l=>names?.has(l.name));
   if(!location)return [];
   const key=row.kind==='file'?row.sha256:row.unitId;
   if(seen.has(key))return [];seen.add(key);
   return [evidence({...row,name:location.name})];
  });
  return {results,candidateCount:data.candidateCount,elapsedMs:data.elapsedMs};
 }
 async function read(candidate,{offset=0}={}){
  const grants=await scope();
  if(!grants.some(r=>r.name===candidate.name&&r.sha256===candidate.sha256))throw Error('paragraph-source-not-authorized');
  const raw=await request('/role/read',{unit:candidate.unitId,offset,authorized_keys:[candidate.sha256]});
  if(raw.knowledgeUnit?.documentId!==candidate.sha256||raw.knowledgeUnit?.id!==candidate.unitId)throw Error('paragraph-source-identity-conflict');
  let textOffset=0;const contextParts=(raw.blocks||[]).map(b=>{const part={blockId:b.blockId,locator:b.locator,charStart:b.charStart,charEnd:b.charEnd,textStart:textOffset,textEnd:textOffset+b.text.length};textOffset+=b.text.length+1;return part;});
  return {text:(raw.blocks||[]).map(b=>b.text).join('\n'),knowledgeUnit:raw.knowledgeUnit,contextBoundary:raw.boundary,
   contextComplete:raw.nextOffset===null,nextOffset:raw.nextOffset,totalChars:raw.totalChars,
   contextParts};
 }
 return {search,read};
}
module.exports={createParagraphEvidence};
