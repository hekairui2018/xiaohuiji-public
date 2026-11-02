'use strict';
// One isolated application + loopback-only read-only index. No model/tool-trial import.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{parseArgs}=require('node:util');
const {createApp}=require('../app/bootstrap.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createServer}=require('../adapters/http/server.cjs'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const root=path.resolve(__dirname,'../..');
async function startOffline(options={}){
 const port=Number(options.port||8520),resourcePort=Number(options['resource-port']||8521);
 const lan=options.lan?require('../adapters/http/lan-access.cjs').lanConfiguration(options['lan-address'],options['lan-interface']):null;
 const host=lan?'0.0.0.0':'127.0.0.1';
 const apiPort=options['api-port']?Number(options['api-port']):null;
 let gatewayKey=null,webRoot=null;
 if(apiPort){
  if(!Number.isInteger(apiPort)||apiPort<1024||apiPort>65535||[port,resourcePort,3789,3790,3791,8080].includes(apiPort))throw Error('API needs a distinct private port');
  if(!options['frontend-root']||!options['gateway-key-file'])throw Error('Separated runtime requires web assets and a server-only gateway key');
  webRoot=fs.realpathSync(options['frontend-root']);const keyPath=fs.realpathSync(options['gateway-key-file']);
  if(keyPath===webRoot||keyPath.startsWith(webRoot+path.sep))throw Error('Gateway key cannot be in the web directory');
  gatewayKey=fs.readFileSync(keyPath);if(gatewayKey.length!==32)throw Error('Invalid gateway key');
 }

 for(const n of [port,resourcePort])if(!Number.isInteger(n)||n<1024||n>65535||[3789,3790,3791,4389,4499,4510,4512,8080].includes(n))throw Error('Choose separate local trial ports');
 if(port===resourcePort)throw Error('Application and resource ports must differ');
 const index=path.resolve(options.index||path.join(root,'tmp/resource-index-stage1-20261016'));
 const approvedOnly=options['approved-sql']==='true';
 const internalToken=require('node:crypto').randomBytes(32).toString('base64url');
 if(!fs.existsSync(path.join(index,'resources.db')))throw Error('Authorized resource index is missing; provide --index. No automatic scan or download.');
 const dir=path.resolve(options.knowledge||path.join(root,'v2/data/knowledge-next'));
 const manifestFile=options.manifest||'candidate-manifest.json',knowledge=loadKnowledge(dir,{manifestFile});
 const app=createApp({knowledge}),resourceBase='http://127.0.0.1:'+resourcePort;
 const dataDirectory=path.resolve(options.data||path.join(root,'tmp/v2-offline-runtime'));
 for(const protectedDir of ['backend','frontend','data','v2/data'].map(p=>path.join(root,p)))if(dataDirectory===protectedDir||dataDirectory.startsWith(protectedDir+path.sep))throw Error('V2 runtime data must not use V1 or knowledge directories');
 const logs=require('../external-services/feishu-logs.cjs').createFeishuLogs({directory:path.join(dataDirectory,'logs'),configFile:options['feishu-config']||path.join(dataDirectory,'feishu.env')});
 const images=require('../external-services/local-images.cjs').createLocalImages(path.join(dataDirectory,'images'));
 const sectionRuntime=fs.existsSync(path.join(index,'section-search.json'))?JSON.parse(fs.readFileSync(path.join(index,'section-search.json'),'utf8')):null;
 const sectionDependencies=sectionRuntime?.dependencies;
 const indexEnvironment={...process.env,...(sectionDependencies?{PYTHONPATH:[sectionDependencies,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)}:{}),XHJ_INTERNAL_TOKEN:internalToken,XHJ_CONFIG_LEGACY_DB:approvedOnly?path.join(root,'tmp/resource-index-stage1-20261016/resources.db'):''};
 const child=spawn(options.python||process.env.XHJ_PYTHON||'python',[path.join(root,'v2/resource-index/server.py'),'--port',String(resourcePort),'--work',index],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:indexEnvironment});
 let childError;child.on('error',e=>{childError=e;});child.stderr.on('data',d=>process.stderr.write(d));
 let ready=false;
 for(let i=0;i<300;i++){
  if(childError)throw childError;if(child.exitCode!==null)throw Error('Read-only index process exited; check port and Python runtime');
  try{const r=await fetch(resourceBase+'/health',{signal:AbortSignal.timeout(500)});if(r.ok&&(await r.json()).pid===child.pid){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,200));
 }
 if(!ready){child.kill();throw Error('Local index did not become ready');}
 // Opt-in observer shares the existing expert and tool executor; it adds no separate question flow.
 const capture=options['bonsai-monitor']===true?require('../dev-monitor/capture.cjs').createCapture({enabled:true}):null;
 const createExpert=capture?settings=>require('../dev-monitor/expert.cjs').createMonitoredExpert({capture,...settings}):require('../model-adapter/evidence-expert.cjs').createEvidenceExpert;
 const developmentMonitor=capture?require('../dev-monitor/http.cjs').createMonitorHttp(capture):null;
 const protection=require('../model-adapter/expert-protection.cjs').createExpertProtection({stateFile:path.join(dataDirectory,'expert-protection.private.json')});
 await protection.refresh();
 const expert=protection.wrap(createExpert({transport:protection.transport(require('../model-adapter/local-model-transport.cjs').localModelTransport),maxConcurrent:3,maxModelCalls:5,maxToolCalls:3,thinkingEnabled:true,baseUrl:options['expert-model-url']||'http://127.0.0.1:8080',onDiagnostic:entry=>{
  fs.appendFileSync(path.join(dataDirectory,'expert-model-calls.private.jsonl'),JSON.stringify({at:new Date().toISOString(),...entry})+'\n');
 }}));
 const ragflowConfigFile=options['ragflow-config']||process.env.XHJ_RAGFLOW_CONFIG||null;
 const driveInventoryFile=options['drive-inventory']||null;
 const catalogDirectory=path.resolve(options.catalog||path.join(root,'v2/data/catalog/generated'));
 const firmwareManifestFile=path.join(catalogDirectory,'curated-local-firmware.json');
 // One approved firmware registry feeds the page, retrieval and downloads; the
 // index keeps everything else for internal administration only.
 const curatedLocalFirmware=fs.existsSync(firmwareManifestFile)?await require('../adapters/http/curated-local-firmware.cjs').createCuratedLocalFirmware({manifestFile:firmwareManifestFile,rootDirectory:'G:/公网发布资料'}):null;
 if(curatedLocalFirmware?.problems?.length)console.log(JSON.stringify({event:'firmware-verification-problem',problems:curatedLocalFirmware.problems}));
 const firmwareScope=require('../domain/knowledge/firmware-scope.cjs').createFirmwareScope({manifestFile:firmwareManifestFile});
 let curatedResources=null;
 const sectionSearch=fs.existsSync(path.join(index,'section-search.json'))?require('../adapters/http/section-search.cjs').createSectionSearch({resourceBase,internalToken}):null;
 const competitiveKnowledge=options['expert-comparison']?require('../domain/knowledge/competitive-knowledge.cjs').createCompetitiveKnowledge(options['expert-comparison']):null;
 const expertMaterialsFile=options['expert-materials']||path.join(root,'tmp/expert-structured-20261028/materials.private.json');
 const expertMaterials=fs.existsSync(expertMaterialsFile)?require('../domain/knowledge/expert-materials.cjs').createExpertMaterials(expertMaterialsFile):null;
 const expertRagConnection=path.join(root,'tmp/ragflow-comparison-20261025/connection.private.json'),expertRagState=path.join(root,'tmp/expert-structured-20261028/rag-import.private.json');
 const expertMaterialRag=fs.existsSync(expertRagConnection)&&fs.existsSync(expertRagState)?require('../adapters/http/expert-material-rag.cjs').createExpertMaterialRag({connectionFile:expertRagConnection,stateFile:expertRagState,materialSource:expertMaterials}):null;
 const offlineKnowledge=createOfflineKnowledge({app,knowledge,resourceBase,sessionDirectory:path.join(dataDirectory,'sessions'),logs,images,expert,ragflowConfigFile:approvedOnly?null:ragflowConfigFile,driveInventoryFile:approvedOnly?null:driveInventoryFile,expertMaterials:competitiveKnowledge?.materials||(approvedOnly?null:expertMaterials),expertMaterialRag:approvedOnly?null:expertMaterialRag,approvedOnly,internalToken,resourceAnswer:(message,settings)=>!approvedOnly&&curatedResources?curatedResources.answer(message,settings):null,resourceSearch:(message,settings)=>!approvedOnly&&curatedResources?curatedResources.search(message,settings):null,withheldResourcesFile:path.join(dataDirectory,'withheld-firmware.private.json'),firmwareScope});
 if(options['public-origin']&&!lan)throw Error('Public origin requires explicit LAN tunnel configuration');
 const publicCatalog=options['public-origin']?require('../adapters/http/public-catalog.cjs').createPublicCatalog({configFile:options['oss-config']||path.join(root,'scripts/.oss-config.json'),allowlistFile:options['public-allowlist']||path.join(dataDirectory,'public-cloud-allowlist.json')}):null;
 const accessGuard=lan?require('../adapters/http/lan-access.cjs').createLanGuard({...lan,port,publicOrigin:options['public-origin']||null}):null;
 const publicEvidenceFile=path.join(dataDirectory,'public-evidence-verified.private.json');
 const verifiedDocuments=fs.existsSync(publicEvidenceFile)?JSON.parse(fs.readFileSync(publicEvidenceFile,'utf8')).documents:[];
 const publicChat=publicCatalog?require('../adapters/http/public-chat.cjs').createPublicChat({app,knowledge,catalog:publicCatalog,expert,verifiedDocuments,ragflowConfigFile}):null;
 const graydeskReceiver=require('../external-services/graydesk-errors.cjs').createGraydeskReceiver({configFile:path.join(dataDirectory,'graydesk.private.json'),directory:path.join(dataDirectory,'graydesk-errors')});
 const curatedManifest=path.join(catalogDirectory,'curated-local-videos.json');
 const curatedLocalVideos=fs.existsSync(curatedManifest)?await require('../adapters/http/curated-local-videos.cjs').createCuratedLocalVideos({manifestFile:curatedManifest,rootDirectory:'G:/公网发布资料'}):null;
 const curatedDocumentsManifest=path.join(catalogDirectory,'curated-local-documents.json');
 const curatedLocalDocuments=fs.existsSync(curatedDocumentsManifest)?await require('../adapters/http/curated-local-documents.cjs').createCuratedLocalDocuments({manifestFile:curatedDocumentsManifest,rootDirectory:'G:/公网发布资料',resourceBase}):null;
 if(ragflowConfigFile&&curatedLocalDocuments&&!approvedOnly){
  const source=require('../adapters/http/curated-search.cjs').createCuratedSearch({manifestFile:curatedDocumentsManifest,configFile:ragflowConfigFile,extraFile:path.join(root,'tmp/ragflow-comparison-20261025/curated-missing.private.json'),docxFile:path.join(root,'tmp/ragflow-comparison-20261025/official-docx-import.private.json'),addonFile:path.join(root,'tmp/v2-offline-runtime/curated-software-manuals.json'),pdfMapFile:path.join(root,'tmp/chip-rag-delivery-20261028/pdf/source-pdfs.private.json'),videosFile:curatedManifest,softwareLinksFile:path.join(root,'tmp/chip-rag-delivery-20261028/model-software-audit.private.json'),softwareModelsFile:path.join(root,'tmp/chip-rag-delivery-20261028/software-model-audit.private.json'),firmwareManifestFile});
  const lookup=require('../adapters/http/quick-service.cjs').createQuickService(app,{resolveDocuments:offlineKnowledge.resolveDocuments,localCatalog:offlineKnowledge.localCatalog});
  curatedResources=require('../adapters/http/curated-resources.cjs').createCuratedResources({source,chipLookup:app.chipLookup,firmwareEvidence:require('../adapters/data/load-resource-evidence.cjs').loadResourceEvidence(),configurationFiles:(req,q)=>offlineKnowledge.configurationFiles(req,q),firmwareFiles:async req=>{
   // Preserve the existing current-Wiki scope and request access checks. The
   // public folder is a verified original location, not the whole local Wiki.
   const modelKey=require('../domain/knowledge/resource-query.cjs').normalize;
   const preferred=source.firmwareFiles(),preferredNames=new Set(preferred.flatMap(f=>f.models.map(m=>modelKey(m)+'\0'+f.name)));
   let body=await lookup.docs('firmware',{includeHistory:false,historyOnly:false,websiteOnly:true});body=await offlineKnowledge.localizeMedia(body,{requestContext:req});const files=[...preferred];
   for(const g of body.docs?.groups||[])if(source.isOfficialModel(g.model))for(const f of g.items||[])if(f.available!==false&&!preferredNames.has(modelKey(g.model)+'\0'+f.name))files.push({...f,models:[g.model],folders:[g.model]});return files;
  }});
 }
 const assistantUpdates=require('../external-services/assistant-updates.cjs').createAssistantUpdates({configFile:process.env.XHJ_ASSISTANT_UPDATE_CONFIG||path.join(root,'.private/assistant-updates/config.json')});
 const graydeskUpdates=require('../external-services/graydesk-updates.cjs').createGraydeskUpdates({configFile:path.join(root,'.private/graydesk-updates/config.json')});
 const server=createServer({...app,health:()=>({...app.health(),competitiveKnowledge:competitiveKnowledge?.counts||null,graydesk:{configured:graydeskReceiver.configured},assistantUpdates:{protocol:1},graydeskUpdates:{protocol:1},feishu:logs.status(),fulltext:sectionSearch?{backend:'sections-sql-bm25-vector'}:null,trial:{instance:'v2-offline',host,port,resourcePort,modelMode:'expert-opt-in',ragflowConfigured:!!ragflowConfigFile,driveCatalogConfigured:!!driveInventoryFile,knowledgeMode:manifestFile,pid:process.pid,indexPid:child.pid,architecture:apiPort?'separated-web-api':'combined',...(apiPort?{apiPort}:{}),codeProtection:options.codeProtection||null}})},{offlineKnowledge,accessGuard,publicCatalog,publicChat,developmentMonitor,graydeskReceiver,curatedLocalVideos,curatedLocalDocuments,curatedLocalFirmware,firmwareScope,curatedResources,sectionSearch,competitiveKnowledge,assistantUpdates,graydeskUpdates,gatewayTrust:apiPort?require('../adapters/http/request-peer.cjs').createGatewayTrust({key:gatewayKey}):null,serveFrontend:!apiPort});
 const preparationStarted=Date.now();
 let webServer=null;
 try{
  await server.prepareCatalogs();console.log(JSON.stringify({event:'catalog-prepared',elapsedMs:Date.now()-preparationStarted}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(apiPort||port,apiPort?'127.0.0.1':host,resolve);});
  if(apiPort){webServer=require('../adapters/http/web-gateway.cjs').createWebGateway({backend:'http://127.0.0.1:'+apiPort,webRoot,key:gatewayKey,port,accessGuard});await new Promise((resolve,reject)=>{webServer.once('error',reject);webServer.listen(port,host,resolve);});}
 }catch(e){server.closeAllConnections();server.close();child.kill();logs.close();throw e;}

 const runtime={instance:'v2-offline',host,lan,port,resourcePort,publicOrigin:options['public-origin']||null,publicScope:publicCatalog?'product-quick-and-approved-cloud-documents':null,pid:process.pid,indexPid:child.pid,knowledgeVersion:knowledge.version,startedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(dataDirectory,'runtime.json'),JSON.stringify(runtime,null,2));
 server.on('request',(req,res)=>{if(!req.url.startsWith('/api/')||req.url.startsWith('/api/health')||req.url.startsWith('/api/huidu/log'))return;const start=Date.now();res.once('finish',()=>{try{logs.activity({sessionId:'v2-runtime',...require('../adapters/http/access-entry.cjs').accessEntry(req),route:req.url.split('?')[0],method:req.method,status:res.statusCode,elapsedMs:Date.now()-start});}catch{console.error('V2 runtime log could not be retained locally');}});});
 const close=async()=>{protection.dispose();logs.close();if(webServer){webServer.closeAllConnections();await new Promise(resolve=>webServer.close(resolve));}server.closeAllConnections();await new Promise(resolve=>server.close(resolve));capture?.clear();child.kill();};
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
 child.on('exit',()=>{if(server.listening)console.error('Resource process stopped: product lookup and ordering remain available, original search is temporarily unavailable.');});
 console.log(JSON.stringify({instance:'v2-offline',url:'http://'+(lan?.address||'127.0.0.1')+':'+port,wiki:'/wiki',consultation:'/huiai',knowledgeVersion:knowledge.version,modelCalls:0,resourcePort,pid:process.pid,indexPid:child.pid}));
 return {server,webServer,close};
}
if(require.main===module){const {values}=parseArgs({options:{...Object.fromEntries(['port','resource-port','index','knowledge','manifest','python','data','catalog','feishu-config','lan-address','lan-interface','expert-model-url','expert-materials','expert-comparison','api-port','frontend-root','gateway-key-file','public-origin','public-allowlist','oss-config','ragflow-config','drive-inventory','approved-sql'].map(k=>[k,{type:'string'}])),lan:{type:'boolean',default:false},'bonsai-monitor':{type:'boolean',default:false}}});startOffline(values).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={startOffline};
