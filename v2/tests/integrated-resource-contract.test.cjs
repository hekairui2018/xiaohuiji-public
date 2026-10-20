'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {resourceView}=require('../domain/knowledge/resource-view.cjs');
const {createRequestProgress}=require('../adapters/http/request-progress.cjs');
const {suggestModels}=require('../domain/knowledge/model-suggestion.cjs');
const {groupVideos}=require('../domain/knowledge/resource-categories.cjs');
test('One additive resource contract separates identity, association, original scope and absent cloud mapping',()=>{
 const raw={sha256:'a'.repeat(64),resourceVersionId:'v1',kind:'firmware',associatedModels:['HD-R712'],applicableModels:['HD-R716'],classificationBasis:'registered-folder',available:true};
 const out=resourceView(raw);assert.equal(out.source.fileId,'sha256:'+raw.sha256);assert.equal(out.source.cloudMappingStatus,'not-registered');assert.equal(out.source.cloudUrl,null);assert.deepEqual(out.associatedModels,['HD-R712']);
 assert.equal(out.relations[0].status,'associated-not-compatibility');assert.equal(out.relations[1].status,'original-scope-not-hardware-approval');assert.equal(raw.source,undefined);
 assert.equal(resourceView({name:'same.bin'}).source.identityStatus,'unknown');
});
test('Execution progress is request/session scoped, bounded, expires and cannot replay or advance after completion',()=>{
 let t=0;const progress=createRequestProgress({now:()=>t,max:2,ttl:50}),id='abcdefghijklmnop';
 const emit=progress.begin('one',id);emit('searching');assert.equal(progress.get('one',id).stage,'searching');assert.equal(progress.get('two',id),null);assert.equal(progress.get('one','differentrequest0'),null);
 assert.throws(()=>progress.begin('one',id),/reused/);emit('completed');emit('searching');assert.equal(progress.get('one',id).stage,'completed');t=51;assert.equal(progress.get('one',id),null);
 progress.begin('two',id);progress.begin('three',id);progress.begin('four',id);assert.equal(progress.get('two',id),null);
});
test('Optional model hints preserve actual known suffixes and reject ambiguous or unknown corrections',()=>{
 const products=['C16L','A5','A5L','R712'].map(modelId=>({modelId}));
 assert.equal(suggestModels('C16I花屏',products)?.model,'C16L');assert.equal(suggestModels('A5L说明书',products),null);assert.equal(suggestModels('R999故障',products),null);assert.equal(suggestModels('A5X',products),null);
});
test('Other video sections use explicit source reasons without changing category, count or original links',()=>{
 const videos=[{name:'复位.mp4',url:'/one'},{name:'设置.mp4',url:'/two'},{name:'操作.mp4',url:'/three'}];
 const resources=videos.map((v,i)=>({...v,folders:[['历史老视频','签章','待整理'][i]]}));const groups=groupVideos(videos,resources),other=groups.find(g=>g.key==='other');
 assert.equal(other.count,3);assert.deepEqual(new Set(other.sections.map(s=>s.label)),new Set(['历史视频','签章相关','待分类']));assert.deepEqual(new Set(other.sections.flatMap(s=>s.videos.map(v=>v.url))),new Set(['/one','/two','/three']));
});
test('Public provider scopes documents before retrieval, never uses local resolution, and keeps all internal routes closed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-public-integration-'));let server;
 try{
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({AccessKeyId:'synthetic',AccessKeySecret:'synthetic',Bucket:'synthetic',Region:'oss-cn-shenzhen'}));
  fs.writeFileSync(path.join(dir,'allow.json'),JSON.stringify({schemaVersion:'v2-public-cloud-1',objects:[{name:'X9说明书.pdf',key:'official-files/X9说明书.pdf'}]}));
  const catalog=require('../adapters/http/public-catalog.cjs').createPublicCatalog({configFile:path.join(dir,'config.json'),allowlistFile:path.join(dir,'allow.json')});
  let privateCalls=0;const {createApp}=require('../app/bootstrap.cjs'),app=createApp();
  const publicApp=catalog.scopeApp({...app,quickBrowse:()=>[{modelId:'HD-X9',displayName:'X9',documents:[{name:'X9说明书.pdf',kind:'manual'},{name:'private-guide.pdf',kind:'manual'}],claims:[{text:'private-only',sourceReference:{originalName:'private-guide.pdf'}}]}]});
  assert.equal(publicApp.quickBrowse()[0].documents.length,1);assert.equal(publicApp.quickBrowse()[0].claims.length,0);assert.equal(publicApp.quickSearch('private-only').records.length,0);assert.equal(catalog.approvedResources().length,1);
  const {createServer}=require('../adapters/http/server.cjs');server=createServer(app,{publicCatalog:catalog,accessGuard:req=>{req.v2Public=true;return true;},developmentMonitor:{handle:()=>{privateCalls++;return false;}},offlineKnowledge:{resolveDocuments:()=>{privateCalls++;throw Error('private-index-access');},handle:()=>{privateCalls++;return false;}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  for(const route of ['/v2/offline/search?q=R712','/v2/offline/progress?session=other','/v2/offline/suggestions?q=R71Z','/v2/resources/original/'+'a'.repeat(64)])assert.equal((await fetch(base+route)).status,403);
  assert.equal((await fetch(base+'/api/ai/chat',{method:'POST',body:'{}'})).status,403);
  const r=await fetch(base+'/api/search?q=A5');assert.equal(r.status,200);assert.equal(privateCalls,0);assert.equal((await fetch(base+'/api/videos')).status,200);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(dir,{recursive:true,force:true});}
});

test('HTTP progress reports actual pending execution only to the matching request and finalizes when answer returns',async()=>{
 const http=require('node:http');let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);const offline=require('../adapters/http/offline-knowledge.cjs').createOfflineKnowledge({expert:{answer:async({onProgress})=>{onProgress('searching');entered();await gate;onProgress('evidence-found');onProgress('composing');return {status:'answer',actualMode:'expert',reply:'synthetic result',results:[]};}}});
 const server=http.createServer((req,res)=>offline.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,sessionId='progress-http-session',requestId='abcdefghijklmnop';
 let pending;try{
  pending=fetch(base+'/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,requestId,message:'测试资料',mode:'expert'})});await ready;
  const url='/v2/offline/progress?session='+sessionId+'&request='+requestId;const current=await(await fetch(base+url)).json();assert.equal(current.stage,'searching');assert.equal(current.done,false);assert.equal((await fetch(base+url.replace(sessionId,'other-session'))).status,404);assert.equal(JSON.stringify(current).includes('测试资料'),false);
  release();assert.equal((await pending).status,200);const final=await(await fetch(base+url)).json();assert.equal(final.stage,'completed');assert.equal(final.done,true);
 }finally{release();if(pending)await pending;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
