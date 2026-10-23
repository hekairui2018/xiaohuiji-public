'use strict';
// Local search and historical-record browsing. No model or diagnostic state machine.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const http=require('node:http'),{pipeline}=require('node:stream/promises');
const {searchRecords}=require('../../domain/aftersales/case-search.cjs');
const {createOfflineSessions}=require('./offline-session.cjs');
const {consumeCase}=require('../../domain/aftersales/consume-case.cjs');
const {modelId}=require('../../domain/identity/model-id.cjs');
const {fileUrl,previewPage,pdfPreviewPage}=require('./document-preview.cjs');
const {groupVideos}=require('../../domain/knowledge/resource-categories.cjs');
const {resourceView}=require('../../domain/knowledge/resource-view.cjs');
const {accessInfo,resourceCopies}=require('../../domain/knowledge/resource-access.cjs');
const clean=s=>String(s||'').replace(/(?<![A-Za-z])[A-Za-z]:[\\/][^\r\n|<>"']+|\\\\[^\r\n|<>"']+/g,'[内部路径]').replace(/(?<!\d)1[3-9]\d{9}(?!\d)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[联系方式]');
// Employee-only local source directory, derived from a registered original.
// A synchronized G: folder is a path, NOT a verified shareable cloud URL.
function registeredSourceDirectory(locations){
 const raw=String(locations?.[0]?.path||'').replace(/\\/g,'/');
 if(!raw)return null;
 if(raw.startsWith('//'))return '内部共享目录（未展示服务器地址）';
 const drive=/^([A-Za-z]):\//.exec(raw);
 const parts=raw.replace(/^[A-Za-z]:\//,'').split('/').filter(Boolean);
 const folder=parts.slice(0,-1).join(' / ');
 if(!folder)return null;
 return clean((drive?drive[1].toUpperCase()+'盘 / ':'')+folder);
}
const location=l=>Object.fromEntries(Object.entries(l||{}).filter(([k])=>['page','paragraph','table','row','sheet','slide','section','line','part','charStart','charEnd'].includes(k)).map(([k,v])=>[k,typeof v==='string'?clean(v):v]));
function createOfflineKnowledge({knowledge,resourceBase='http://127.0.0.1:4510',sessionDirectory,logs=null,images=null,expert=null,app=null,roleIndexEnabled=false,authorizeRestrictedVideo=()=>false,authorizeRestrictedResource=authorizeRestrictedVideo}={}){
 const sessions=createOfflineSessions(sessionDirectory);
 const modelRequests=new Map(),inFlight=new Set();
 const progress=require('./request-progress.cjs').createRequestProgress();
 const base=new URL(resourceBase);if(base.protocol!=='http:'||base.hostname!=='127.0.0.1')throw Error('offline resources require loopback');
 const cases=(knowledge?.cases()||[]).map(c=>consumeCase(c,knowledge.evidenceCaseReviews?.()||[]));
 const caseMap=new Map(cases.map(c=>[c.stableId,c]));
 const knownModels=new Set(cases.flatMap(c=>c.modelIds||[]));
 for(const p of knowledge?.products()||[])knownModels.add(p.modelId);
 const documentLinks=new Map();
 for(const p of knowledge?.products()||[])for(const d of [...p.documents||[],...p.firmware||[]]){
  const url=d.url||d.publicUrl;if(url?.startsWith('/')&&!url.startsWith('//'))documentLinks.set(new URL(url,'http://localhost').pathname,{name:d.name||d.file,sha256:d.sha256||d.sourceReference?.originalSha256});
 }
 const evidenceDocuments=knowledge?.evidenceDocuments()||[];
 const originals=new Set(evidenceDocuments.map(x=>x.document.sha256));
 const normalize=r=>require('../../domain/knowledge/resource-view.cjs').resourceView({available:!!(r.locationId||r.locations?.[0]?.id),classificationBasis:'registered-index-match',name:clean(r.name),matchKind:r.kind||null,resourceId:r.resourceId||null,versionId:r.versionId||null,resourceVersionId:r.versionId||null,fileId:r.sha256?'sha256:'+r.sha256:r.versionId||null,sha256:r.sha256||null,blockId:r.blockId||null,
  extension:path.extname(r.name||'').toLowerCase(),sourceDirectory:registeredSourceDirectory(r.locations),localModifiedAt:r.locations?.[0]?.mtime_ns?new Date(r.locations[0].mtime_ns/1e6).toISOString():null,
  evidenceId:r.unitId?'unit-'+r.unitId:r.sha256&&r.blockId?'blk-'+r.sha256.slice(0,16)+'-'+(r.ordinal??r.blockId):null,
  text:clean(/\.csv$/i.test(r.name||'')?String(r.text||'').split(' | ').slice(0,3).join(' | '):r.text),
  locator:location(r.locator),versions:r.versions||[],mentionedModels:r.mentionedModels||[],scopeStatus:'原文提及或目录线索，不代表兼容性确认',
  score:r.score,download:(r.locationId||r.locations?.[0]?.id)?fileUrl(r.locationId||r.locations[0].id,r.name):null,
  candidatePassages:r.candidatePassages||0,locationsTruncated:!!r.locationsTruncated,
  matchedLocations:r.unitId?[]:(r.matchedLocations||[]).filter(m=>Number.isInteger(m.blockId)&&m.blockId>0).map(m=>({blockId:m.blockId,locator:location(m.locator),readUrl:'/v2/offline/read?block='+m.blockId})),
  readUrl:r.unitId?(r.blockId?'/v2/offline/role-read?unit='+r.unitId:null):r.blockId?'/v2/offline/read?block='+r.blockId:null},{kind:'document'});
 async function request(route){const r=await fetch(resourceBase+route,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('resource service unavailable');const body=await r.json();if(!route.startsWith('/proximity/search?'))return body;const permitted=await authorizeResources(body);if(!roleIndexEnabled)return permitted;const keys=await roleDocumentKeys();return {...permitted,results:(permitted.results||[]).filter(r=>keys.has(r.sha256||'metadata:'+r.resourceId))};}
 let catalogCache=null,catalogTime=0,catalogError=null,catalogPending=null,catalogSignature=null;
 async function localCatalog(){
  if(catalogCache&&Date.now()-catalogTime<=30000)return catalogCache;
  if(catalogPending)return catalogPending;
  catalogPending=(async()=>{try{const rows=(await request('/catalog')).resources||[],signature=JSON.stringify(rows);
   // Preserve identity when the index is unchanged, so product associations are not rebuilt.
   if(signature!==catalogSignature){catalogCache=rows;catalogSignature=signature;}
   catalogTime=Date.now();catalogError=null;return catalogCache;
  }catch{catalogError='resource-service-unavailable';return catalogCache||[];}finally{catalogPending=null;}})();
  return catalogPending;
 }
 localCatalog.status=()=>({state:catalogError?(catalogCache?'stale-cache':'unavailable'):catalogCache?'ready':'not-loaded',reason:catalogError,lastSuccessfulAt:catalogTime?new Date(catalogTime).toISOString():null,cacheSeconds:30});
 // Role-index candidate limits run inside the explicit readable document scope.
 // Recheck access for every call; no employee/public authorization is cached.
 async function roleDocumentKeys(){
  const resources=await localCatalog();if(catalogError)throw Error('role-authorization-unavailable');
  const copies=new Map();for(const r of resources){const key=r.sha256||'metadata:'+r.resourceId;if(!copies.has(key))copies.set(key,[]);copies.get(key).push(r);}
  const keys=new Set();for(const [key,rows]of copies)if(key!=='metadata:undefined'&&rows.some(r=>!r.availabilityState||r.availabilityState==='present')&&!rows.some(r=>accessInfo(r,rows).accessRestricted))keys.add(key);
  return keys;
 }
 const roleGrants=new Map();
 async function roleRequest(route,params){
  const keys=await roleDocumentKeys();
  const grant=route==='/role/read'?roleGrants.get(params.unit):null;
  if(route==='/role/read'&&(!grant||!keys.has(grant.key)))throw Error('role-read-not-authorized');
  const response=await fetch(resourceBase+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...params,authorized_keys:[...keys]}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('role-index-unavailable');const raw=await response.json();
  if(route==='/role/read'){
   if(raw.knowledgeUnit?.id!==params.unit||raw.knowledgeUnit.kind!==grant.unit.kind||!require('node:util').isDeepStrictEqual(raw.knowledgeUnit.sourceSpans,grant.unit.sourceSpans))throw Error('role-unit-identity-mismatch');return raw;
  }
  if(!Array.isArray(raw.results))throw Error('role-index-invalid');
  const permitted=await authorizeResources({...raw,results:raw.results.filter(r=>keys.has(r.sha256||'metadata:'+r.resourceId))});
  for(const r of permitted.results){if(!/^[a-f0-9]{64}$/.test(r.unitId||'')||r.knowledgeUnit?.id!==r.unitId||!Array.isArray(r.knowledgeUnit.sourceSpans))throw Error('role-index-invalid');roleGrants.set(r.unitId,{key:r.sha256||'metadata:'+r.resourceId,unit:r.knowledgeUnit});}
  while(roleGrants.size>2000)roleGrants.delete(roleGrants.keys().next().value);
  return permitted;
 }
 async function readRoleContext(unitId){
  const blocks=[];let offset=0,raw,characters=0;
  for(let page=0;page<4;page++){
   raw=await roleRequest('/role/read',{unit:unitId,offset});
   for(const block of raw.blocks||[]){characters+=String(block.text||'').length;if(characters>24000)throw Error('role-context-budget');blocks.push(block);}
   if(raw.nextOffset===null)break;
   if(!Number.isInteger(raw.nextOffset)||raw.nextOffset<=offset)throw Error('role-context-offset');
   offset=raw.nextOffset;
  }
  return {...raw,blocks};
 }
 const videoFile=x=>/\.(mp4|webm|mov)$/i.test(x?.name||x?.file||'');
 const resourceFile=x=>/\.[a-z0-9]{2,5}$/i.test(x?.name||x?.file||'');
 async function permittedResource(item,req){
  if(!resourceFile(item))return true;
  const resources=await localCatalog(),copies=resourceCopies(item,resources),nature=accessInfo(item,resourceCopies(item,resources));
  // Public traffic can never gain internal access, including from a client header.
  return !nature.accessRestricted||(!req?.v2Public&&!!req&&await authorizeRestrictedResource(req,{...item,...nature,sources:copies}));
 }
 let directoryCache=null,directoryTime=0,directoryPending=null,directoryPrepared=null,directorySignature=null;
 const directoryIndexes=new Map();
 async function directoryCatalog(req,options={}){
  if(req?.v2Public)throw Error('public-route-not-enabled');
  if(!directoryCache||Date.now()-directoryTime>30000){
   if(!directoryPending)directoryPending=request('/directory-catalog').then(raw=>{if(raw.directoryCatalogVersion!==1||!Array.isArray(raw.resources))throw Error('directory-catalog-service-not-updated');const signature=JSON.stringify(raw.resources);if(signature!==directorySignature){directoryIndexes.clear();directoryCache=raw.resources;directoryPrepared=require('../../domain/knowledge/source-directory.cjs').directoryItems(directoryCache);directorySignature=signature;}directoryTime=Date.now();}).finally(()=>{directoryPending=null;});
   await directoryPending;
  }
  const {createDirectoryIndex,directoryPage}=require('../../domain/knowledge/source-directory.cjs');
  // Source-copy restrictions were resolved once against the complete directory.
  // Recheck employee authorization per request; never cache a privileged response.
  const allowed=await Promise.all(directoryPrepared.map(async row=>!row.accessRestricted||!!req&&await authorizeRestrictedResource(req,{...row,sources:directoryCache.filter(r=>r.locationId===row.locationId||row.sha256&&r.sha256===row.sha256||row.resourceVersionId&&r.versionId===row.resourceVersionId)})));
  const permissionKey=allowed.map(Boolean).map(Number).join('');
  let index=directoryIndexes.get(permissionKey);if(!index){index=createDirectoryIndex(directoryPrepared.filter((row,i)=>allowed[i]));if(directoryIndexes.size>=4)directoryIndexes.delete(directoryIndexes.keys().next().value);directoryIndexes.set(permissionKey,index);}
  return {cat:'other',docs:directoryPage(index,options)};
 }
 async function permittedResourceId(id,req){
  const info=await request('/resource-info?id='+encodeURIComponent(id));
  if(typeof info.isVideo!=='boolean'||!Array.isArray(info.resources))throw Error('resource-access-metadata-unavailable');
  for(const source of info.resources||[]){
   const nature=accessInfo(source,info.resources);
   if(nature.accessRestricted&&(req?.v2Public||!await authorizeRestrictedResource(req,{...source,...nature,sources:info.resources})))return false;
  }
  return (info.resources||[]).length>0;
 }
 async function authorizeResources(value,req=null){
  if(!/\.[a-z0-9]{2,5}(?:[\"?]|$)/i.test(JSON.stringify(value)))return value;
  const resources=await localCatalog();
  async function visit(x){
   if(Array.isArray(x))return (await Promise.all(x.map(visit))).filter(v=>v!==null);
   if(!x||typeof x!=='object')return x;
   if(resourceFile(x)){
    if(!await permittedResource(x,req))return null;
    const copies=resourceCopies(x,resources),nature=accessInfo(x,copies);
    return videoFile(x)?{...x,...nature,videoAccessChecked:copies.length>0}:x;
   }
   const out={};for(const [k,v]of Object.entries(x))out[k]=await visit(v);
   return out;
  }
  const body=await visit(value);
  if(body?.video){const groups=(body.video.groups||body.video.topicGroups||[]).map(g=>({...g,count:g.videos.length,sections:(g.sections||[]).map(s=>({...s})).filter(s=>s.videos.length)})).filter(g=>g.count);body.video.groups=groups;body.video.topicGroups=groups;body.video.total=groups.reduce((n,g)=>n+g.count,0);}
  const documentCount=b=>(b?.docs?.groups||[]).reduce((n,g)=>n+(g.products?g.products.reduce((m,p)=>m+p.items.length,0):(g.items||[]).length),0);
  if(body?.docs&&(['other','pending'].includes(body.cat)||documentCount(body)!==documentCount(value))){
   const docs=body.docs;docs.groups=docs.groups.map(g=>{const products=(g.products||[]).map(p=>({...p,count:p.items.length})).filter(p=>p.count);return {...g,products,count:products.length,fileCount:products.reduce((n,p)=>n+p.count,0)};}).filter(g=>g.fileCount);
   const items=docs.groups.flatMap(g=>g.products.flatMap(p=>p.items)),key=x=>x.fileId||x.sha256||x.resourceVersionId||x.url;docs.items=items;docs.total=items.length;docs.uniqueFileCount=new Set(items.map(key)).size;docs.uniqueAvailableFileCount=new Set(items.filter(x=>x.available).map(key)).size;
   if(docs.materialGrouping)docs.materialCounts=docs.groups.map(g=>({key:g.materialProperty,label:g.label,count:g.fileCount}));docs.modelCount=docs.groups.reduce((n,g)=>n+g.count,0);
   docs.unavailableReferenceCount=docs.unavailableRecords?.length||0;
   if(docs.pagination)docs.pagination={...docs.pagination,total:items.length,returned:items.length,nextOffset:null};
  }
  return body;
 }
 const productFacts=require('../../domain/knowledge/product-table-facts.cjs').createProductTableFacts({localCatalog,request});
 async function search(q,mode='all',{limit=10,model=null,version=null,groupDocuments=false}={}){
  const raw=await request('/search?q='+encodeURIComponent(q)+'&mode='+mode+'&limit='+limit+(model?'&model='+encodeURIComponent(model):'')+(version?'&version='+encodeURIComponent(version):'')+(groupDocuments?'&group_documents=1':''));
  const results=(await authorizeResources({results:(raw.results||[]).map(normalize)})).results;
  return {query:q,elapsedMs:raw.elapsedMs,requestedModels:raw.requestedModels||[],results,returnedCount:results.length,limitReached:!!raw.limitReached,countScope:'returned-candidates-not-total'};
 }
 async function resolveDocuments(documents){
  const items=documents.map(d=>{
   const name=d.name||d.file;
   const ref=(d.sourceReferences||[d.sourceReference]).find(r=>r?.originalSha256&&r.originalName===name);
   return {name,sha256:d.sha256||ref?.originalSha256||null};
  });
  try{
   const results=[];for(let offset=0;offset<items.length;offset+=256){const batch=items.slice(offset,offset+256),response=await fetch(resourceBase+'/resolve-documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:batch}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('resolver-unavailable');const body=await response.json();if(!Array.isArray(body.results)||body.results.length!==batch.length)throw Error('resolver-invalid');results.push(...body.results);
   }
   return results.map((r,i)=>r.available&&Number.isInteger(r.locationId)?{url:fileUrl(r.locationId,items[i].name),downloadUrl:'/v2/offline/file?id='+r.locationId+'&download=1',available:true,unavailableReason:null,originalName:r.originalName||items[i].name,documentEdition:r.documentEdition||null,resolutionBasis:r.resolutionBasis||'registered-exact-name-and-content-identity',sha256:r.sha256,resourceId:r.resourceId||null,resourceVersionId:r.versionId||null,versionId:r.versionId||null}:{url:null,downloadUrl:null,available:false,unavailableReason:r.reason||'original-not-registered'});
  }catch{return items.map(()=>({url:null,available:false,unavailableReason:'resource-service-unavailable'}));}
 }
 const refView=r=>({name:clean(r.originalName||path.basename(String(r.file||'').replace(/\\/g,'/'))),locator:typeof r.locator==='object'?location(r.locator):clean(r.locator),sha256:r.originalSha256||r.sha256||null,
  original:r.originalSha256&&originals.has(r.originalSha256)?'/v2/resources/original/'+r.originalSha256:null,
  originalStatus:r.originalSha256&&originals.has(r.originalSha256)?'registered-original':'original-link-not-established'});
 function caseView(c){return {id:c.stableId,title:clean(c.subCategory||c.phenomenon).slice(0,100),phenomenon:clean(c.phenomenon),modelIds:c.modelIds||[],scope:c.scope||{},
  verificationStatus:c.verificationStatus||'unknown',checks:(c.checks||[]).map(x=>({text:clean(x.text),verificationStatus:x.verificationStatus||'unknown'})),
  historicalMeasure:clean(c.historicalSolution),resultStatus:'历史处理记录不等于当前故障已解决',missingEvidence:clean(c.missingEvidence),
  sourceExcerpt:clean(c.sourceExcerpt),excerptKind:(c.sourceReferences||[]).some(r=>r.originalSha256)?'source-linked-excerpt':'existing-case-index-excerpt',sources:(c.sourceReferences||[]).map(refView),referenceOnly:true};}
 function searchCases(q,model,facts={}){
  const explicit=model?modelId(model):null;
  const known=(q.match(/(?:HD[-_ ]?)?[A-Za-z]+[0-9]+[A-Za-z0-9+-]*/g)||[]).map(modelId).filter(id=>knownModels.has(id));
  const models=explicit?[explicit]:(facts.modelIds?.length?facts.modelIds.map(modelId).filter(Boolean):known);
  const ranked=searchRecords(q,cases,{...facts,...(models.length?{modelIds:models}:{})});
  return {query:q,results:ranked.results.slice(0,10).map(r=>({...caseView(r.case),score:r.score,facts:r.facts,applicability:r.applicability})),total:ranked.results.length,excludedByConditions:ranked.excluded,notApplicable:ranked.excludedRecords,
   note:'历史案例用于核对现象和条件，不是自动诊断结论；请对照型号、版本、芯片与现场条件。'};
 }
 async function caseSearchWithDocuments(q,model,facts={}){const result=searchCases(q,model,facts);
  try{const raw=await search([q,model,...facts.modelIds||[]].filter(Boolean).join(' '),'text');result.rawEvidence=raw.results;}
  catch{result.rawEvidence=[];result.rawEvidenceUnavailable=true;}
  return result;
 }
 async function localizeMedia(value,{metadataOnly=false,requestContext=null}={}){
  const body=JSON.parse(JSON.stringify(value)),targets=[],resources=body.video?(await localCatalog()).filter(r=>r.sourceDrive==='G:'&&r.availabilityState==='present'):[];
  if(body.video){const seen=new Set((body.video.groups||[]).flatMap(g=>g.videos||[]).map(v=>v.name)),extra=[];for(const r of resources)if(/\.(mp4|webm)$/i.test(r.name)&&(/[\u4e00-\u9fff]/.test(r.name)||require('../../domain/knowledge/video-purpose.cjs').videoPurpose({name:r.name},[r]).purpose==='operation')&&(!body.query||r.name.toLowerCase().includes(String(body.query).toLowerCase()))&&!seen.has(r.name)){seen.add(r.name);extra.push({name:r.name,url:'/v2/offline/file?id='+r.locationId,sizeBytes:r.sizeBytes,sizeText:Math.round(r.sizeBytes/1048576)+' MB',sourceMode:'local',kind:'local-original'});}if(extra.length){const group={key:'local-originals',label:'新增本地视频',count:extra.length,videos:extra};body.video.groups.push(group);if(body.video.topicGroups)body.video.topicGroups.push(group);body.video.total+=extra.length;}}
  if(body.video){const registered=body.video.groups.flatMap(g=>g.videos).filter(v=>resources.some(r=>r.name===v.name&&(!v.sha256||r.sha256===v.sha256)));body.video.hiddenNonLocalCount=body.video.groups.reduce((n,g)=>n+g.videos.length,0)-registered.length;body.video.groups=[{key:'registered-local',videos:registered}];body.video.sourcePolicy='registered-present-G-drive-only';}
  if(body.video){const selection=require('../../domain/knowledge/video-purpose.cjs').operationVideos(body.video.groups.flatMap(g=>g.videos),resources);body.video.groups=[{key:'operations',label:'操作视频',videos:selection.selected,count:selection.selected.length}];body.video.topicGroups=[];body.video.total=selection.selected.length;body.video.excludedNonOperationCount=selection.withheld.length;body.video.purposePolicy='operation-videos; source-folders-primary';}
  if(metadataOnly&&body.video){const permitted=[];for(const v of body.video.groups.flatMap(g=>g.videos))if(await permittedResource(v,requestContext))permitted.push(v);const groups=groupVideos(permitted,resources);return {cat:'video',metadataOnly:true,countStatus:'registered-candidates-not-availability-verified',total:groups.reduce((n,g)=>n+g.count,0),groups:groups.map(g=>({key:g.key,label:g.label,count:g.count}))};}
  function visit(x){if(Array.isArray(x)){x.forEach(visit);return;}if(!x||typeof x!=='object')return;
   if(/\.(bin|mp4|webm|mov)$/i.test(x.name||x.file||'')&&(x.url||x.publicUrl))targets.push(x);
   for(const v of Object.values(x))if(typeof v==='object')visit(v);
  }visit(body);
  if(!targets.length)return authorizeResources(body,requestContext);
  const expectedHash=x=>x.sha256||(x.sourceReferences||[]).find(r=>r.originalSha256)?.originalSha256||null,identity=x=>(x.name||x.file)+'|'+(expectedHash(x)||'unconfirmed');
  const unique=[...new Map(targets.map(x=>[identity(x),x])).values()];
  let results=[];for(let offset=0;offset<unique.length;offset+=256){const batch=unique.slice(offset,offset+256);try{const r=await fetch(resourceBase+'/resolve-assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:batch.map(x=>({name:x.name||x.file,sha256:expectedHash(x)}))}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('asset-resolution-failed');results.push(...(await r.json()).results);}catch{results.push(...batch.map(()=>null));}}
  const byName=new Map(unique.map((x,i)=>[identity(x),results[i]]));
  for(const x of targets){const r=byName.get(identity(x));if(r?.available){const url='/v2/offline/file?id='+r.locationId;for(const key of ['url','publicUrl'])if(x[key])x[key]=url;x.sourceMode='local';x.localAvailable=true;x.available=true;x.localSizeBytes=r.sizeBytes;x.resourceId=r.resourceId||null;x.resourceVersionId=r.versionId||null;x.versionId=r.versionId||null;x.fileId=r.sha256?'sha256:'+r.sha256:r.versionId||null;if(r.sha256)x.sha256=r.sha256;if(/\.(mp4|webm|mov)$/i.test(x.name||x.file)){x.sizeBytes=r.sizeBytes;x.sizeText=Math.round(r.sizeBytes/1048576)+' MB';}}else{const cloud=/^https?:/.test(x.url||x.publicUrl||'');x.sourceMode=cloud?'cloud-fallback':'unavailable';x.available=cloud;x.localAvailable=false;x.localUnavailableReason=r?.reason||'local-resource-service-unavailable';x.unavailableReason=cloud?null:x.localUnavailableReason;x.unavailableMessage=cloud?null:'本地原件尚未确认，暂不可下载';if(!cloud&&x.downloadUrl)x.downloadUrl=null;if(x.clean)x.clean+=cloud?'（云端备用）':'（本地原件待核对）';if(!cloud){if(x.url)x.url=null;if(x.publicUrl)x.publicUrl=null;}}}
  if(body.video){const allowedIds=new Set(resources.map(r=>String(r.locationId)));const groups=groupVideos(body.video.groups.flatMap(g=>g.videos).filter(v=>v.localAvailable&&/^\/v2\/offline\/file\?id=\d+$/.test(v.url||'')&&allowedIds.has(new URL(v.url,'http://local').searchParams.get('id'))),resources);for(const g of groups)g.videos=g.videos.map(v=>resourceView({...v,classificationBasis:v.categoryBasis?.join(';')||null,associationStatus:'source-category-not-compatibility'},{kind:'video'}));body.video.groups=groups;body.video.topicGroups=groups;body.video.total=groups.reduce((n,g)=>n+g.count,0);body.video.grouping='product-category-and-original-operation';}
  if(body.docs&&body.docs.pagination?.limit===null){const available=body.docs.items.filter(i=>i.available&&i.url);body.docs.uniqueAvailableFileCount=new Set(available.map(i=>i.fileId||i.sha256||i.name)).size;}
  return authorizeResources(body,requestContext);
 }
 async function stream(route,res,range,download=false){
  const controller=new AbortController(),closed=()=>controller.abort();res.once('close',closed);
  try{
  // The read-only Python server closes HTTP/1.0 responses. Use the Node
  // streaming client here: fetch/Undici can assert fatally when its parser
  // finishes while paused by backpressure on a large, closing response.
  await new Promise((resolve,reject)=>{
   const request=http.get(resourceBase+route,{headers:range?{Range:range}:{},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])},r=>{
    const contentType=r.headers['content-type']||'application/octet-stream',disposition=r.headers['content-disposition']||'attachment';
    const headers={'Content-Type':contentType,'Content-Disposition':download?disposition.replace(/^inline/i,'attachment'):/^(application\/pdf|video\/)/i.test(contentType)?disposition.replace(/^attachment/i,'inline'):disposition,'X-Content-Type-Options':'nosniff'};
    for(const k of ['content-length','content-range','accept-ranges'])if(r.headers[k])headers[k]=r.headers[k];
    res.writeHead(r.statusCode,headers);
    pipeline(r,res).then(resolve,reject);
   });
   request.once('error',reject);
  });
  }finally{res.off('close',closed);}
 }
 const answers=require('./quick-answer.cjs').createQuickAnswer({app,knowledge,search,searchCases,localCatalog,resolveDocuments,localizeMedia});
 const faqLookup=require('./registered-faq.cjs').createRegisteredFaq({
  findFiles:async()=>{const out=[];for(const term of ['FQA','FAQ'])out.push(...(await search(term,'files',{limit:32})).results);return out;},
  readPage:(id,offset)=>request('/preview-document?'+new URLSearchParams({id,offset})),
  authorize:id=>permittedResourceId(id,null),normalize,clean
 });
 const quickRetrieval=require('./quick-retrieval.cjs').createQuickRetrieval({app,knowledge,search,searchCases,faqLookup,localCatalog,resolveDocuments,localizeMedia,originalDocuments:evidenceDocuments,businessAnswer:answers.answer,filterEvidence:async rows=>(await authorizeResources({results:rows})).results,
  async searchContext({query,concepts,documents,models,chips,version,role='operation'}){
   if(roleIndexEnabled&&!chips?.length&&!version){try{const raw=await roleRequest('/role/search',{q:query,role,concepts,documents,models,limit:4});return raw.results.map(r=>({...normalize(r),readAnchor:r.readAnchor,proximity:r.proximity,knowledgeUnit:r.knowledgeUnit,unitId:r.unitId,role:r.role}));}catch{}}
   const params=new URLSearchParams({q:query,scope:'text',concepts:JSON.stringify(concepts),documents:JSON.stringify(documents),models:JSON.stringify(models),chips:JSON.stringify(chips),limit:'4'});if(version)params.set('version',version);
   const raw=await request('/proximity/search?'+params);return (raw.results||[]).map(r=>({...normalize(r),readAnchor:r.readAnchor,proximity:r.proximity}));
  },
  async readContext(candidate){
   if(roleIndexEnabled&&candidate.unitId){const raw=await readRoleContext(candidate.unitId);return {text:(raw.blocks||[]).map(b=>clean(b.text)).join('\n'),contextBoundary:raw.boundary,boundaryWindowLimited:raw.boundaryWindowLimited,contextParts:(raw.blocks||[]).map(b=>({locator:location(b.locator),blockId:b.blockId,charStart:b.charStart,charEnd:b.charEnd})),knowledgeUnit:raw.knowledgeUnit,contextComplete:raw.nextOffset===null};}
   const raw=await request('/proximity/read?'+new URLSearchParams({block:candidate.blockId,anchor:candidate.readAnchor||0}));
   return {text:(raw.blocks||[]).map(b=>clean(b.text)).join('\n'),contextBoundary:raw.boundary,contextParts:(raw.blocks||[]).map(b=>({locator:location(b.locator),blockId:b.blockId})),contextComplete:raw.nextOffset===null};
  }});
 async function handle(req,res){
  const u=new URL(req.url,'http://localhost'),p=u.pathname;
  const chat=p==='/api/ai/chat';
  const legacy=req.method==='GET'&&documentLinks.has(p);
  const original=req.method==='GET'&&p.startsWith('/v2/resources/original/')&&originals.has(p.split('/').pop());
  const image=p==='/api/ocr',logRoute=p==='/api/huidu/log';
  if(!p.startsWith('/v2/offline/')&&!chat&&!legacy&&!original&&!image&&!logRoute)return false;
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value,(_k,v)=>typeof v==='string'?clean(v):v));return true;};
  const host=req.headers.host;if(req.headers.origin&&req.headers.origin!=='http://'+host)return send(403,{error:'origin-not-allowed'});
  try{
   if(logRoute&&req.method==='POST'){if(!logs)return send(503,{error:'log-store-not-configured'});if(!logs.authorized(req.headers['x-upload-key']))return send(403,{error:'upload-key-required'});}
   if(image||logRoute){if(req.method!=='POST')return send(405,{error:'method-not-allowed'});let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(image?15*1024*1024:1024*1024))return send(413,{error:'body-too-large'});chunks.push(chunk);}let b;try{b=JSON.parse(Buffer.concat(chunks));}catch{return send(400,{error:'invalid-json'});}
    if(image)return send(200,images?await images.recognize(b):{ok:false,message:'本地图片识别未配置，请输入文字。'});
    if(!logs)return send(503,{error:'log-store-not-configured'});if(!logs.authorized(req.headers['x-upload-key']))return send(403,{error:'upload-key-required'});
    let result;try{result=logs.receive(b);}catch(e){
     if(e.message==='invalid-task-event')return send(400,{error:'invalid-task-event',message:'任务事件缺少稳定运行ID、序号或有效事件内容。'});
     if(e.message==='task-event-conflict')return send(409,{error:'task-event-conflict',message:'相同任务事件或序号出现不同内容，原始记录未被覆盖。'});
     if(e.message==='task-device-conflict')return send(409,{error:'task-device-conflict',message:'同一任务出现不同设备身份，请保留本地记录并检查任务ID生命周期。'});
     if(e.message==='invalid-log')return send(400,{error:'invalid-log',message:'日志正文必须为字符串且不超过900000个字符。'});
     if(e.message==='invalid-log-identity')return send(400,{error:'invalid-log-identity',message:'必须提供machine_id或devKey（最多160个字符），以及YYYY-MM-DD格式的log_date。'});
     return send(503,{error:'log-store-unavailable',message:'日志暂时无法保存，请保留本地日志并稍后重试。'});
    }return send(200,result);}
   if(p==='/v2/offline/session/close'&&req.method==='POST'){
    let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>1024)return send(413,{error:'body-too-large'});raw+=chunk;}
    let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'invalid-json'});}
    try{const result=sessions.closeGuest(input.sessionId);modelRequests.get(input.sessionId)?.abort();return send(200,result);}catch(e){return send(400,{error:e.message});}
   }
   if(req.method==='GET'&&p==='/v2/offline/session'){return send(200,sessions.get(u.searchParams.get('id')));}
   if(req.method==='GET'&&p==='/v2/offline/log-status')return send(200,logs?.status()||{configured:false});
   if(legacy){const d=documentLinks.get(p),raw=await request('/search?q='+encodeURIComponent(d.name)+'&mode=files&limit=10');const file=(raw.results||[]).find(r=>r.kind==='file'&&Number.isInteger(r.locationId)&&r.name===d.name&&(!d.sha256||r.sha256===d.sha256));if(!file)return send(404,{error:'original-not-located',message:'索引中尚未定位此版本原件，请使用资料搜索核对版本。'});const target=fileUrl(file.locationId,d.name);if(target.includes('/preview?')){res.writeHead(302,{Location:target});res.end();return true;}await stream('/resource?id='+file.locationId,res);return true;}
   if(original){const file=(await localCatalog()).find(r=>r.sha256===p.split('/').pop());if(file&&!await permittedResource(file,req))return send(403,{error:'resource-access-denied'});await stream(p,res);return true;}
   if(req.method==='GET'&&p==='/v2/offline/client.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'../../frontend/offline-client.js')));return true;}
   if(req.method==='GET'&&p==='/v2/offline/status')return send(200,{mode:'no-model',knowledgeVersion:knowledge?.version,caseCount:cases.length,sourceService:'local-read-only-index',catalogStatus:localCatalog.status()});
   if(req.method==='GET'&&p==='/v2/offline/suggestions'){
    const q=u.searchParams.get('q')||'';if(q.length>240)return send(400,{error:'invalid-query'});
    return send(200,{suggestion:require('../../domain/knowledge/model-suggestion.cjs').suggestModels(q,knowledge?.products?.()||app?.quickBrowse?.()||[])});
   }
   if(req.method==='GET'&&p==='/v2/offline/progress'){
    const current=progress.get(u.searchParams.get('session'),u.searchParams.get('request'));
    return send(current?200:404,current||{error:'request-not-found'});
   }
   if(req.method==='GET'&&p==='/v2/offline/capabilities')return send(200,{defaultMode:'quick',modes:['quick','expert'],expert:expert?await expert.status():{available:false,reason:'not-configured',model:null},ordering:'deterministic-rules-only'});
   if(req.method==='GET'&&p==='/v2/offline/file'){
    const id=u.searchParams.get('id');if(!/^\d+$/.test(id||''))return send(400,{error:'invalid-resource'});if(!await permittedResourceId(id,req))return send(403,{error:'resource-access-denied'});await stream('/resource?id='+id,res,req.headers.range,u.searchParams.get('download')==='1');return true;
   }
   if(req.method==='GET'&&p==='/v2/offline/preview'){
    const id=u.searchParams.get('id'),offset=u.searchParams.get('offset')||'0';
    if(!/^\d+$/.test(id||'')||!/^\d{1,6}$/.test(offset))return send(400,{error:'invalid-resource'});
    const record=(await localCatalog()).find(r=>String(r.locationId)===id&&r.availabilityState==='present');
    if(!await permittedResourceId(id,req))return send(403,{error:'resource-access-denied'});
    if(record&&/\.pdf$/i.test(record.name)){
     res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self'",'Cache-Control':'no-store'});
     res.end(pdfPreviewPage(record.name,id));return true;
    }
    const raw=await request('/preview-document?id='+id+'&offset='+offset);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",'Cache-Control':'no-store'});
    res.end(previewPage(raw,id,clean,location));return true;
   }
   if(req.method==='GET'&&p==='/v2/offline/role-read'){
    const unit=u.searchParams.get('unit');if(!roleIndexEnabled||!roleGrants.has(unit))return send(403,{error:'role-read-not-authorized'});
    const raw=await readRoleContext(unit);
    return send(200,{unitId:unit,knowledgeUnit:raw.knowledgeUnit,contextBoundary:raw.boundary,nextOffset:raw.nextOffset,blocks:(raw.blocks||[]).map(b=>({...b,locator:location(b.locator),text:clean(b.text)}))});
   }
   if(req.method==='GET'&&p==='/v2/offline/read'){
    const id=u.searchParams.get('block');if(!/^\d+$/.test(id||''))return send(400,{error:'invalid-block'});
    const raw=await request('/read?block='+id);const origin=raw.locations?.[0];if(origin&&!await permittedResource({name:origin.name||path.win32.basename(origin.path||''),sha256:raw.sha256},req))return send(403,{error:'resource-access-denied'});const csv=(raw.locations||[]).some(l=>/\.csv$/i.test(l.path));
    return send(200,{sha256:raw.sha256,blocks:(raw.blocks||[]).map(b=>({blockId:b.id,locator:location(b.locator),text:clean(csv?b.text.split(' | ').slice(0,3).join(' | '):b.text)}))});
   }
   if(req.method==='GET'&&p==='/v2/offline/case'){
    const c=caseMap.get(u.searchParams.get('id'));return c?send(200,caseView(c)):send(404,{error:'case-not-found'});
   }
   if(req.method==='GET'&&['/v2/offline/search','/v2/offline/cases'].includes(p)){
    const q=(u.searchParams.get('q')||'').trim(),mode=u.searchParams.get('mode')||'all';
    if(!q||q.length>240||!['all','files','text'].includes(mode))return send(400,{error:'invalid-query'});
    const limit=Number(u.searchParams.get('limit')||10);
    if(!Number.isInteger(limit)||limit<1||limit>50)return send(400,{error:'invalid-search-filter'});
    if(p.endsWith('/cases'))return send(200,await caseSearchWithDocuments(q,u.searchParams.get('model')));
    if(u.searchParams.get('view')==='list'&&mode==='all'){
     // The file-oriented browser has a dedicated opt-in. Group before applying
     // the 50-result limit, not after 50 raw body passages have been returned.
     // AI/expert/case retrieval still use the unchanged fine-grained endpoint.
     const data=await search(q,'all',{limit,groupDocuments:true});
     return send(200,{...data,view:'list',retrieval:'document-grouped-before-limit',limit});
    }
    return send(200,await search(q,mode,{limit}));
   }
   if(req.method==='POST'&&chat){
    const kind=req.headers['x-v2-offline-knowledge']||'all';if(!['all','files','text','cases'].includes(kind))return send(400,{error:'invalid-search-mode'});
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)return send(413,{error:'body-too-large'});chunks.push(chunk);}
    let input;try{input=JSON.parse(Buffer.concat(chunks));}catch{return send(400,{error:'invalid-json'});}
    const requestedMode=input.mode||req.headers['x-v2-mode']||'quick';if(!['quick','expert'].includes(requestedMode))return send(400,{error:'invalid-mode'});
    if(typeof input.message!=='string'||!input.message.trim()||input.message.length>8000)return send(400,{error:'invalid-query',reply:'请输入8000字以内的问题。'});
    if(inFlight.has(input.sessionId))return send(409,{status:'busy',error:'session-request-active',reply:'当前会话仍在处理，请等待完成。'});
    let state;try{state=sessions.update(input.sessionId||'anon-'+randomUUID(),input);}catch(e){return send(400,{error:e.message});}
    let onProgress;try{onProgress=progress.begin(state.id,input.requestId);}catch{return send(409,{error:'progress-request-reused'});}
    let progressCompleted=false;inFlight.add(state.id);sessions.begin(state.id);
    try{
    const diagnosticState=require('../../domain/parser/customer-language.cjs').diagnosticContext(input.message,state,answers.expertClassify(input.message,state));
    state=sessions.recordResult(state.id,{kind:'diagnostic-context',query:input.message,diagnosticState});
    if(requestedMode==='expert'){
     // Apply customer-origin engineering edits through the same deterministic
     // task update used by quick mode; assistant/model prose never changes slots.
     const taskPlan=quickRetrieval.plan(input.message,state).taskPlan;
     if(taskPlan.ordering){
      const update=await quickRetrieval.answer(input.message,{state,facts:state.facts,currentFacts:input.facts||{},onProgress});
      state=sessions.recordResult(state.id,{kind:'all',query:input.message,intent:update.intent,quickContext:update.quickContext,evidenceIds:[]});
      if(update.result?.planningStatus==='conditional'){
       const {routeLog,quickContext,queryPlan,retrievalTrace,...customerData}=update;
       const output={...customerData,requestedMode,actualMode:'quick',modelStatus:'not-used',model:'v2-ordering-calculator',modelCallCount:0,executionReason:'validated-conditional-ordering',results:customerData.results||[]};
       state=sessions.recordAnswer(state.id,output);progressCompleted=true;onProgress('completed');return send(200,{...output,sessionState:state});
      }
     }
     state=sessions.expertState(state.id);
     if(!expert)return send(503,{status:'unavailable',actualMode:'expert',modelStatus:'unavailable',error:'expert-not-configured',reply:'专家模式未连接本地模型，请选择快速模式。',results:[],sessionState:state});
     const route=answers.expertClassify(input.message,state),readableBlocks=new Map();
     const expertEvidence=require('./expert-evidence.cjs').createExpertEvidence({request,searchCases,caseMap,clean,location,defaultModels:route.models||[],roleIndexEnabled,roleRequest});
     const calculateOrdering=require('./expert-ordering.cjs').createExpertOrdering({app,userMessages:state.messages.filter(m=>m.role==='user').map(m=>m.content)});
     const execute=async(name,args)=>{
      onProgress(name==='read_document'?'reading':'searching');
      if(name==='calculate_ordering')return calculateOrdering(args);
      if(name==='read_document'){
       const context=await expertEvidence.read(args);if(context)return context;
       if(!Number.isInteger(args.blockId)||!readableBlocks.has(args.blockId))throw Error('expert-invalid-tool');
       const parent=readableBlocks.get(args.blockId),raw=await request('/read?block='+args.blockId);for(const b of raw.blocks||[])readableBlocks.set(b.id,parent);return {evidence:(raw.blocks||[]).map(b=>({evidenceId:'block-'+b.id,blockId:b.id,name:parent.name,download:parent.download,readUrl:'/v2/offline/read?block='+b.id,text:clean(b.text),locator:location(b.locator)}))};
      }
      if(['cases','text','faq','firmware'].includes(args.kind))return expertEvidence.search(args);
      if(roleIndexEnabled&&['products','files'].includes(args.kind))return expertEvidence.search(args);
      if(typeof args.query!=='string'||!args.query.trim()||args.query.length>240||!['text','files','cases','products','resources'].includes(args.kind))throw Error('expert-invalid-tool');
      let planned=answers.classify(args.query);
      planned.hardwareRequested=route.hardwareRequested||planned.hardwareRequested;
      if(['products','resources'].includes(args.kind)&&route.models.length&&!planned.models.length)planned={...planned,query:route.models.join(' ')+' '+planned.query,models:route.models};
      if(args.kind==='cases')planned={...planned,intent:'aftersales'};
      if(args.kind==='products')planned={...planned,intent:'product'};
      if(args.kind==='resources')planned={...planned,intent:'resources',category:planned.category||route.category};
      const data=['products','resources','cases'].includes(args.kind)?await answers.answer(planned,{facts:state.facts,sessionId:state.id+'-tool'}):await search(planned.query,args.kind,{limit:8});
      if(!data.retrievalTrace)data.results=answers.filter(planned.query,data.results,planned.models).slice(0,4);
      for(const r of data.results||[])if(r.blockId)readableBlocks.set(r.blockId,r);
      let evidence=(data.results||[]).slice(0,4).map((r,i)=>({evidenceId:r.id||r.evidenceId||r.resourceId||'evidence-'+require('node:crypto').createHash('sha256').update(JSON.stringify([r.name,r.text,r.download])).digest('hex').slice(0,16),blockId:r.blockId||null,name:clean(r.name||r.sources?.[0]?.name||('历史案例：'+(r.title||'未命名'))).split(/\r?\n/)[0].slice(0,110),text:clean(r.sourceExcerpt||r.text||r.phenomenon||r.name||'').slice(0,1000),scope:r.scope||null,modelIds:r.modelIds||r.mentionedModels||planned.models,verificationStatus:r.verificationStatus||'unknown',locator:r.locator||(r.sources?.[0]?.locator?{section:r.sources[0].locator}:null),readUrl:r.readUrl||null,download:r.download||r.sources?.find(s=>s.original)?.original||null,referenceOnly:true}));
      if(planned.intent==='product'){
       const anchor=/HUB75E?|HDMI|DVI|USB/i.exec(planned.query)?.[0],query=anchor?planned.models.join(' ')+' '+anchor:planned.query;
       const body=await search(query,'text',{limit:8}),relevant=answers.filter(query,body.results,planned.models).slice(0,4);
       const passages=relevant.map(r=>{if(r.blockId)readableBlocks.set(r.blockId,r);return {evidenceId:r.evidenceId,blockId:r.blockId,name:r.name,text:r.text.slice(0,1000),download:r.download,readUrl:r.readUrl,locator:r.locator,modelIds:planned.models,verificationStatus:'original-passage-not-compatibility'};});
       evidence=[...passages,...evidence];
      }
      const wanted=/接口|HUB|网口/i.test(planned.query)?'ports':/带载|像素|分辨率/i.test(planned.query)?'load':null;
      const claims=[];for(const product of data.result?.knowledge?.records||[])for(const c of (product.claims||[]).filter(c=>!wanted||c.field===wanted).slice(0,3)){const ref=c.sourceReference;if(ref)claims.push({evidenceId:c.claimId,name:ref.originalName||product.displayName+' 产品索引',text:c.text,download:ref.url||null,locator:ref.page?{page:ref.page}:ref.record?{row:ref.record}:null,modelIds:[product.modelId],verificationStatus:c.verificationStatus||'indexed-not-content-verified'});}
      if(planned.intent==='product'){const near=await expertEvidence.search(args);evidence=[...near.evidence,...claims,...evidence.filter(e=>!e.blockId)];}
      return {intent:planned.intent,notice:{status:data.status||'completed',category:planned.category||null,exactModels:planned.models||[],userModels:route.models||[],additionalModels:(planned.models||[]).filter(m=>!route.models.includes(m)),resultCount:data.results?.length||0,compatibilityConfirmed:false,searchSemantics:args.kind==='resources'?'按精确型号和资料类别查目录；HD前缀及同义词改写不改变目录。如有新的原文目标可用files/text；缺说明书不能以规格书替代':null},evidence:evidence.slice(0,6)};
     };
    const controller=new AbortController(),disconnected=()=>{if(!res.writableEnded)controller.abort();};modelRequests.set(state.id,controller);res.once('close',disconnected);
    let output;try{output=await expert.answer({message:input.message,sessionState:state,execute,route,signal:controller.signal,onProgress});}finally{res.off('close',disconnected);if(modelRequests.get(state.id)===controller){modelRequests.delete(state.id);}}
    progressCompleted=output.status!=='unavailable';onProgress(progressCompleted?'completed':'failed');
    state=sessions.recordAnswer(state.id,output);try{logs?.activity({sessionId:state.id,...require('./access-entry.cjs').accessEntry(req),mode:'expert',message:input.message,intent:route.intent,status:output.status,error:output.error||null,modelCalls:output.modelCalls||[],toolTrace:output.toolTrace||[],modelCallCount:output.modelCallCount||0,toolCallCount:output.toolCallCount||0,toolRequestCount:output.toolRequestCount||0,elapsedMs:output.elapsedMs});}catch{}if(res.destroyed)return true;return send(output.status==='unavailable'?503:output.status==='busy'?429:200,{...output,requestedMode,routing:route,sessionState:state});
    }
    const query=input.continueQuery===true&&state.messages.length>1?state.messages.filter(m=>m.role==='user').slice(-2).map(m=>m.query||m.content).join(' '):input.message;
    const started=Date.now();
    const data=await quickRetrieval.answer(query,{state,facts:state.facts,currentFacts:input.facts||{},onProgress});
    state=sessions.recordResult(state.id,{kind,query,intent:data.intent,quickContext:data.quickContext,evidenceIds:(data.results||[]).map(r=>r.id||r.evidenceId||r.resourceId).filter(Boolean)});
    const {routeLog,quickContext,queryPlan,retrievalTrace,candidateCount,retrievalPolicy,sourceFailures,...customerData}=data;
    const customerResults=(customerData.results||[]).map(({rankingSignals,...evidence})=>evidence);
    const output={status:'answer',requestedMode:'quick',actualMode:'quick',modelStatus:'not-used',model:'v2-offline-search',kind,...customerData,results:customerResults,elapsedMs:Date.now()-started,sessionState:state};
    try{logs?.activity({sessionId:state.id,...require('./access-entry.cjs').accessEntry(req),mode:'quick',message:input.message,intent:data.intent,quickRoute:routeLog,retrievalTrace:data.retrievalTrace||[],resultCount:data.results.length,elapsedMs:output.elapsedMs});}catch{}
    state=sessions.recordAnswer(state.id,output);progressCompleted=true;onProgress('completed');return send(200,{...output,sessionState:state});
    }finally{onProgress(progressCompleted?'completed':'failed');inFlight.delete(state.id);sessions.end(state.id);}
   }
   return send(404,{error:'offline-route-not-found'});
  }catch{if(!res.headersSent)return send(503,{error:'resource-service-unavailable',reply:'资料服务暂不可用。产品速查和已有工程配单仍可独立使用。'});res.destroy();return true;}
 }
 return {handle,searchCases,resolveDocuments,localizeMedia,localCatalog,productFacts,authorizeResources,directoryCatalog,authorizeVideoMedia:authorizeResources};
}
module.exports={createOfflineKnowledge};
