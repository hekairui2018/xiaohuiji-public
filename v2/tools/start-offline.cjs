'use strict';
// One isolated application + loopback-only read-only index. No model/tool-trial import.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{parseArgs}=require('node:util');
const {createApp}=require('../app/bootstrap.cjs'),{loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createServer}=require('../adapters/http/server.cjs'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const root=path.resolve(__dirname,'../..');
async function startOffline(options={}){
 const port=Number(options.port||8520),resourcePort=Number(options['resource-port']||8521);
 const lan=options.lan?require('../adapters/http/lan-access.cjs').lanConfiguration(options['lan-address']):null;
 const host=lan?'0.0.0.0':'127.0.0.1';
 for(const n of [port,resourcePort])if(!Number.isInteger(n)||n<1024||n>65535||[3789,3790,3791,4389,4499,4510,4512,8080].includes(n))throw Error('Choose separate local trial ports');
 if(port===resourcePort)throw Error('Application and resource ports must differ');
 const index=path.resolve(options.index||path.join(root,'tmp/resource-index-stage1-20261016'));
 if(!fs.existsSync(path.join(index,'resources.db')))throw Error('Authorized resource index is missing; provide --index. No automatic scan or download.');
 const dir=path.resolve(options.knowledge||path.join(root,'v2/data/knowledge-next'));
 const manifestFile=options.manifest||'candidate-manifest.json',knowledge=loadKnowledge(dir,{manifestFile});
 const app=createApp({knowledge}),resourceBase='http://127.0.0.1:'+resourcePort;
 const dataDirectory=path.resolve(options.data||path.join(root,'tmp/v2-offline-runtime'));
 for(const protectedDir of ['backend','frontend','data','v2/data'].map(p=>path.join(root,p)))if(dataDirectory===protectedDir||dataDirectory.startsWith(protectedDir+path.sep))throw Error('V2 runtime data must not use V1 or knowledge directories');
 const logs=require('../external-services/feishu-logs.cjs').createFeishuLogs({directory:path.join(dataDirectory,'logs'),configFile:options['feishu-config']||path.join(dataDirectory,'feishu.env')});
 const images=require('../external-services/local-images.cjs').createLocalImages(path.join(dataDirectory,'images'));
 const roleIndex=options['role-index']?path.resolve(options['role-index']):null;
 if(roleIndex&&!fs.existsSync(roleIndex))throw Error('Requested role index is missing');
 const child=spawn(options.python||process.env.XHJ_PYTHON||'python',[path.join(root,'v2/resource-index/server.py'),'--port',String(resourcePort),'--work',index,...(roleIndex?['--role-index',roleIndex]:[])],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let childError;child.on('error',e=>{childError=e;});child.stderr.on('data',d=>process.stderr.write(d));
 let ready=false;
 for(let i=0;i<60;i++){
  if(childError)throw childError;if(child.exitCode!==null)throw Error('Read-only index process exited; check port and Python runtime');
  try{const r=await fetch(resourceBase+'/health',{signal:AbortSignal.timeout(500)});if(r.ok&&(await r.json()).pid===child.pid){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!ready){child.kill();throw Error('Local index did not become ready');}
 // Opt-in observer shares the existing expert and tool executor; it adds no separate question flow.
 const capture=options['bonsai-monitor']===true?require('../dev-monitor/capture.cjs').createCapture({enabled:true}):null;
 const createExpert=capture?settings=>require('../dev-monitor/expert.cjs').createMonitoredExpert({capture,...settings}):require('../model-adapter/evidence-expert.cjs').createEvidenceExpert;
 const developmentMonitor=capture?require('../dev-monitor/http.cjs').createMonitorHttp(capture):null;
 const expert=createExpert({autoReadCandidates:2,baseUrl:options['expert-model-url']||'http://127.0.0.1:8080',onDiagnostic:entry=>{
  fs.appendFileSync(path.join(dataDirectory,'expert-model-calls.private.jsonl'),JSON.stringify({at:new Date().toISOString(),...entry})+'\n');
 }});
 const offlineKnowledge=createOfflineKnowledge({app,knowledge,resourceBase,sessionDirectory:path.join(dataDirectory,'sessions'),logs,images,expert,roleIndexEnabled:!!roleIndex});
 if(options['public-origin']&&!lan)throw Error('Public origin requires explicit LAN tunnel configuration');
 const localRelease=options['public-release']?await require('../adapters/http/local-public-release.cjs').createLocalPublicRelease(options['public-release']):null;
 if(options['public-only']&&(!localRelease||!roleIndex))throw Error('Public-only requires the approved local release and paragraph index');
 const publicCatalog=options['public-origin']?require('../adapters/http/public-catalog.cjs').createPublicCatalog({localRelease,configFile:options['oss-config']||path.join(root,'scripts/.oss-config.json'),allowlistFile:options['public-allowlist']||path.join(dataDirectory,'public-cloud-allowlist.json')}):null;
 const accessGuard=lan?require('../adapters/http/lan-access.cjs').createLanGuard({...lan,port,publicOrigin:options['public-origin']||null,publicOnly:!!options['public-only']}):null;
 const publicEvidenceFile=path.join(dataDirectory,'public-evidence-verified.private.json');
 const verifiedDocuments=localRelease?localRelease.grants():fs.existsSync(publicEvidenceFile)?JSON.parse(fs.readFileSync(publicEvidenceFile,'utf8')).documents:[];
 const evidenceSource=localRelease?require('../adapters/http/paragraph-evidence.cjs').createParagraphEvidence({resourceBase,authorizedDocuments:()=>localRelease.availableGrants()}):null;
 const answerDocuments=options['answer-grants']?JSON.parse(fs.readFileSync(options['answer-grants'],'utf8')):[];
 const answerSource=answerDocuments.length?require('../adapters/http/answer-only-evidence.cjs').createAnswerOnlyEvidence({documents:answerDocuments,source:require('../adapters/http/paragraph-evidence.cjs').createParagraphEvidence({resourceBase,authorizedDocuments:()=>answerDocuments})}):null;
 const publicChat=publicCatalog?require('../adapters/http/public-chat.cjs').createPublicChat({app,knowledge,catalog:publicCatalog,expert,verifiedDocuments,evidenceSource,answerSource}):null;
 const publicSearch=evidenceSource?require('../adapters/http/public-search.cjs').createPublicSearch({source:evidenceSource,release:localRelease,lookup:knowledge}):null;
 const graydeskReceiver=require('../external-services/graydesk-errors.cjs').createGraydeskReceiver({configFile:path.join(dataDirectory,'graydesk.private.json'),directory:path.join(dataDirectory,'graydesk-errors')});
 const server=createServer({...app,health:()=>({...app.health(),graydesk:{configured:graydeskReceiver.configured},feishu:logs.status(),trial:{instance:'v2-offline',host,port,resourcePort,publicOnly:!!options['public-only'],modelMode:'expert-opt-in',roleIndexEnabled:!!roleIndex,knowledgeMode:manifestFile,pid:process.pid,indexPid:child.pid}})},{offlineKnowledge,accessGuard,publicCatalog,publicChat,developmentMonitor,graydeskReceiver,publicSearch,publicOnly:!!options['public-only']});
 const preparationStarted=Date.now();
 try{await server.prepareCatalogs();console.log(JSON.stringify({event:'catalog-prepared',elapsedMs:Date.now()-preparationStarted}));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});}catch(e){child.kill();logs.close();throw e;}
 const runtime={instance:'v2-offline',host,lan,port,resourcePort,publicOrigin:options['public-origin']||null,publicScope:localRelease?'local-public-release-paragraphs;answer-only-anonymous-references':publicCatalog?'product-quick-and-approved-cloud-documents':null,publicOnly:!!options['public-only'],publicOriginals:localRelease?.grants().length,pid:process.pid,indexPid:child.pid,knowledgeVersion:knowledge.version,startedAt:new Date().toISOString()};
 fs.writeFileSync(path.join(dataDirectory,'runtime.json'),JSON.stringify(runtime,null,2));
 server.on('request',(req,res)=>{if(!req.url.startsWith('/api/')||req.url.startsWith('/api/health')||req.url.startsWith('/api/huidu/log'))return;const start=Date.now();res.once('finish',()=>{try{logs.activity({sessionId:'v2-runtime',...require('../adapters/http/access-entry.cjs').accessEntry(req),route:req.url.split('?')[0],method:req.method,status:res.statusCode,elapsedMs:Date.now()-start});}catch{console.error('V2 runtime log could not be retained locally');}});});
 const close=()=>new Promise(resolve=>{logs.close();server.closeAllConnections();server.close(()=>{capture?.clear();child.kill();resolve();});});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
 child.on('exit',()=>{if(server.listening)console.error('Resource process stopped: product lookup and ordering remain available, original search is temporarily unavailable.');});
 console.log(JSON.stringify({instance:'v2-offline',url:'http://'+(lan?.address||'127.0.0.1')+':'+port,wiki:'/wiki',consultation:'/huiai',knowledgeVersion:knowledge.version,modelCalls:0,resourcePort,pid:process.pid,indexPid:child.pid}));
 return {server,close};
}
if(require.main===module){const {values}=parseArgs({options:{...Object.fromEntries(['port','resource-port','index','knowledge','manifest','python','data','feishu-config','lan-address','expert-model-url','role-index','public-origin','public-allowlist','oss-config','public-release','answer-grants'].map(k=>[k,{type:'string'}])),lan:{type:'boolean',default:false},'bonsai-monitor':{type:'boolean',default:false},'public-only':{type:'boolean',default:false}}});startOffline(values).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={startOffline};
