'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const PRODUCT='xiaohuijiang-firmware-assistant',BASE='/api/assistant-updates/v1';
const build=v=>typeof v==='string'&&/^[1-9]\d{0,19}$/.test(v);
const compare=(a,b)=>{if(!build(a)||!build(b))throw Error('invalid-build');return BigInt(a)>BigInt(b)?1:BigInt(a)<BigInt(b)?-1:0;};
const keyId=pem=>crypto.createHash('sha256').update(crypto.createPublicKey(pem).export({type:'spki',format:'der'})).digest('hex');
function sign(payload,privateKey){const bytes=Buffer.from(JSON.stringify(payload));return {algorithm:'RSA-PSS-SHA256',keyId:keyId(privateKey),payload:bytes.toString('base64'),signature:crypto.sign('sha256',bytes,{key:privateKey,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64')};}
function verify(envelope,publicKey,{allowExpired=false}={}){
 if(envelope?.algorithm!=='RSA-PSS-SHA256'||envelope.keyId!==keyId(publicKey)||!crypto.verify('sha256',Buffer.from(envelope.payload,'base64'),{key:publicKey,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32},Buffer.from(envelope.signature,'base64')))throw Error('invalid-signature');
 const p=JSON.parse(Buffer.from(envelope.payload,'base64'));if(p.productId!==PRODUCT||p.schemaVersion!==1||!['stable','test'].includes(p.channel)||!Number.isFinite(Date.parse(p.expiresAt))||!allowExpired&&Date.parse(p.expiresAt)<=Date.now())throw Error('invalid-or-expired-manifest');return p;
}
function config(file){const c=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));if(!path.isAbsolute(c.directory)||!c.publicKey)throw Error('invalid-update-config');const origin=new URL(c.publicOrigin);if(!['http:','https:'].includes(origin.protocol)||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw Error('invalid-update-origin');return {...c,directory:path.resolve(c.directory),publicOrigin:origin.origin};}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.partial';const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
function safeFile(root,file){const full=path.resolve(root,file),real=fs.realpathSync(full),base=fs.realpathSync(root);if(!real.startsWith(base+path.sep)||fs.lstatSync(full).isSymbolicLink())throw Error('invalid-package-path');return real;}
async function inspect(file){const handle=await fsp.open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<64)throw Error('invalid-exe');
 const dos=Buffer.alloc(64);await handle.read(dos,0,64,0);const peOffset=dos.readUInt32LE(60);if(dos.toString('ascii',0,2)!=='MZ'||peOffset<64||peOffset>stat.size-26)throw Error('invalid-exe');const pe=Buffer.alloc(26);await handle.read(pe,0,26,peOffset);if(pe.readUInt32LE(0)!==0x4550||pe.readUInt16LE(4)!==0x8664||pe.readUInt16LE(24)!==0x20b)throw Error('expected-windows-x64-pe-exe');
 const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(!bytesRead)break;digest.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}return {size:offset,sha256:digest.digest('hex')};}finally{await handle.close();}}
function channelName(channel){if(!['stable','test'].includes(channel))throw Error('invalid-channel');return channel;}
function readState(c,channel){const file=path.join(c.directory,channelName(channel),'current.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
function journal(c,event){fs.appendFileSync(path.join(c.directory,'release-audit.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n');}
async function mutate(configFile,privateKeyFile,channel,action,options={}){
 const c=config(configFile);channelName(channel);if(channel==='stable'&&options.approveStable!==true)throw Error('explicit-stable-approval-required');
 if(path.resolve(privateKeyFile).startsWith(c.directory+path.sep))throw Error('private-key-inside-release-directory');
 const privateKey=fs.readFileSync(privateKeyFile,'utf8');if(keyId(privateKey)!==keyId(c.publicKey))throw Error('signing-key-mismatch');
 const dir=path.join(c.directory,channel);fs.mkdirSync(dir,{recursive:true});const lock=fs.openSync(path.join(c.directory,'.publish.lock'),'wx');
 try{
  const old=readState(c,channel),prior=old?verify(old,c.publicKey,{allowExpired:true}):null,now=new Date(),sequence=String(BigInt(prior?.sequence||'0')+1n);
  let latest=prior?.latest||null,revoked=[...prior?.revokedBuilds||[]],previous=prior?.previous||null,highest=prior?.highestBuild||'0';
  if(action==='publish'){
   if(!build(options.build)||!options.displayVersion||typeof options.notes!=='string'||!Number.isSafeInteger(options.size)||options.size<2||!/^[a-f0-9]{64}$/.test(options.sha256))throw Error('invalid-release-metadata');
   if(prior?.latest?.build===options.build&&['displayVersion','notes','size','sha256'].every(k=>prior.latest[k]===options[k])){
    const existing=await inspect(safeFile(dir,path.join('packages',prior.latest.fileName)));if(existing.size!==options.size||existing.sha256!==options.sha256)throw Error('published-package-corrupt');return old;
   }
   if(highest!=='0'&&compare(options.build,highest)<=0)throw Error('build-must-increase');
   const source=path.resolve(options.file);const initial=await inspect(source);if(initial.size!==options.size||initial.sha256!==options.sha256)throw Error('package-size-or-hash-mismatch');
   const fileName=options.build+'-'+options.sha256+'.exe',packages=path.join(dir,'packages');fs.mkdirSync(packages,{recursive:true});const stage=path.join(packages,crypto.randomUUID()+'.partial'),final=path.join(packages,fileName);
   try{await fsp.copyFile(source,stage,fs.constants.COPYFILE_EXCL);const checked=await inspect(stage);if(checked.size!==options.size||checked.sha256!==options.sha256)throw Error('copied-package-mismatch');const fd=fs.openSync(stage,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fs.existsSync(final)){const orphan=await inspect(safeFile(dir,path.join('packages',fileName)));if(orphan.size!==options.size||orphan.sha256!==options.sha256)throw Error('orphan-package-corrupt');}else await fsp.rename(stage,final);}finally{if(fs.existsSync(stage))fs.unlinkSync(stage);}
   latest={productId:PRODUCT,build:options.build,displayVersion:options.displayVersion,publishedAt:now.toISOString(),notes:options.notes,fileName,size:options.size,sha256:options.sha256,downloadUrl:c.publicOrigin+BASE+'/'+channel+'/files/'+fileName,testOnly:channel==='test',platform:'windows-x64',format:'single-exe'};
   previous=prior?.latest||null;highest=options.build;
  }else if(action==='rollback'){
   if(!latest||!previous)throw Error('no-previous-release');if(!revoked.includes(latest.build))revoked.push(latest.build);latest=previous;previous=null;
  }else if(action==='withdraw'){
   if(latest&&!revoked.includes(latest.build))revoked.push(latest.build);previous=latest;latest=null;
  }else if(!['init','renew'].includes(action))throw Error('invalid-release-action');
  if(action==='init'&&old)throw Error('channel-already-initialized');
  if(latest){const actual=await inspect(safeFile(dir,path.join('packages',latest.fileName)));if(actual.size!==latest.size||actual.sha256!==latest.sha256)throw Error('published-package-corrupt');latest={...latest,downloadUrl:c.publicOrigin+BASE+'/'+channel+'/files/'+latest.fileName};}
  if(previous)previous={...previous,downloadUrl:c.publicOrigin+BASE+'/'+channel+'/files/'+previous.fileName};
  const payload={schemaVersion:1,productId:PRODUCT,channel,sequence,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+7*86400000).toISOString(),highestBuild:highest,latest,previous,revokedBuilds:revoked};
  const envelope=sign(payload,privateKey);if(options.beforeSwitch)await options.beforeSwitch();
  // A single signed pointer is the commit point; archives/packages are immutable.
  atomic(path.join(dir,'history',sequence+'.json'),envelope);atomic(path.join(dir,'current.json'),envelope);journal(c,{action,channel,sequence,build:latest?.build||null});return envelope;
 }finally{fs.closeSync(lock);fs.unlinkSync(path.join(c.directory,'.publish.lock'));}
}
function isUpdateRoute(method,route){return ['GET','HEAD'].includes(method)&&new RegExp('^'+BASE+'/(stable|test)/(latest|files/[1-9][0-9]{0,19}-[a-f0-9]{64}\\.exe)$').test(route);}
function createAssistantUpdates({configFile}){
 return {async handle(req,res){
  const url=new URL(req.url,'http://localhost'),route=url.pathname;if(!route.startsWith(BASE+'/'))return false;
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:JSON.stringify(body));return true;};
  if(!isUpdateRoute(req.method,route))return json(404,{error:'update-route-not-found'});
  let c;try{c=config(configFile);}catch{return json(503,{error:'updates-not-configured'});}
  const channel=route.split('/')[4];if(channel==='test'&&c.testEnabled!==true)return json(404,{error:'test-channel-disabled'});
  let envelope,payload;try{envelope=readState(c,channel);if(!envelope)return json(503,{error:'channel-not-initialized'});payload=verify(envelope,c.publicKey);if(payload.channel!==channel)throw Error('channel-mismatch');}catch{return json(503,{error:'manifest-invalid-or-expired'});}
  if(route.endsWith('/latest')){
   if([...url.searchParams.keys()].some(k=>k!=='currentBuild')||url.searchParams.has('currentBuild')&&!build(url.searchParams.get('currentBuild')))return json(400,{error:'invalid-current-build'});
   // Hints are deliberately outside the envelope; client must recompute after signature verification.
   return json(200,{...envelope,status:payload.latest?'published':'no-release',hasUpdate:payload.latest?(url.searchParams.has('currentBuild')?compare(payload.latest.build,url.searchParams.get('currentBuild'))>0:true):false});
  }
  const fileName=route.split('/').at(-1),id=fileName.split('-')[0];if(payload.revokedBuilds.includes(id))return json(410,{error:'release-withdrawn'});
  const release=[payload.latest,payload.previous].find(r=>r?.fileName===fileName);if(!release)return json(404,{error:'package-not-published'});
  let handle;try{
   const file=safeFile(path.join(c.directory,channel),path.join('packages',fileName));handle=await fsp.open(file,'r');
   const stat=await handle.stat(),digest=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
   for(;;){const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(!bytesRead)break;digest.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
   if(!stat.isFile()||offset!==release.size||digest.digest('hex')!==release.sha256)throw Error('corrupt');
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':release.size,'Content-Disposition':'attachment; filename="'+fileName+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','ETag':'"'+release.sha256+'"'});
   if(req.method==='HEAD'){await handle.close();handle=null;res.end();}else{const stream=handle.createReadStream({start:0,autoClose:true});handle=null;res.once('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);}return true;
  }catch{if(handle)await handle.close();return json(503,{error:'package-missing-or-corrupt'});}
 }};
}
module.exports={PRODUCT,BASE,build,compare,keyId,sign,verify,config,atomic,inspect,mutate,isUpdateRoute,createAssistantUpdates};
