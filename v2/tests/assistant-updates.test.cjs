'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {mutate,inspect,verify,sign,compare,createAssistantUpdates,BASE}=require('../external-services/assistant-updates.cjs');
async function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'xhj-update-')),directory=path.join(root,'release'),configFile=path.join(root,'config.json'),privateKeyFile=path.join(root,'key.pem');fs.mkdirSync(directory);const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});fs.writeFileSync(privateKeyFile,pair.privateKey);fs.writeFileSync(configFile,JSON.stringify({directory,publicOrigin:'http://updates.invalid',publicKey:pair.publicKey,testEnabled:true}));const service=createAssistantUpdates({configFile});const server=http.createServer(async(req,res)=>{if(!await service.handle(req,res)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const publish=async(build,extra={})=>{const file=path.join(root,build+'.exe'),bytes=Buffer.alloc(256);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.writeUInt32LE(0x4550,128);bytes.writeUInt16LE(0x8664,132);bytes.writeUInt16LE(0x20b,152);bytes.write('synthetic '+build,180);fs.writeFileSync(file,bytes);const facts=await inspect(file);return mutate(configFile,privateKeyFile,'test','publish',{file,build,displayVersion:'2.1.2 test',notes:'synthetic only',...facts,...extra});};
 return {root,directory,configFile,privateKeyFile,pair,origin,publish,read:()=>JSON.parse(fs.readFileSync(path.join(directory,'test/current.json'))),close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}};}
test('Signed no release, unique build ordering, no update/new update, repeat query and exact download',async()=>{const f=await fixture();try{
 await mutate(f.configFile,f.privateKeyFile,'test','init');const empty=await (await fetch(f.origin+BASE+'/test/latest')).json();assert.equal(empty.hasUpdate,false);assert.equal(verify(empty,f.pair.publicKey).latest,null);assert.equal(compare('202610270001','202610260999'),1);assert.throws(()=>compare('2.1.2.0','1'));
 const signed=await f.publish('202610270001'),p=verify(signed,f.pair.publicKey);assert.equal(p.latest.testOnly,true);
 for(const [current,expected]of [['202610260001',true],['202610270001',false],['202610280001',false]]){const r=await fetch(f.origin+BASE+'/test/latest?currentBuild='+current);assert.equal(r.status,200);assert.equal((await r.json()).hasUpdate,expected);}
 const url=f.origin+new URL(p.latest.downloadUrl).pathname;for(let i=0;i<2;i++){const response=await fetch(url),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.equal(bytes.length,p.latest.size);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),p.latest.sha256);}
 assert.equal((await fetch(f.origin+BASE+'/test/latest?currentBuild=2.1.2.0')).status,400);
 assert.deepEqual(await f.publish('202610270001'),signed);
 await assert.rejects(()=>f.publish('202610270001',{notes:'conflicting repeat'}),/build-must-increase/);
 }finally{await f.close();}});
test('Missing/corrupt packages and wrong size/hash fail closed; interrupted release never changes latest',async()=>{const f=await fixture();try{
 const first=await f.publish('10'),p=verify(first,f.pair.publicKey),file=path.join(f.directory,'test/packages',p.latest.fileName),url=f.origin+new URL(p.latest.downloadUrl).pathname;
 await assert.rejects(()=>f.publish('11',{size:999}),/size-or-hash/);await assert.rejects(()=>f.publish('11',{sha256:'0'.repeat(64)}),/size-or-hash/);assert.deepEqual(f.read(),first);
 await assert.rejects(()=>f.publish('12',{beforeSwitch:()=>{throw Error('simulated-interrupt');}}),/simulated-interrupt/);assert.deepEqual(f.read(),first);assert.equal((await fetch(f.origin+BASE+'/test/files/12-'+'0'.repeat(64)+'.exe')).status,404);
 assert.equal(verify(await f.publish('12'),f.pair.publicKey).latest.build,'12','verified orphan file can be reused after interruption');
 fs.writeFileSync(file,'damaged');assert.equal((await fetch(url)).status,503);fs.unlinkSync(file);assert.equal((await fetch(url)).status,503);
 }finally{await f.close();}});
test('Atomic rollback retains previous version, revoked EXE is denied, withdraw is signed and stable requires explicit approval',async()=>{const f=await fixture();try{
 const a=verify(await f.publish('100'),f.pair.publicKey),b=verify(await f.publish('101'),f.pair.publicKey);
 const rollback=verify(await mutate(f.configFile,f.privateKeyFile,'test','rollback'),f.pair.publicKey);assert.equal(rollback.latest.build,a.latest.build);assert(rollback.revokedBuilds.includes('101'));assert.equal(rollback.highestBuild,'101');assert.equal((await fetch(f.origin+new URL(b.latest.downloadUrl).pathname)).status,410);assert.equal((await fetch(f.origin+new URL(a.latest.downloadUrl).pathname)).status,200);
 await assert.rejects(()=>f.publish('101'),/build-must-increase/);const withdrawn=verify(await mutate(f.configFile,f.privateKeyFile,'test','withdraw'),f.pair.publicKey);assert.equal(withdrawn.latest,null);
 await assert.rejects(()=>mutate(f.configFile,f.privateKeyFile,'stable','init'),/explicit-stable/);
 }finally{await f.close();}});
test('Signature tamper, wrong key, expired state, test/stable substitution, unpublished paths and disabled tests denied',async()=>{const f=await fixture();try{
 const e=await f.publish('200'),p=verify(e,f.pair.publicKey);assert.throws(()=>verify({...e,payload:Buffer.from('{}').toString('base64')},f.pair.publicKey));assert.throws(()=>verify(e,crypto.generateKeyPairSync('rsa',{modulusLength:2048}).publicKey));
 const expired=sign({...p,expiresAt:'2000-01-01T00:00:00Z'},f.pair.privateKey);assert.throws(()=>verify(expired,f.pair.publicKey));fs.writeFileSync(path.join(f.directory,'test/current.json'),JSON.stringify(expired));assert.equal((await fetch(f.origin+BASE+'/test/latest')).status,503);
 const migrated=JSON.parse(fs.readFileSync(f.configFile));migrated.publicOrigin='https://new-updates.invalid';fs.writeFileSync(f.configFile,JSON.stringify(migrated));
 const renewed=verify(await mutate(f.configFile,f.privateKeyFile,'test','renew'),f.pair.publicKey);assert(renewed.latest.downloadUrl.startsWith('https://new-updates.invalid/'));assert.equal((await fetch(f.origin+BASE+'/test/latest')).status,200);
 fs.mkdirSync(path.join(f.directory,'stable'));fs.writeFileSync(path.join(f.directory,'stable/current.json'),JSON.stringify(e));assert.equal((await fetch(f.origin+BASE+'/stable/latest')).status,503);
 for(const route of ['/test/files/../config.json','/test/files/secret.pem','/test/files/%2e%2e%2fsecret','/test/files/file.exe'])assert.notEqual((await fetch(f.origin+BASE+route)).status,200);
 const c=JSON.parse(fs.readFileSync(f.configFile));c.testEnabled=false;fs.writeFileSync(f.configFile,JSON.stringify(c));assert.equal((await fetch(f.origin+BASE+'/test/latest')).status,404);
 }finally{await f.close();}});
test('Publish lock prevents concurrent writers and remains until explicitly inspected after crash',async()=>{const f=await fixture();try{fs.writeFileSync(path.join(f.directory,'.publish.lock'),'synthetic');await assert.rejects(()=>f.publish('300'),/EEXIST/);assert(!fs.existsSync(path.join(f.directory,'test/current.json')));}finally{await f.close();}});

test('Existing server/guard exposes only update routes publicly and maintenance waits for existing handlers',async()=>{
 const f=await fixture();let server;try{
  await mutate(f.configFile,f.privateKeyFile,'stable','init',{approveStable:true});
  const {createLanGuard}=require('../adapters/http/lan-access.cjs'),{createServer}=require('../adapters/http/server.cjs');
  let release;const pending=new Promise(r=>{release=r;});
  const offlineKnowledge={async handle(req,res){if(req.url==='/api/synthetic-business'){await pending;res.end('completed');return true;}return false;}};
  const guard=createLanGuard({address:'192.168.1.2',cidr:'192.168.1.0/24',port:8520,publicOrigin:'http://updates.invalid'});
  const app={health:()=>({ok:true}),dialogue:async()=>({}),quickResources:()=>({}),quickSearch:()=>({records:[]}),quickBrowse:()=>[]};
  server=createServer(app,{accessGuard:guard,assistantUpdates:createAssistantUpdates({configFile:f.configFile}),offlineKnowledge,publicCatalog:{transform:v=>v}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const request=(route,method='GET',host='127.0.0.1:8520')=>new Promise((resolve,reject)=>{const req=http.request(origin+route,{method,headers:{Host:host}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end();});
  assert.equal((await request(BASE+'/stable/latest','GET','updates.invalid')).status,200);
  assert.equal((await request('/api/operations/maintenance','GET','updates.invalid')).status,403);
  const business=request('/api/synthetic-business');await new Promise(r=>setTimeout(r,25));
  const drain=await (await request('/api/operations/maintenance','POST')).json();assert.equal(drain.active,1);assert.equal(drain.maintenance,true);
  assert.equal((await request(BASE+'/stable/latest')).status,503);release();assert.equal((await business).status,200);
  assert.equal((await (await request('/api/operations/maintenance')).json()).active,0);
  await request('/api/operations/maintenance','DELETE');assert.equal((await request(BASE+'/stable/latest')).status,200);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await f.close();}
});
