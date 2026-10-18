'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLanGuard}=require('../adapters/http/lan-access.cjs'),{createPublicCatalog}=require('../adapters/http/public-catalog.cjs');
test('Exact tunnel origin grants only public quick routes; internal files, sessions and write APIs stay denied',()=>{
 const guard=createLanGuard({address:'192.168.1.100',cidr:'192.168.1.100/24',port:8520,publicOrigin:'http://trial.example'});
 const run=(url,method='GET',extra={})=>{const req={url,method,headers:{host:'trial.example',...extra},socket:{remoteAddress:'127.0.0.1'}},res={setHeader(){},writeHead(s){this.status=s;},end(){}};return{ok:guard(req,res),status:res.status,public:req.v2Public};};
 assert.equal(run('/quick').status,403);assert.equal(run('/wiki').ok,true);assert.equal(run('/api/docs?cat=spec').ok,true);
 for(const route of ['/huiai','/v2/offline/file?id=1','/v2/offline/session?id=other','/v2/resources/original/'+'a'.repeat(64),'/api/health','/api/huidu/log'])assert.equal(run(route).status,403);
 assert.equal(run('/api/search','POST').status,403);assert.equal(run('/quick','GET',{host:'attacker.example'}).status,403);assert.equal(run('/quick','GET',{origin:'http://attacker.example'}).status,403);
});
test('Only approved cloud originals get short-lived links; local locations and evidence are removed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-public-'));try{
  fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({AccessKeyId:'synthetic-id',AccessKeySecret:'synthetic-secret',Bucket:'synthetic-bucket',Region:'oss-cn-shenzhen'}));
  fs.writeFileSync(path.join(dir,'allow.json'),JSON.stringify({schemaVersion:'v2-public-cloud-1',objects:[{name:'Z9规格书 V1.0.pdf',key:'official-files/Z9规格书 V1.0.pdf'}]}));
  const c=createPublicCatalog({configFile:path.join(dir,'config.json'),allowlistFile:path.join(dir,'allow.json'),now:()=>1000000});
  const out=c.transform({items:[{name:'Z9规格书 V1.0.pdf',url:'/v2/offline/file?id=1',sourceReference:{originalPath:'G:\\private'}},{name:'internal.docx',url:'/v2/offline/file?id=2'}],sourceExcerpt:'private'});
  assert.match(out.items[0].url,/^https:\/\/synthetic-bucket/);assert.equal(new URL(out.items[0].url).searchParams.get('Expires'),'1300');assert.equal(out.items[1].url,null);assert.equal(out.items[1].available,false);assert.equal(out.sourceExcerpt,undefined);assert.equal(out.items[0].sourceReference,undefined);assert.ok(!JSON.stringify(out).includes('synthetic-secret'));assert.ok(!JSON.stringify(out).includes('/v2/offline/file'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('Public log upload reaches only the existing authenticated receiver and never opens internal APIs',async()=>{
 const {createServer}=require('../adapters/http/server.cjs'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
 let received=[];const logs={authorized:key=>key==='synthetic-key',receive:body=>{received.push(body);return {ok:true,dedup:false};}};
 const offline=createOfflineKnowledge({knowledge:{cases:()=>[],products:()=>[],evidenceDocuments:()=>[]},logs});
 const guard=createLanGuard({address:'127.0.0.2',cidr:'127.0.0.2/24',port:8520,publicOrigin:'http://trial.example'});
 const server=createServer(undefined,{offlineKnowledge:offline,accessGuard:guard});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const send=(route,method='POST',headers={},body='{}')=>new Promise((resolve,reject)=>{const request=require('node:http').request(base+route,{method,headers:{Host:'trial.example','Content-Type':'application/json',...headers}},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>resolve({status:response.statusCode,json:async()=>JSON.parse(Buffer.concat(chunks))}));});request.on('error',reject);request.end(method==='GET'?undefined:body);});
 try{
  for(const key of ['', 'wrong']){const r=await send('/api/huidu/log','POST',{'x-upload-key':key});assert.equal(r.status,403);assert.equal((await r.json()).error,'upload-key-required');}assert.equal(received.length,0);
  const payload={machine_id:'synthetic',log_date:'2026-10-18',content:'synthetic upload'};const r=await send('/api/huidu/log','POST',{'x-upload-key':'synthetic-key'},JSON.stringify(payload));assert.equal(r.status,200);assert.equal((await r.json()).ok,true);assert.deepEqual(received,[payload]);
  assert.equal((await send('/api/huidu/log','POST',{'x-upload-key':'synthetic-key'},'{')).status,400);
  assert.equal((await send('/api/huidu/log','POST',{'x-upload-key':'synthetic-key'},JSON.stringify({content:'x'.repeat(1024*1024)}))).status,413);
  for(const route of ['/api/huidu/log','/v2/offline/session?id=another','/v2/offline/log-status','/api/health'])assert.equal((await send(route,'GET')).status,403);
  for(const route of ['/api/ai/chat','/api/ocr','/v2/ordering/chat'])assert.equal((await send(route,'POST',{'x-upload-key':'synthetic-key'})).status,403);
  assert.equal((await send('/api/huidu/log','POST',{'x-upload-key':'synthetic-key',Origin:'https://evil.example'})).status,403);assert.equal(received.length,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
