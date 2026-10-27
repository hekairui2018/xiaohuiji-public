'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const BASE='/api/graydesk/updates/standard/win-x64',ADMIN='/api/graydesk/updates/admin',LIMIT=512*1024*1024;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function error(message,status=400){const e=Error(message);e.status=status;throw e;}
function version(v){const m=/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})-test\.(\d{8})\.(0|[1-9]\d{0,8})$/.exec(v||'');if(!m)error('invalid-standard-version');return m.slice(1).map(Number);}
function compare(a,b){const x=version(a),y=version(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
function atomic(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.partial',fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(obj,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}try{fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
function load(file){const c=JSON.parse(fs.readFileSync(file,'utf8'));if(!path.isAbsolute(c.directory)||!path.isAbsolute(c.sourceRoot)||typeof c.adminToken!=='string'||c.adminToken.length<32)error('invalid-config',503);if(c.publicOrigin){const u=new URL(c.publicOrigin);if(!['http:','https:'].includes(u.protocol)||u.pathname!=='/'||u.search||u.hash||u.username||u.password)error('invalid-public-origin',503);}return c;}
async function inspect(file){const h=await fsp.open(file,'r');try{const stat=await h.stat();if(!stat.isFile()||stat.size<128||stat.size>LIMIT)error('invalid-package-size');const dos=Buffer.alloc(64);await h.read(dos,0,64,0);const offset=dos.readUInt32LE(60);if(dos.toString('ascii',0,2)!=='MZ'||offset<64||offset>stat.size-6)error('invalid-pe');const pe=Buffer.alloc(6);await h.read(pe,0,6,offset);if(pe.readUInt32LE()!==0x4550||![0x14c,0x8664].includes(pe.readUInt16LE(4)))error('invalid-pe');const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);let pos=0;for(;;){const r=await h.read(buffer,0,buffer.length,pos);if(!r.bytesRead)break;digest.update(buffer.subarray(0,r.bytesRead));pos+=r.bytesRead;}return {size:pos,sha256:digest.digest('hex')};}finally{await h.close();}}
function contained(root,file){const base=fs.realpathSync(root),real=fs.realpathSync(file);if(!real.startsWith(base+path.sep)||fs.lstatSync(file).isSymbolicLink())error('package-outside-authorized-root');return real;}
function store(configFile){
 const config=()=>load(configFile),read=(c)=>{const p=path.join(c.directory,'state.json');return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{latest:null,highest:null,releases:[],audit:[]};};
 async function mutate(action,options,actor='local-operator'){
  const c=config();fs.mkdirSync(c.directory,{recursive:true});let lock;try{lock=fs.openSync(path.join(c.directory,'.publish.lock'),'wx');}catch{error('publication-busy',409);}
  try{const s=read(c);if(!['stage','publish','withdraw'].includes(action))error('invalid-action');
   if(action==='stage'){
    version(options.version);if(options.edition!=='standard'||options.arch!=='win-x64')error('wrong-product-channel');
    const fileName='灰Desk-'+options.version+'-安装包.exe';if(typeof options.file!=='string'||path.basename(options.file)!==fileName)error('unexpected-installer-name');
    if(typeof options.releaseNotes!=='string'||!options.releaseNotes.trim()||options.releaseNotes.length>4000)error('invalid-release-notes');
    if(s.releases.some(r=>r.version===options.version))error('version-already-registered',409);
    if(s.highest&&compare(options.version,s.highest)<=0)error('downgrade-forbidden',409);
    const file=contained(c.sourceRoot,options.file),meta=await inspect(file);
    if(options.expectedSHA256&&meta.sha256!==options.expectedSHA256.toLowerCase())error('source-hash-mismatch');
    const dir=path.join(c.directory,'packages');fs.mkdirSync(dir,{recursive:true});const packageId=meta.sha256+'.exe',dest=path.join(dir,packageId),tmp=path.join(dir,crypto.randomUUID()+'.partial');
    try{await fsp.copyFile(file,tmp,fs.constants.COPYFILE_EXCL);const copy=await inspect(tmp);if(copy.size!==meta.size||copy.sha256!==meta.sha256)error('copied-package-mismatch',503);const fd=fs.openSync(tmp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fs.existsSync(dest)){const old=await inspect(dest);if(old.sha256!==meta.sha256)error('stored-package-corrupt',503);}else await fsp.rename(tmp,dest);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    s.releases.push({product:'graydesk',edition:'standard',arch:'win-x64',version:options.version,fileName,...meta,releaseNotes:options.releaseNotes,registeredAt:new Date().toISOString(),registeredBy:actor,packageId});
   }else if(action==='publish'){
    if(!c.publicOrigin)error('public-origin-not-configured',409);if(options.confirmVersion!==options.version)error('explicit-version-confirmation-required');
    const r=s.releases.find(r=>r.version===options.version);if(!r)error('release-not-registered',404);
    if(s.highest&&compare(r.version,s.highest)<=0)error('downgrade-or-republish-forbidden',409);
    const meta=await inspect(contained(c.directory,path.join(c.directory,'packages',r.packageId)));if(meta.sha256!==r.sha256||meta.size!==r.size)error('registered-package-corrupt',503);
    r.publishedAt=new Date().toISOString();r.publishedBy=actor;s.latest=r.version;s.highest=r.version;
   }else{s.latest=null;}
   s.audit.push({action,version:options.version||null,actor,at:new Date().toISOString()});atomic(path.join(c.directory,'state.json'),s);return {ok:true,action,latest:s.latest,registered:options.version||null};
  }finally{fs.closeSync(lock);fs.unlinkSync(path.join(c.directory,'.publish.lock'));}
 }
 const manifest=(c,s)=>{const r=s.releases.find(r=>r.version===s.latest);if(!r)return null;if(!c.publicOrigin)error('public-origin-not-configured',503);return {product:r.product,edition:r.edition,arch:r.arch,version:r.version,fileName:r.fileName,downloadUrl:c.publicOrigin+BASE+'/files/'+r.packageId,size:r.size,sha256:r.sha256,releaseNotes:r.releaseNotes,publishedAt:r.publishedAt};};
 return {config,read,mutate,manifest};
}
function isPublicRoute(method,route){return ['GET','HEAD'].includes(method)&&(route===BASE||new RegExp('^'+BASE+'/files/[a-f0-9]{64}\\.exe$').test(route));}
function createGraydeskUpdates({configFile}){
 const data=store(configFile),buckets=new Map();
 function allowed(req){const key=String(req.socket.remoteAddress),minute=Math.floor(Date.now()/60000);if(buckets.size>4096)for(const [k,v]of buckets)if(v.minute!==minute)buckets.delete(k);if(buckets.size>4096&&!buckets.has(key))return false;let v=buckets.get(key);if(!v||v.minute!==minute){v={minute,count:0};buckets.set(key,v);}return ++v.count<=120;}
 return {async handle(req,res){
  const route=req.url.split('?')[0];if(!route.startsWith('/api/graydesk/updates/'))return false;
  const send=(status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(req.method==='HEAD'?undefined:JSON.stringify(body));return true;};
  try{
   if(route.startsWith(ADMIN)){
    const local=['127.0.0.1','::1'].includes(String(req.socket.remoteAddress||'').replace(/^::ffff:/,''))&&/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'')&&!req.v2Public&&!req.headers.origin;
    if(!local)return send(403,{error:'local-admin-only'});
    const c=data.config(),a=Buffer.from(String(req.headers.authorization||'')),b=Buffer.from('Bearer '+c.adminToken);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return send(401,{error:'admin-credential-required'});
    if(req.method==='GET'&&route===ADMIN)return send(200,data.read(c));
    if(req.method!=='POST'||!['stage','publish','withdraw'].some(x=>route===ADMIN+'/'+x))return send(404,{error:'admin-route-not-found'});
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))return send(415,{error:'json-required'});
    const chunks=[];let n=0;const timer=setTimeout(()=>req.destroy(),10000);timer.unref();try{for await(const chunk of req){n+=chunk.length;if(n>16384)return send(413,{error:'admin-request-too-large'});chunks.push(chunk);}}finally{clearTimeout(timer);}
    let options;try{options=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:'invalid-json'});}if(!options||typeof options!=='object'||Array.isArray(options))return send(400,{error:'invalid-options'});
    return send(200,await data.mutate(route.split('/').at(-1),options,'authenticated-local-admin'));
   }
   if(!isPublicRoute(req.method,route))return send(404,{error:'update-route-not-found'});
   if(!allowed(req))return send(429,{error:'rate-limited'},{'Retry-After':'60'});
   const c=data.config(),s=data.read(c),m=data.manifest(c,s);if(!m)return send(404,{error:'no-release'});
   if(route===BASE){const etag='"'+hash(JSON.stringify(m))+'"';if(req.headers['if-none-match']===etag){res.writeHead(304,{'ETag':etag,'Cache-Control':'public, max-age=30'});res.end();return true;}return send(200,m,{'ETag':etag,'Cache-Control':'public, max-age=30'});}
   const id=route.split('/').at(-1);if(id!==m.sha256+'.exe')return send(404,{error:'package-not-published'});
   let file,meta;try{file=contained(c.directory,path.join(c.directory,'packages',id));meta=await inspect(file);}catch{return send(503,{error:'package-missing-or-corrupt'});}if(meta.size!==m.size||meta.sha256!==m.sha256)return send(503,{error:'package-corrupt'});
   const stat=fs.statSync(file);let start=0,end=stat.size-1,status=200;const headers={'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename=graydesk-installer.exe; filename*=UTF-8''"+encodeURIComponent(m.fileName),'Cache-Control':'public, max-age=30','ETag':'"'+m.sha256+'"','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
   if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match)return send(416,{error:'invalid-range'},{'Content-Range':'bytes */'+stat.size});start=Number(match[1]);end=match[2]?Number(match[2]):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=stat.size)return send(416,{error:'invalid-range'},{'Content-Range':'bytes */'+stat.size});status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+stat.size;}
   headers['Content-Length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD')res.end();else{const stream=fs.createReadStream(file,{start,end});res.once('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);}return true;
  }catch(e){if(res.headersSent){res.destroy();return true;}return send(e.status||503,{error:e.status?e.message:'update-storage-unavailable'});}
 }};
}
module.exports={BASE,ADMIN,LIMIT,version,compare,inspect,atomic,store,isPublicRoute,createGraydeskUpdates};
