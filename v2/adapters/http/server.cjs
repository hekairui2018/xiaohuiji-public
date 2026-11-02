'use strict';
const http=require('node:http');
const {createApp}=require('../../app/bootstrap.cjs');
const {createQuickService}=require('./quick-service.cjs');
const {createDialogueService}=require('./dialogue-service.cjs');
const {serveStatic}=require('./static-service.cjs');
const {createOriginalResource}=require('./original-resource.cjs');
function assembleFirmwareSearch(body,query,registry){
 if(!registry)return body;
 const key=value=>String(value||'').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
 const group=registry.docs().groups.find(g=>key(g.model)===key(query));
 if(!group?.items.length||!group.items.every(item=>item.category==='接收卡'))return body;
 const official=require('../../data/official-models-20261027.json').rows;
 if(official.some(row=>row.official&&key(row.model)===key(group.model)))return body;
 const modelId='HD-'+key(group.model),firmwareGroup={key:'firmware',label:'固件',items:group.items.map(item=>({...item}))};
 const fill=product=>({...product,name:product.name||modelId,displayName:product.displayName||modelId,modelId,
  specGroups:(product.specGroups||[]).filter(g=>g.key!=='firmware'),
  docGroups:[...(product.docGroups||[]).filter(g=>g.key!=='firmware'),firmwareGroup],firmwareGroup,
  resourceGroups:[...(product.resourceGroups||[]).filter(g=>g.key!=='firmware'),firmwareGroup]});
 let found=false;
 const results=(body.results||[]).map(product=>{if(key(product.modelId||product.name)!==key(group.model))return product;found=true;return fill(product);});
 if(!found)results.push(fill({features:{},specFiles:[],specLinks:[]}));
 return {...body,results,count:results.length,productCount:results.length};
}
function createServer(app=createApp(),{localKnowledge=null,offlineKnowledge=null,accessGuard=null,publicCatalog=null,publicChat=null,developmentMonitor=null,graydeskReceiver=null,curatedLocalVideos=null,curatedLocalDocuments=null,curatedLocalFirmware=null,firmwareScope=null,curatedResources=null,sectionSearch=null,competitiveKnowledge=null,assistantUpdates=null,graydeskUpdates=null,gatewayTrust=null,serveFrontend=true}={}){
 // Customer HTTP routes always use the activation-gated pipeline. Raw domain remains for audits.
 app={...app,dialogue:app.customerDialogue||app.dialogue};
 const publicQuick=createQuickService(publicCatalog?.scopeApp?publicCatalog.scopeApp(app):app);
 const localQuick=createQuickService(app,{resolveDocuments:offlineKnowledge?.resolveDocuments,localCatalog:offlineKnowledge?.localCatalog,productFacts:offlineKnowledge?.productFacts}),dialogue=createDialogueService(app),original=createOriginalResource({evidenceDocuments:app.originalDocuments});
 const orderingDialogue=createDialogueService(app,{operation:'ordering'});
 const wikiAdmin=require('./wiki-admin.cjs').createWikiAdmin();
 const curatedSearch=()=>{if(!curatedResources)throw Error('curated-search-not-configured');return curatedResources;};
 const catalogResponse=require('./catalog-response-cache.cjs').createCatalogResponseCache({staleMs:60000});
 const localMedia=async body=>offlineKnowledge?.localizeMedia?offlineKnowledge.localizeMedia(body):body;
 const list=require('./catalog-list.cjs').catalogList;
 // Only explicitly registered software manuals join the public file surface.
 const softwareManuals=curatedLocalDocuments?.publicSoftwareResources?.()||[];
 const softwareManualPaths=new Set(softwareManuals.map(x=>x.url));
 for(const route of softwareManualPaths)require('./public-routes.cjs').publicGetRoutes.add(route);
 function restoreSoftwareLinks(original,value){
  if(Array.isArray(original))return original.map((item,i)=>restoreSoftwareLinks(item,value?.[i]));
  if(!original||typeof original!=='object')return value;
  const out={...value};for(const [key,item] of Object.entries(original))if(item&&typeof item==='object'&&Object.hasOwn(out,key))out[key]=restoreSoftwareLinks(item,out[key]);
  const file=softwareManuals.find(x=>x.name===original.name&&x.sha256===original.sha256);
  if(file){out.url=file.url;out.downloadUrl=file.downloadUrl;out.previewUrl=file.url;out.available=true;out.unavailableReason=null;out.unavailableMessage=null;}
  return out;
 }
 const loadDocs=async(cat,options,listOnly)=>{const body=await localMedia(await localQuick.docs(cat,options));return listOnly?list(body):body;};
 const docKey=(cat,history,offset,limit,view,listOnly)=>JSON.stringify([cat,history,offset,limit,view,listOnly]);
 const inFlight=new Map();let maintenanceUntil=0;
 let configurationSnapshot=null,configurationPending=null;
 async function configurationCatalog(req){
  if(configurationSnapshot&&Date.now()-configurationSnapshot.time<30000)return configurationSnapshot;
  if(configurationPending)return configurationPending;
  configurationPending=(async()=>{
   const entries=await offlineKnowledge.configurationFiles(req,''),catalog=require('../../domain/knowledge/source-directory.cjs');
   const version=require('node:crypto').createHash('sha256').update(JSON.stringify(entries)).digest('hex');
   return configurationSnapshot={entries,index:catalog.createDirectoryIndex(entries),version,time:Date.now()};
  })().finally(()=>{configurationPending=null;});
  return configurationPending;
 }
 const server=http.createServer(async(req,res)=>{
  if(gatewayTrust&&!gatewayTrust(req,res))return;
  if(accessGuard&&!accessGuard(req,res))return;
  const strictApproved=offlineKnowledge?.health?.().catalog?.status==='approved-sql';
  if(strictApproved){
   delete req.headers['x-internal-token'];delete req.headers['x-internal-purpose'];
   const infrastructurePath=req.url.split('?')[0];
   const infrastructureRequest=(req.method==='POST'&&['/api/huidu/log','/api/graydesk/errors'].includes(infrastructurePath))||require('../../external-services/assistant-updates.cjs').isUpdateRoute(req.method,infrastructurePath)||require('../../external-services/graydesk-updates.cjs').isPublicRoute(req.method,infrastructurePath);
   if(req.v2Public&&!infrastructureRequest){
    const p=req.url.split('?')[0],allowed=req.method==='GET'&&(['/','/wiki','/health','/api/health','/api/search','/api/docs','/api/videos','/api/software'].includes(p)||/^\/v2\/curated-(?:documents(?:-preview)?|videos|firmware)\//.test(p)||/\.(?:js|css|png|svg|ico|webp)$/.test(p));
    if(!allowed){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'approved-public-scope-only'}));return;}
    req.v2Public=false;
   }
  }
  if(!serveFrontend&&['/v2/offline/client.js','/v2/local-knowledge/client.js'].includes(req.url.split('?')[0])){res.writeHead(404);res.end();return;}
  const operationRoute=req.url.split('?')[0],isControl=operationRoute==='/api/operations/maintenance',isHealth=['/health','/api/health'].includes(operationRoute);
  if(isControl){
   const local=['127.0.0.1','::1'].includes(require('./request-peer.cjs').peerAddress(req))&&/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'')&&!req.v2Public&&!req.headers.origin;
   if(!local||!['GET','POST','DELETE'].includes(req.method)){res.writeHead(403);res.end();return;}
   if(req.method==='POST')maintenanceUntil=Date.now()+300000;
   if(req.method==='DELETE')maintenanceUntil=0;
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({active:inFlight.size,maintenance:Date.now()<maintenanceUntil,routes:[...inFlight.values()]}));return;
  }
  if(Date.now()<maintenanceUntil&&!isHealth){res.writeHead(503,{'Content-Type':'application/json','Retry-After':'30'});res.end(JSON.stringify({error:'service-maintenance',retryable:true}));return;}
  const requestId=Symbol(),tracked=!isHealth;let handlerDone=false,responseDone=false;
  const release=()=>{if(handlerDone&&responseDone)inFlight.delete(requestId);};
  if(tracked)inFlight.set(requestId,{method:req.method,route:operationRoute,startedAt:new Date().toISOString()});
  res.once('finish',()=>{responseDone=true;release();});res.once('close',()=>{responseDone=true;release();});
  try{
  const send=(code,body)=>{const value=req.v2Public?restoreSoftwareLinks(body,publicCatalog.transform(body)):body;if(req.v2ChatStream?.finish(code,value))return;res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',...(req.v2Public?{'Cache-Control':'no-store'}:{})});res.end(JSON.stringify(value));};
  const route=req.url.split('?')[0];
  const loopback=strictApproved||['127.0.0.1','::1'].includes(require('./request-peer.cjs').peerAddress(req));
  if(route==='/v2/chip-browser'){
   if(req.v2Public||!loopback||req.method!=='GET'){send(403,{error:'local-only'});return;}
   try{const fs=require('node:fs'),path=require('node:path');send(200,JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../tmp/v2-offline-runtime/chip-browser.json'),'utf8')));}catch{send(503,{error:'chip-data-unavailable'});}return;
  }
  if(route.startsWith('/v2/curated-firmware/')&&offlineKnowledge?.health?.().catalog?.status==='approved-sql'){
   const match=/^\/v2\/curated-firmware\/([a-f0-9]{64})\/([^/]+)$/.exec(route),item=match&&curatedLocalFirmware?.find({sha256:match[1]});
   if(req.method!=='GET'||!item||!item.available||decodeURIComponent(match[2])!==item.name){send(404,{error:'resource-not-found'});return;}
   const fs=require('node:fs'),bytes=fs.readFileSync(item.file);if(require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==item.sha256){send(409,{error:'resource-changed'});return;}
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(item.name),'Cache-Control':'no-store'});res.end(bytes);return;
  }
  if(offlineKnowledge?.health?.().catalog?.status==='approved-sql'&&(route.startsWith('/official-files/')||route.startsWith('/v2/curated-docx/')||route.startsWith('/v2/source-pdf/'))){send(404,{error:'resource-not-found'});return;}
  if(route.startsWith('/v2/curated-docx/')||route.startsWith('/v2/source-pdf/')||route.startsWith('/v2/curated-firmware/')){if(req.v2Public||!loopback||req.method!=='GET'){send(403,{error:'local-only'});return;}await curatedSearch().original(req,res);return;}
  if(route==='/v2/curated-search/status'){if(req.v2Public||!loopback||req.method!=='GET'){send(403,{error:'local-only'});return;}try{if(!sectionSearch)curatedSearch();send(200,{enabled:true,backend:sectionSearch?'sections-sql-bm25-vector':'curated',scope:['spec','manual','video','firmware','module-config']});}catch{send(200,{enabled:false});}return;}
  if(route==='/v2/configuration-search'){
   if(req.v2Public||!loopback||req.method!=='GET'||!offlineKnowledge?.configurationFiles){send(403,{error:'local-only'});return;}
   const params=new URL(req.url,'http://localhost').searchParams,q=(params.get('q')||'').trim(),directory=params.get('directory')||'root',offset=Number(params.get('offset')||0),sort=params.get('sort')||'name';
   if(q.length>240||!Number.isSafeInteger(offset)||offset<0||!/^(root|[a-f0-9]{24})$/.test(directory)||!['name','type'].includes(sort)){send(400,{error:'invalid-query'});return;}
   const snapshot=await configurationCatalog(req),{entries,index}=snapshot,catalog=require('../../domain/knowledge/source-directory.cjs');
   if(!index.nodes.has(directory)){send(404,{error:'directory-not-found'});return;}
   if(q){let matches=require('../../domain/knowledge/metadata-query.cjs').rankMetadata(q,index.files,{limit:index.files.length});if(sort==='type')matches.sort((a,b)=>a.name.split('.').at(-1).localeCompare(b.name.split('.').at(-1))||a.name.localeCompare(b.name,'zh-Hans-CN',{numeric:true}));send(200,{directoryPage:{id:'root',label:'模组配置文件',breadcrumb:[{id:'root',label:'模组配置文件'}],query:q,sort,sourceTotal:entries.length,entries:matches.slice(offset,offset+50),pagination:{offset,limit:50,returned:matches.slice(offset,offset+50).length,total:matches.length,nextOffset:offset+50<matches.length?offset+50:null}}});return;}
   const result=catalog.directoryPage(index,{directory,offset,sort});result.directoryPage.catalogVersion=snapshot.version;result.directoryPage.sourceTotal=entries.length;if(directory==='root'){result.directoryPage.label='模组配置文件';result.directoryPage.breadcrumb[0].label='模组配置文件';}send(200,result);return;
  }
  if(route==='/v2/curated-search'){
   if(req.v2Public||!loopback||req.method!=='GET'){send(403,{error:'local-only'});return;}
   const q=(new URL(req.url,'http://localhost').searchParams.get('q')||'').trim();if(!q||q.length>240){send(400,{error:'invalid-query'});return;}
   try{const result=sectionSearch?await sectionSearch.search(q):await curatedSearch().search(q,{request:req});
    send(200,result);}catch{send(503,{error:'检索暂不可用，请重试'});}return;
  }
  if(route.startsWith('/v2/fulltext-file/')){
   if(req.v2Public||!loopback||req.method!=='GET'||!sectionSearch){send(403,{error:'local-only'});return;}
   try{await sectionSearch.serve(req,res,route.split('/').at(-1));}catch{if(!res.headersSent)send(503,{error:'resource-unavailable'});else res.destroy();}return;
  }
  if(await wikiAdmin(req,res))return;
  if(route.startsWith('/api/graydesk/updates/')){
   if(graydeskUpdates&&await graydeskUpdates.handle(req,res))return;
   res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'graydesk-updates-not-configured'}));return;
  }
  if(route==='/api/graydesk/errors'){
   if(graydeskReceiver){await graydeskReceiver.handle(req,res);return;}
   res.writeHead(503,{'Content-Type':'application/json','Retry-After':'60'});res.end(JSON.stringify({ok:false,error:'receiver-not-configured',retryable:true}));return;
  }
  // Defense in depth: a guard may mark public traffic, but cannot authorize
  // internal dialogue, evidence, index or model routes by accident.
  if(req.v2Public&&!require('../../external-services/assistant-updates.cjs').isUpdateRoute(req.method,route)&&!(req.method==='POST'&&(route==='/api/huidu/log'||require('./public-routes.cjs').publicPostRoutes.has(route)))&&
   !(req.method==='GET'&&require('./public-routes.cjs').publicGetRoutes.has(route))){send(403,{error:'public-route-not-enabled'});return;}
  if(assistantUpdates&&await assistantUpdates.handle(req,res))return;

  if(route==='/api/ai/chat')req.v2ChatStream=require('./chat-stream.cjs').chatStream(req,res);
  if(!req.v2Public&&developmentMonitor?.handle(req,res))return;
  if(route.startsWith('/v2/curated-videos/')){if(req.v2Public||!loopback||req.method!=='GET'||!curatedLocalVideos){res.writeHead(403);res.end();return;}await curatedLocalVideos.serve(req,res);return;}
  if(route.startsWith('/v2/curated-documents/')){if((req.v2Public?!softwareManualPaths.has(route):!loopback)||req.method!=='GET'||!curatedLocalDocuments){res.writeHead(403);res.end();return;}await curatedLocalDocuments.serve(req,res);return;}
  if(route.startsWith('/v2/curated-documents-preview/')){if(req.v2Public||!loopback||req.method!=='GET'||!curatedLocalDocuments){res.writeHead(403);res.end();return;}await curatedLocalDocuments.preview(req,res);return;}
  if(req.v2Public&&route==='/api/huidu/log'&&req.method==='POST'){if(offlineKnowledge&&await offlineKnowledge.handle(req,res))return;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'log-store-not-configured'}));return;}
  if(req.v2Public&&!publicCatalog){res.writeHead(503);res.end('Public resources are not configured');return;}
  if(req.v2Public&&route==='/api/ai/capabilities'){send(200,publicChat?await publicChat.capabilities():{modes:[],expert:{available:false}});return;}
  if(req.v2Public&&route==='/api/ai/chat'){
   if(!publicChat){send(503,{reply:'公网客服尚未配置，请稍后重试。'});return;}
   const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});
   try{
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536){send(413,{reply:'问题内容过长。'});return;}chunks.push(chunk);}
    let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{reply:'请求格式不正确。'});return;}
    const result=await publicChat.answer(input,{signal:controller.signal,...(req.v2ChatStream?{onAnswerDelta:req.v2ChatStream.text,onAnswerProgress:req.v2ChatStream.progress}:{})});if(!res.destroyed)send(result.code,result.body);
   }catch{if(!res.destroyed)send(503,{reply:'公网客服本次未完成，请稍后重试。'});}
   return;
  }
  if(route==='/'){res.writeHead(302,{Location:'/wiki'});res.end();return;}
  if(!req.v2Public&&offlineKnowledge&&await offlineKnowledge.handle(req,res))return;
  if(!req.v2Public&&localKnowledge&&await localKnowledge.handle(req,res))return;
  if(req.method==='GET'&&['/health','/api/health'].includes(route)){send(200,{...app.health(),...offlineKnowledge?.health?.()});return;}
  if(req.method==='GET'){
   const quick=req.v2Public?publicQuick:localQuick;
   const url=new URL(req.url,'http://localhost'),q=url.searchParams.get('q')||'';
   if(route.startsWith('/v2/resources/original/')){await original(route.slice('/v2/resources/original/'.length),res);return;}
   const media=async body=>!req.v2Public&&offlineKnowledge?.localizeMedia?offlineKnowledge.localizeMedia(body,{requestContext:req}):offlineKnowledge?.authorizeVideoMedia?offlineKnowledge.authorizeVideoMedia(body,req):body;
   if(route==='/v2/software-access/screen-control.png'&&!req.v2Public){const fs=require('node:fs'),path=require('node:path'),file=path.resolve(__dirname,'../../../tmp/v2-offline-runtime/software-assets/pingzhangkong-download.png');if(!fs.existsSync(file)){send(404,{error:'download-image-not-configured'});return;}res.writeHead(200,{'Content-Type':'image/png','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res);return;}
   if(route==='/api/search'){const body=await media(await quick.search(q)),documents=!req.v2Public&&loopback&&curatedLocalDocuments?curatedLocalDocuments.augment(body):body;const result=!req.v2Public&&loopback?assembleFirmwareSearch(documents,q,curatedLocalFirmware):documents;if(competitiveKnowledge)result.results=(result.results||[]).map(product=>({...product,competitiveHighlights:competitiveKnowledge.highlights(product.modelId||product.name)}));send(200,result);return;}
   if(route==='/api/software'){const manuals=body=>curatedLocalDocuments?.augmentSoftware?curatedLocalDocuments.augmentSoftware(body):body;if(req.v2Public)send(200,manuals(await media(await quick.software(q))));else await catalogResponse(req,res,'software:'+q,async()=>manuals(await localMedia(await localQuick.software(q))));return;}
   if(route==='/api/videos'){
    if(!req.v2Public&&loopback&&curatedLocalVideos){send(200,{query:q,video:curatedLocalVideos.list(q)});return;}
    const body=quick.videos(q);
    if(url.searchParams.get('outline')==='1'){
     if(!req.v2Public&&offlineKnowledge?.localizeMedia)send(200,await offlineKnowledge.localizeMedia(body,{metadataOnly:true,requestContext:req}));
     else {const permitted=await media(body);send(200,{cat:'video',metadataOnly:true,groups:permitted.video.topicGroups.map(g=>({key:g.key,label:g.label,count:g.count})),total:permitted.video.total});}
    }else send(200,await media(body));return;
   }
   if(route==='/api/docs'){
    const cat=url.searchParams.get('cat'),history=url.searchParams.get('history')||'current';
    if(req.v2Public&&(!['spec','manual','firmware'].includes(cat)||history!=='current')){send(403,{error:'public-catalog-scope-not-enabled'});return;}
    if(!['spec','manual','firmware','other','pending','history'].includes(cat)||!['current','all','only'].includes(history)){send(400,{error:'invalid_category_or_history'});return;}
    const limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):null,offset=Number(url.searchParams.get('offset')||0);
    const view=url.searchParams.get('view')||'grouped';if(!['grouped','flat'].includes(view)){send(400,{error:'invalid_view'});return;}
    if(!Number.isInteger(offset)||offset<0||(limit!==null&&(!Number.isInteger(limit)||limit<1||limit>200))||(offset&&limit===null&&!(cat==='other'&&!req.v2Public))){send(400,{error:'invalid_pagination'});return;}
    const listOnly=url.searchParams.get('list')==='1';
    // Firmware is published from the approved registry only. The SQLite index
    // still holds every historical binary, but it is not a publication list.
    if(curatedLocalFirmware&&cat==='firmware'){
     const docs={...curatedLocalFirmware.docs(),includeHistory:history!=='current',historyOnly:history==='only'};
     const body=require('../../domain/knowledge/resource-view.cjs').paginateDocs({cat,docs},{offset,limit,view});send(200,listOnly?list(body):body);return;
    }
    if((!req.v2Public&&loopback||req.v2Public&&cat==='manual')&&curatedLocalDocuments&&['spec','manual'].includes(cat)&&history==='current'){
     let docs=curatedLocalDocuments.docs(cat);
     if(req.v2Public){const legacy=await quick.docs(cat,{websiteOnly:true});docs={...legacy.docs,localCurated:true,groups:[...legacy.docs.groups||[],...docs.groups.filter(g=>g.key==='software-manuals')]};}
     const body=require('../../domain/knowledge/resource-view.cjs').paginateDocs({cat,docs},{offset,limit,view});send(200,listOnly?list(body):body);return;
    }
    if(!req.v2Public&&cat==='other'&&offlineKnowledge?.directoryCatalog){
     const directory=url.searchParams.get('directory')||'root',query=url.searchParams.get('q')||'',sort=url.searchParams.get('sort')||'name';
     if(!/^(?:root|[a-f0-9]{24})$/.test(directory)||query.length>240||!['name','type'].includes(sort)){send(400,{error:'invalid-directory-request'});return;}
     try{send(200,await offlineKnowledge.directoryCatalog(req,{directory,offset,query,sort}));}catch(e){send(e.message==='directory-not-found'?404:e.message==='invalid-directory-request'?400:503,{error:e.message==='directory-not-found'?'directory-not-found':e.message==='invalid-directory-request'?'invalid-directory-request':'internal-directory-service-unavailable'});}return;
    }
    // Public transformation and authorization remain uncached and separate.
    if(req.v2Public)send(200,await media(await quick.docs(cat,{includeHistory:false,historyOnly:false,websiteOnly:true,offset,limit,view})));
    else if(offlineKnowledge?.authorizeResources&&['other','pending'].includes(cat)){
     const body=await localQuick.docs(cat,{includeHistory:history==='all',historyOnly:cat==='history'||history==='only',websiteOnly:true,offset:0,limit:null,view});
     const permitted=await offlineKnowledge.authorizeResources(body,req);
     const paged=require('../../domain/knowledge/resource-view.cjs').paginateDocs(permitted,{offset,limit,view});send(200,listOnly?list(paged):paged);
    }else await catalogResponse(req,res,docKey(cat,history,offset,limit,view,listOnly),()=>loadDocs(cat,{includeHistory:history==='all',historyOnly:cat==='history'||history==='only',websiteOnly:true,offset,limit,view},listOnly));
    return;
   }
   if(serveFrontend&&serveStatic(req,res,undefined,{localKnowledge:!req.v2Public&&!!localKnowledge,offlineKnowledge:!req.v2Public&&!!offlineKnowledge,publicView:!!req.v2Public}))return;
  }
  if(req.method!=='POST'||!['/v2/wiki/products','/v2/quick/products','/v2/dialogue','/api/ai/chat','/v2/ordering/chat','/v2/ordering/ssm','/v2/ordering/package','/v2/ordering/bom','/v2/ordering/commissioning'].includes(route)){send(404,{error:'not_found'});return;}
  let size=0,chunks=[];
  try{for await(const chunk of req){size+=chunk.length;if(size>65536){send(413,{error:'body_too_large'});return;}chunks.push(chunk);}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'invalid_json'});return;}
   if(route==='/v2/ordering/commissioning'){const output=await app.exportCommissioning(input);send(output.status==='ready'?200:output.status==='invalid_request'?400:422,output);return;}
   if(route==='/v2/ordering/bom'){const output=await app.exportBom(input);if(output.status!=='ready'){send(output.status==='invalid_request'?400:422,output);return;}res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="xiaohuiji-bom.csv"'});res.end(output.csv);return;}
   if(route==='/v2/ordering/package'){const output=await app.exportConfigurationPackage(input);if(output.status!=='ready'){send(output.status==='invalid_request'?400:422,output);return;}
    res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="xiaohuiji-connection-package.zip"','X-Configuration-Scope':'receiver-grids-not-complete-hardware-settings'});res.end(output.buffer);return;
   }
   if(route==='/v2/ordering/ssm'){const output=await app.exportSsm(input);if(output.status!=='ready'){send(output.status==='invalid_request'?400:422,output);return;}
    res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Content-Disposition':'attachment; filename="xiaohuiji-v2.ssm"','X-SSM-Scope':'standard-grid-import-only'});res.end(output.xml);return;
   }
   const output=['/v2/wiki/products','/v2/quick/products'].includes(route)?app.quickLookup(input):route==='/v2/ordering/chat'?await orderingDialogue(input):route==='/api/ai/chat'?await dialogue(input):await app.dialogue(input);
   send(output.status==='invalid_request'?400:200,output);
  }catch{send(500,{error:'internal_error'});}
  }finally{handlerDone=true;release();}
 });
 server.prepareCatalogs=async()=>{
  if(!offlineKnowledge)return;
  for(const cat of ['spec','manual','firmware','other','pending'])await catalogResponse.prepare(docKey(cat,'current',0,null,'grouped',true),()=>loadDocs(cat,{websiteOnly:true},true));
  await catalogResponse.prepare('software:',async()=>{const body=await localMedia(await localQuick.software(''));return curatedLocalDocuments?.augmentSoftware?curatedLocalDocuments.augmentSoftware(body):body;});
 };
 return server;
}
if(require.main===module){const port=Number(process.argv[2]||4389);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');const localKnowledge=process.env.XHJ_LOCAL_KNOWLEDGE==='1'?require('./local-knowledge.cjs').createLocalKnowledge():null;createServer(undefined,{localKnowledge}).listen(port,'127.0.0.1',()=>console.log('v2 local server: '+port));}
module.exports={createServer,assembleFirmwareSearch};
