'use strict';
const http=require('node:http');
const {createApp}=require('../../app/bootstrap.cjs');
const {createQuickService}=require('./quick-service.cjs');
const {createDialogueService}=require('./dialogue-service.cjs');
const {serveStatic}=require('./static-service.cjs');
const {createOriginalResource}=require('./original-resource.cjs');
function createServer(app=createApp(),{localKnowledge=null,offlineKnowledge=null,accessGuard=null,publicCatalog=null,publicChat=null,developmentMonitor=null,graydeskReceiver=null,assistantUpdates=null,graydeskUpdates=null,publicOnly=false,publicSearch=null}={}){
 // Customer HTTP routes always use the activation-gated pipeline. Raw domain remains for audits.
 app={...app,dialogue:app.customerDialogue||app.dialogue};
 const publicQuick=createQuickService(publicCatalog?.scopeApp?publicCatalog.scopeApp(app):app,publicCatalog?.localRelease?{
  localCatalog:async()=>publicCatalog.resourceRows(),resolveDocuments:async rows=>rows.map(r=>({available:!!publicCatalog.localRelease.urlFor(r.name),url:publicCatalog.localRelease.urlFor(r.name)}))}:{});
 const localQuick=createQuickService(app,{resolveDocuments:offlineKnowledge?.resolveDocuments,localCatalog:offlineKnowledge?.localCatalog,productFacts:offlineKnowledge?.productFacts}),dialogue=createDialogueService(app),original=createOriginalResource({evidenceDocuments:app.originalDocuments});
 const orderingDialogue=createDialogueService(app,{operation:'ordering'});
 const catalogResponse=require('./catalog-response-cache.cjs').createCatalogResponseCache({staleMs:60000});
 const localMedia=async body=>offlineKnowledge?.localizeMedia?offlineKnowledge.localizeMedia(body):body;
 const list=require('./catalog-list.cjs').catalogList;
 const loadDocs=async(cat,options,listOnly)=>{const body=await localMedia(await localQuick.docs(cat,options));return listOnly?list(body):body;};
 const docKey=(cat,history,offset,limit,view,listOnly)=>JSON.stringify([cat,history,offset,limit,view,listOnly]);
 const inFlight=new Map();let maintenanceUntil=0;
 const server=http.createServer(async(req,res)=>{
  if(accessGuard&&!accessGuard(req,res))return;
  const operationRoute=req.url.split('?')[0],isControl=operationRoute==='/api/operations/maintenance',isHealth=['/health','/api/health'].includes(operationRoute);
  if(isControl){
   const local=['127.0.0.1','::1'].includes(String(req.socket.remoteAddress||'').replace(/^::ffff:/,''))&&/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'')&&!req.v2Public&&!req.headers.origin;
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
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',...(req.v2Public?{'Cache-Control':'no-store'}:{})});res.end(JSON.stringify(req.v2Public?publicCatalog.transform(body):body));};
  const route=req.url.split('?')[0];
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
  if(req.v2Public&&!require('../../external-services/assistant-updates.cjs').isUpdateRoute(req.method,route)&&!require('./public-routes.cjs').isPublicRoute(req.method,route)){send(403,{error:'public-route-not-enabled'});return;}

  if(assistantUpdates&&await assistantUpdates.handle(req,res))return;
  if(!req.v2Public&&developmentMonitor?.handle(req,res))return;
  if(req.v2Public&&route==='/api/huidu/log'&&req.method==='POST'){if(offlineKnowledge&&await offlineKnowledge.handle(req,res))return;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'log-store-not-configured'}));return;}
  if(req.v2Public&&!publicCatalog){res.writeHead(503);res.end('Public resources are not configured');return;}
  if(req.v2Public&&route.startsWith('/public-files/')){if(publicCatalog.localRelease)await publicCatalog.localRelease.serve(req,res);else {res.writeHead(404);res.end();}return;}
  if(req.v2Public&&['/api/public-search','/api/public-context'].includes(route)){
   if(!publicSearch){send(503,{error:'public-search-not-configured'});return;}
   try{const p=new URL(req.url,'http://localhost').searchParams;const result=route==='/api/public-search'?await publicSearch.search(p.get('q')):await publicSearch.read({name:p.get('name'),sha256:p.get('sha256'),unit:p.get('id'),offset:Number(p.get('offset')||0)});send(result.code,result.body);}catch{send(503,{error:'public-search-unavailable'});}return;
  }
  if(req.v2Public&&route==='/api/ai/capabilities'){send(200,publicChat?await publicChat.capabilities():{modes:[],expert:{available:false}});return;}
  if(req.v2Public&&route==='/api/ai/chat'){
   if(!publicChat){send(503,{reply:'公网客服尚未配置，请稍后重试。'});return;}
   const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});
   try{
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536){send(413,{reply:'问题内容过长。'});return;}chunks.push(chunk);}
    let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{reply:'请求格式不正确。'});return;}
    const result=await publicChat.answer(input,{signal:controller.signal});if(!res.destroyed)send(result.code,result.body);
   }catch{if(!res.headersSent&&!res.destroyed)send(503,{reply:'公网客服本次未完成，请稍后重试。'});}
   return;
  }
  if(route==='/'){res.writeHead(302,{Location:'/wiki'});res.end();return;}
  if(!req.v2Public&&offlineKnowledge&&await offlineKnowledge.handle(req,res))return;
  if(!req.v2Public&&localKnowledge&&await localKnowledge.handle(req,res))return;
  if(req.method==='GET'&&['/health','/api/health'].includes(route)){send(200,app.health());return;}
  if(req.method==='GET'){
   const quick=req.v2Public?publicQuick:localQuick;
   const url=new URL(req.url,'http://localhost'),q=url.searchParams.get('q')||'';
   if(route.startsWith('/v2/resources/original/')){await original(route.slice('/v2/resources/original/'.length),res);return;}
   const media=async body=>req.v2Public&&publicCatalog.localRelease?body:!req.v2Public&&offlineKnowledge?.localizeMedia?offlineKnowledge.localizeMedia(body,{requestContext:req}):offlineKnowledge?.authorizeVideoMedia?offlineKnowledge.authorizeVideoMedia(body,req):body;
   if(route==='/v2/software-access/screen-control.png'&&!req.v2Public){const fs=require('node:fs'),path=require('node:path'),file=path.resolve(__dirname,'../../../tmp/v2-offline-runtime/software-assets/pingzhangkong-download.png');if(!fs.existsSync(file)){send(404,{error:'download-image-not-configured'});return;}res.writeHead(200,{'Content-Type':'image/png','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res);return;}
   if(route==='/api/search'){send(200,await media(await quick.search(q)));return;}
   if(route==='/api/software'){if(req.v2Public)send(200,await media(await quick.software(q)));else await catalogResponse(req,res,'software:'+q,async()=>localMedia(await localQuick.software(q)));return;}
   if(route==='/api/videos'){
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
   if(serveStatic(req,res,undefined,{localKnowledge:!req.v2Public&&!!localKnowledge,offlineKnowledge:!req.v2Public&&!!offlineKnowledge,publicView:!!req.v2Public}))return;
  }
  if(req.method!=='POST'||!['/v2/wiki/products','/v2/quick/products','/v2/dialogue','/api/ai/chat','/v2/ordering/chat','/v2/ordering/ssm'].includes(route)){send(404,{error:'not_found'});return;}
  let size=0,chunks=[];
  try{for await(const chunk of req){size+=chunk.length;if(size>65536){send(413,{error:'body_too_large'});return;}chunks.push(chunk);}
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{send(400,{error:'invalid_json'});return;}
   if(route==='/v2/ordering/ssm'){const output=await app.exportSsm(input);if(output.status!=='ready'){send(output.status==='invalid_request'?400:422,output);return;}
    res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Content-Disposition':'attachment; filename="xiaohuiji-v2.ssm"','X-SSM-Scope':'standard-grid-import-only'});res.end(output.xml);return;
   }
   const output=['/v2/wiki/products','/v2/quick/products'].includes(route)?app.quickLookup(input):route==='/v2/ordering/chat'?await orderingDialogue(input):route==='/api/ai/chat'?await dialogue(input):await app.dialogue(input);
   send(output.status==='invalid_request'?400:200,output);
  }catch{send(500,{error:'internal_error'});}
  }finally{handlerDone=true;release();}
 });
 server.prepareCatalogs=async()=>{
  if(!offlineKnowledge||publicOnly)return;
  for(const cat of ['spec','manual','firmware','other','pending'])await catalogResponse.prepare(docKey(cat,'current',0,null,'grouped',true),()=>loadDocs(cat,{websiteOnly:true},true));
  await catalogResponse.prepare('software:',async()=>localMedia(await localQuick.software('')));
 };
 return server;
}
if(require.main===module){const port=Number(process.argv[2]||4389);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');const localKnowledge=process.env.XHJ_LOCAL_KNOWLEDGE==='1'?require('./local-knowledge.cjs').createLocalKnowledge():null;createServer(undefined,{localKnowledge}).listen(port,'127.0.0.1',()=>console.log('v2 local server: '+port));}
module.exports={createServer};
