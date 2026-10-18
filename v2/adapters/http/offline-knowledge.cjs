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
const clean=s=>String(s||'').replace(/[A-Za-z]:[\\/][^\r\n|<>"']+|\\\\[^\r\n|<>"']+/g,'[内部路径]').replace(/(?<!\d)1[3-9]\d{9}(?!\d)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[联系方式]');
const location=l=>Object.fromEntries(Object.entries(l||{}).filter(([k])=>['page','paragraph','table','row','sheet','slide','section','line','part','charStart','charEnd'].includes(k)).map(([k,v])=>[k,typeof v==='string'?clean(v):v]));
function createOfflineKnowledge({knowledge,resourceBase='http://127.0.0.1:4510',sessionDirectory,logs=null,images=null,expert=null}={}){
 const sessions=createOfflineSessions(sessionDirectory);
 const base=new URL(resourceBase);if(base.protocol!=='http:'||base.hostname!=='127.0.0.1')throw Error('offline resources require loopback');
 const cases=(knowledge?.cases()||[]).map(c=>consumeCase(c,knowledge.evidenceCaseReviews?.()||[]));
 const caseMap=new Map(cases.map(c=>[c.stableId,c]));
 const knownModels=new Set(cases.flatMap(c=>c.modelIds||[]));
 for(const p of knowledge?.products()||[])knownModels.add(p.modelId);
 const documentLinks=new Map();
 for(const p of knowledge?.products()||[])for(const d of [...p.documents||[],...p.firmware||[]]){
  const url=d.url||d.publicUrl;if(url?.startsWith('/')&&!url.startsWith('//'))documentLinks.set(new URL(url,'http://localhost').pathname,{name:d.name||d.file,sha256:d.sha256||d.sourceReference?.originalSha256});
 }
 const originals=new Set((knowledge?.evidenceDocuments()||[]).map(x=>x.document.sha256));
 const normalize=r=>({name:clean(r.name),matchKind:r.kind||null,resourceId:r.resourceId||null,versionId:r.versionId||null,resourceVersionId:r.versionId||null,fileId:r.sha256?'sha256:'+r.sha256:r.versionId||null,sha256:r.sha256||null,blockId:r.blockId||null,
  extension:path.extname(r.name||'').toLowerCase(),sourceDirectory:clean(String(r.locations?.[0]?.path||'').replace(/\\/g,'/').split('/').slice(1,-1).slice(-3).join(' / ')),localModifiedAt:r.locations?.[0]?.mtime_ns?new Date(r.locations[0].mtime_ns/1e6).toISOString():null,
  evidenceId:r.sha256&&r.blockId?'blk-'+r.sha256.slice(0,16)+'-'+r.ordinal:null,
  text:clean(/\.csv$/i.test(r.name||'')?String(r.text||'').split(' | ').slice(0,3).join(' | '):r.text),
  locator:location(r.locator),versions:r.versions||[],mentionedModels:r.mentionedModels||[],scopeStatus:'原文提及或目录线索，不代表兼容性确认',
  score:r.score,download:(r.locationId||r.locations?.[0]?.id)?fileUrl(r.locationId||r.locations[0].id,r.name):null,
  readUrl:r.blockId?'/v2/offline/read?block='+r.blockId:null});
 async function request(route){const r=await fetch(resourceBase+route,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('resource service unavailable');return r.json();}
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
 async function search(q,mode='all',{limit=10}={}){
  const raw=await request('/search?q='+encodeURIComponent(q)+'&mode='+mode+'&limit='+limit);
  return {query:q,elapsedMs:raw.elapsedMs,requestedModels:raw.requestedModels||[],results:(raw.results||[]).map(normalize)};
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
 async function localizeMedia(value,{metadataOnly=false}={}){
  const body=JSON.parse(JSON.stringify(value)),targets=[],resources=body.video?(await localCatalog()).filter(r=>r.sourceDrive==='G:'&&r.availabilityState==='present'):[];
  if(body.video){const seen=new Set((body.video.groups||[]).flatMap(g=>g.videos||[]).map(v=>v.name)),extra=[];for(const r of resources)if(/\.(mp4|webm)$/i.test(r.name)&&/[\u4e00-\u9fff]/.test(r.name)&&(!body.query||r.name.toLowerCase().includes(String(body.query).toLowerCase()))&&!seen.has(r.name)){seen.add(r.name);extra.push({name:r.name,url:'/v2/offline/file?id='+r.locationId,sizeBytes:r.sizeBytes,sizeText:Math.round(r.sizeBytes/1048576)+' MB',sourceMode:'local',kind:'local-original'});}if(extra.length){const group={key:'local-originals',label:'新增本地视频',count:extra.length,videos:extra};body.video.groups.push(group);if(body.video.topicGroups)body.video.topicGroups.push(group);body.video.total+=extra.length;}}
  if(body.video){const registered=body.video.groups.flatMap(g=>g.videos).filter(v=>resources.some(r=>r.name===v.name&&(!v.sha256||r.sha256===v.sha256)));body.video.hiddenNonLocalCount=body.video.groups.reduce((n,g)=>n+g.videos.length,0)-registered.length;body.video.groups=[{key:'registered-local',videos:registered}];body.video.sourcePolicy='registered-present-G-drive-only';}
  if(body.video){const selection=require('../../domain/knowledge/video-purpose.cjs').operationVideos(body.video.groups.flatMap(g=>g.videos),resources);body.video.groups=[{key:'operations',label:'操作视频',videos:selection.selected,count:selection.selected.length}];body.video.topicGroups=[];body.video.total=selection.selected.length;body.video.excludedNonOperationCount=selection.withheld.length;body.video.purposePolicy='operation-videos; source-folders-primary';}
  if(metadataOnly&&body.video){const groups=groupVideos(body.video.groups.flatMap(g=>g.videos),resources);return {cat:'video',metadataOnly:true,countStatus:'registered-candidates-not-availability-verified',total:groups.reduce((n,g)=>n+g.count,0),groups:groups.map(g=>({key:g.key,label:g.label,count:g.count}))};}
  function visit(x){if(Array.isArray(x)){x.forEach(visit);return;}if(!x||typeof x!=='object')return;
   if(/\.(bin|mp4|webm|mov)$/i.test(x.name||x.file||'')&&(x.url||x.publicUrl))targets.push(x);
   for(const v of Object.values(x))if(typeof v==='object')visit(v);
  }visit(body);
  if(!targets.length)return body;
  const expectedHash=x=>x.sha256||(x.sourceReferences||[]).find(r=>r.originalSha256)?.originalSha256||null,identity=x=>(x.name||x.file)+'|'+(expectedHash(x)||'unconfirmed');
  const unique=[...new Map(targets.map(x=>[identity(x),x])).values()];
  let results=[];for(let offset=0;offset<unique.length;offset+=256){const batch=unique.slice(offset,offset+256);try{const r=await fetch(resourceBase+'/resolve-assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:batch.map(x=>({name:x.name||x.file,sha256:expectedHash(x)}))}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('asset-resolution-failed');results.push(...(await r.json()).results);}catch{results.push(...batch.map(()=>null));}}
  const byName=new Map(unique.map((x,i)=>[identity(x),results[i]]));
  for(const x of targets){const r=byName.get(identity(x));if(r?.available){const url='/v2/offline/file?id='+r.locationId;for(const key of ['url','publicUrl'])if(x[key])x[key]=url;x.sourceMode='local';x.localAvailable=true;x.available=true;x.localSizeBytes=r.sizeBytes;x.resourceId=r.resourceId||null;x.resourceVersionId=r.versionId||null;x.versionId=r.versionId||null;x.fileId=r.sha256?'sha256:'+r.sha256:r.versionId||null;if(r.sha256)x.sha256=r.sha256;if(/\.(mp4|webm|mov)$/i.test(x.name||x.file)){x.sizeBytes=r.sizeBytes;x.sizeText=Math.round(r.sizeBytes/1048576)+' MB';}}else{const cloud=/^https?:/.test(x.url||x.publicUrl||'');x.sourceMode=cloud?'cloud-fallback':'unavailable';x.available=cloud;x.localAvailable=false;x.localUnavailableReason=r?.reason||'local-resource-service-unavailable';x.unavailableReason=cloud?null:x.localUnavailableReason;x.unavailableMessage=cloud?null:'本地原件尚未确认，暂不可下载';if(!cloud&&x.downloadUrl)x.downloadUrl=null;if(x.clean)x.clean+=cloud?'（云端备用）':'（本地原件待核对）';if(!cloud){if(x.url)x.url=null;if(x.publicUrl)x.publicUrl=null;}}}
  if(body.video){const allowedIds=new Set(resources.map(r=>String(r.locationId)));const groups=groupVideos(body.video.groups.flatMap(g=>g.videos).filter(v=>v.localAvailable&&/^\/v2\/offline\/file\?id=\d+$/.test(v.url||'')&&allowedIds.has(new URL(v.url,'http://local').searchParams.get('id'))),resources);for(const g of groups)g.videos=g.videos.map(v=>resourceView({...v,classificationBasis:v.categoryBasis?.join(';')||null,associationStatus:'source-category-not-compatibility'},{kind:'video'}));body.video.groups=groups;body.video.topicGroups=groups;body.video.total=groups.reduce((n,g)=>n+g.count,0);body.video.grouping='product-category-and-original-operation';}
  if(body.docs&&body.docs.pagination?.limit===null){const available=body.docs.items.filter(i=>i.available&&i.url);body.docs.uniqueAvailableFileCount=new Set(available.map(i=>i.fileId||i.sha256||i.name)).size;}
  return body;
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
    if(!logs)return send(503,{error:'log-store-not-configured'});if(!logs.authorized(req.headers['x-upload-key']))return send(403,{error:'upload-key-required'});return send(200,logs.receive(b));}
   if(req.method==='GET'&&p==='/v2/offline/session'){return send(200,sessions.get(u.searchParams.get('id')));}
   if(req.method==='GET'&&p==='/v2/offline/log-status')return send(200,logs?.status()||{configured:false});
   if(legacy){const d=documentLinks.get(p),raw=await request('/search?q='+encodeURIComponent(d.name)+'&mode=files&limit=10');const file=(raw.results||[]).find(r=>r.kind==='file'&&Number.isInteger(r.locationId)&&r.name===d.name&&(!d.sha256||r.sha256===d.sha256));if(!file)return send(404,{error:'original-not-located',message:'索引中尚未定位此版本原件，请使用资料搜索核对版本。'});const target=fileUrl(file.locationId,d.name);if(target.includes('/preview?')){res.writeHead(302,{Location:target});res.end();return true;}await stream('/resource?id='+file.locationId,res);return true;}
   if(original){await stream(p,res);return true;}
   if(req.method==='GET'&&p==='/v2/offline/client.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'../../frontend/offline-client.js')));return true;}
   if(req.method==='GET'&&p==='/v2/offline/status')return send(200,{mode:'no-model',knowledgeVersion:knowledge?.version,caseCount:cases.length,sourceService:'local-read-only-index',catalogStatus:localCatalog.status()});
   if(req.method==='GET'&&p==='/v2/offline/capabilities')return send(200,{defaultMode:'quick',modes:['quick','expert'],expert:expert?await expert.status():{available:false,reason:'not-configured',model:null},ordering:'deterministic-rules-only'});
   if(req.method==='GET'&&p==='/v2/offline/file'){
    const id=u.searchParams.get('id');if(!/^\d+$/.test(id||''))return send(400,{error:'invalid-resource'});await stream('/resource?id='+id,res,req.headers.range,u.searchParams.get('download')==='1');return true;
   }
   if(req.method==='GET'&&p==='/v2/offline/preview'){
    const id=u.searchParams.get('id'),offset=u.searchParams.get('offset')||'0';
    if(!/^\d+$/.test(id||'')||!/^\d{1,6}$/.test(offset))return send(400,{error:'invalid-resource'});
    const record=(await localCatalog()).find(r=>String(r.locationId)===id&&r.availabilityState==='present');
    if(record&&/\.pdf$/i.test(record.name)){
     res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self'",'Cache-Control':'no-store'});
     res.end(pdfPreviewPage(record.name,id));return true;
    }
    const raw=await request('/preview-document?id='+id+'&offset='+offset);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",'Cache-Control':'no-store'});
    res.end(previewPage(raw,id,clean,location));return true;
   }
   if(req.method==='GET'&&p==='/v2/offline/read'){
    const id=u.searchParams.get('block');if(!/^\d+$/.test(id||''))return send(400,{error:'invalid-block'});
    const raw=await request('/read?block='+id);const csv=(raw.locations||[]).some(l=>/\.csv$/i.test(l.path));
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
     const started=Date.now(),half=Math.ceil(limit/2),[files,text]=await Promise.all([search(q,'files',{limit:half}),search(q,'text',{limit:half})]);
     const results=[];for(let i=0;i<half;i++)for(const source of [files,text])if(source.results[i]&&results.length<limit)results.push(source.results[i]);
     return send(200,{query:q,elapsedMs:Date.now()-started,requestedModels:[...new Set([...files.requestedModels,...text.requestedModels])],results,view:'list',retrieval:'filename-and-body-separate-recall',limit});
    }
    return send(200,await search(q,mode,{limit}));
   }
   if(req.method==='POST'&&chat){
    const kind=req.headers['x-v2-offline-knowledge']||'all';if(!['all','files','text','cases'].includes(kind))return send(400,{error:'invalid-search-mode'});
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)return send(413,{error:'body-too-large'});chunks.push(chunk);}
    let input;try{input=JSON.parse(Buffer.concat(chunks));}catch{return send(400,{error:'invalid-json'});}
    const requestedMode=input.mode||req.headers['x-v2-mode']||'quick';if(!['quick','expert'].includes(requestedMode))return send(400,{error:'invalid-mode'});
    if(typeof input.message!=='string'||!input.message.trim()||input.message.length>240)return send(400,{error:'invalid-query',reply:'请输入240字以内的型号、故障现象或检索词。'});
    let state;try{state=sessions.update(input.sessionId||'anon-'+randomUUID(),input);}catch(e){return send(400,{error:e.message});}
    if(requestedMode==='expert'){
     if(!expert)return send(503,{status:'unavailable',actualMode:'expert',modelStatus:'unavailable',error:'expert-not-configured',reply:'专家模式未连接本地模型，请选择快速模式。',results:[],sessionState:state});
     const readableBlocks=new Set();
     const execute=async(name,args)=>{
      if(name==='read_document'){
       if(!Number.isInteger(args.blockId)||!readableBlocks.has(args.blockId))throw Error('expert-invalid-tool');
       const raw=await request('/read?block='+args.blockId);for(const b of raw.blocks||[])readableBlocks.add(b.id);return {evidence:(raw.blocks||[]).map(b=>({evidenceId:'block-'+b.id,blockId:b.id,text:clean(b.text),locator:location(b.locator)}))};
      }
      if(typeof args.query!=='string'||!args.query.trim()||args.query.length>240||!['text','files','cases'].includes(args.kind))throw Error('expert-invalid-tool');
      const data=args.kind==='cases'?await caseSearchWithDocuments(args.query,null,state.facts):await search(args.query,args.kind);
      for(const r of [...(data.results||[]),...(data.rawEvidence||[])])if(r.blockId)readableBlocks.add(r.blockId);
      return {evidence:[...(data.results||[]),...(data.rawEvidence||[])].map(r=>({evidenceId:r.id||r.evidenceId||r.resourceId,blockId:r.blockId||null,name:r.name||r.title,text:r.sourceExcerpt||r.text||'',scope:r.scope||null,modelIds:r.modelIds||r.mentionedModels||[],verificationStatus:r.verificationStatus||'unknown',locator:r.locator||null,readUrl:r.readUrl||null,download:r.download||null,referenceOnly:true}))};
     };
     const output=await expert.answer({message:input.message,sessionState:state,execute});try{logs?.activity({sessionId:state.id,...require('./access-entry.cjs').accessEntry(req),mode:'expert',message:input.message,status:output.status});}catch{}return send(output.status==='unavailable'?503:output.status==='busy'?429:200,{...output,requestedMode,sessionState:state});
    }
    const query=input.continueQuery===true&&state.messages.length>1?state.messages.slice(-2).map(m=>m.query||m.content).join(' '):input.message;
    const data=kind==='cases'?await caseSearchWithDocuments(query,null,state.facts):await search(query,kind);
    state=sessions.recordResult(state.id,{kind,query,evidenceIds:[...data.results,...data.rawEvidence||[]].map(r=>r.id||r.evidenceId||r.resourceId).filter(Boolean)});
    try{logs?.activity({sessionId:state.id,...require('./access-entry.cjs').accessEntry(req),mode:'quick',message:input.message,kind,resultCount:data.results.length});}catch{/* Log storage failure must not discard a completed search. */}
    return send(200,{status:'answer',requestedMode:'quick',actualMode:'quick',modelStatus:'not-used',model:'v2-offline-search',reply:data.results.length?(kind==='cases'?'以下是相关历史记录，请先核对适用条件。':'以下是找到的原始资料及正文。'):data.rawEvidence?.length?'未找到对应结构化案例，以下是相关原文参考。':'未找到匹配记录。请补充完整型号、软件版本或更具体的关键词。',kind,...data,sessionState:state});
   }
   return send(404,{error:'offline-route-not-found'});
  }catch{if(!res.headersSent)return send(503,{error:'resource-service-unavailable',reply:'资料服务暂不可用。产品速查和已有工程配单仍可独立使用。'});res.destroy();return true;}
 }
 return {handle,searchCases,resolveDocuments,localizeMedia,localCatalog};
}
module.exports={createOfflineKnowledge};
