'use strict';
// Server-owned document identities and authorization precede vector retrieval.
const fs=require('node:fs'),crypto=require('node:crypto');
function createRagflowSource({configFile,authorize=()=>false,transport=fetch,timeoutMs=15000}={}){
 const config=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));
 const base=new URL(config.baseUrl);
 if(base.protocol!=='http:'||!['127.0.0.1','localhost'].includes(base.hostname)||base.username||base.password)throw Error('RAGFlow requires a local origin');
 if(!config.apiKey||!Array.isArray(config.documents)||!Array.isArray(config.datasetIds))throw Error('Invalid RAGFlow configuration');
 let registered=new Map(config.documents.map(d=>[d.documentId,d])),modified=fs.statSync(configFile).mtimeMs;
 async function search(query,{models=[],documents=[],software=[],kind,signal,limit=6}={}){
  const now=fs.statSync(configFile).mtimeMs;
  if(now!==modified){const next=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));if(next.baseUrl!==config.baseUrl||next.apiKey!==config.apiKey||!Array.isArray(next.documents))throw Error('RAGFlow connection changed; restart required');registered=new Map(next.documents.map(d=>[d.documentId,d]));modified=now;}
  // Authorization is evaluated before query and again after response. Internal
  // datasets may share the instance, but never enter a public request's scope.
  let eligible=[...registered.values()].filter(d=>authorize(d)===true);
  if(documents.length)eligible=eligible.filter(d=>documents.includes(d.name));
  const normalized=s=>String(s).normalize('NFKC').replace(/[\s_-]/g,'').toLowerCase();
  if(software.length)eligible=eligible.filter(d=>software.some(s=>normalized(d.name).includes(normalized(s))));
  if(models.length)eligible=eligible.filter(d=>models.some(m=>(d.modelIds||[]).includes(m))||kind==='cases'&&d.category==='case'&&!d.modelIds?.length);
  const category=kind==='products'||kind==='parameters'?'spec':kind==='operation'?'manual':null;
  if(category&&eligible.some(d=>d.category===category))eligible=eligible.filter(d=>d.category===category);
  if(!eligible.length)return {results:[],scope:'authorized-documents',absenceConfirmed:false};
  const ids=new Set(eligible.map(d=>d.documentId));
  const response=await transport(new URL('/api/v1/retrieval',base),{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body:JSON.stringify({question:query,dataset_ids:[...new Set(eligible.map(d=>d.datasetId))],document_ids:[...ids],page_size:Math.min(12,limit),top_k:80,similarity_threshold:0.2,vector_similarity_weight:0.5}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw Error('RAGFlow retrieval unavailable');
  const data=await response.json();if(data.code!==0||!Array.isArray(data.data?.chunks))throw Error('Invalid RAGFlow response');
  const results=[];
  for(const chunk of data.data.chunks){
   const source=registered.get(chunk.document_id);
   if(!source||!ids.has(chunk.document_id)||authorize(source)!==true||typeof chunk.content!=='string'||!chunk.content.trim())continue;
   const position=chunk.positions?.[0]?.length?chunk.positions[0][0]:null;
   const originalLocator=Number.isInteger(position)&&position>=0?/\.pdf$/i.test(source.name)?{page:position+1}:/\.pptx?$/i.test(source.name)?{slide:position+1}:undefined:undefined;
   const row={name:source.name,sha256:source.sha256,text:chunk.content.slice(0,12000),modelIds:source.modelIds||[],category:source.category,evidenceId:'rag-'+crypto.createHash('sha256').update(source.sha256+'|'+chunk.id).digest('hex'),sourceKind:source.access==='public'?'ragflow-public-original':'ragflow-internal-original',verificationStatus:'authorized-ragflow-chunk',readPerformed:true,readAvailable:false,contextComplete:false,knowledgeUnit:{kind:source.category==='manual'?'operation':'parameter',complete:false},locator:chunk.positions?.[0]?.length?{page:chunk.positions[0][0]+1}:undefined,ragflowDocumentId:source.documentId};
   row.locator=originalLocator;results.push(row);
  }
  return {results,scope:'authorized-documents',absenceConfirmed:false};
 }
 return {search,configuredDocuments:registered.size};
}
module.exports={createRagflowSource};
