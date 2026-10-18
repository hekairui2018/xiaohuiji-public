'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createFrontendServer}=require('../tools/start-frontend.cjs');
const listen=async(s,port=0)=>{await new Promise((r,j)=>{s.once('error',j);s.listen(port,'127.0.0.1',r);});return 'http://127.0.0.1:'+s.address().port;};
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r);});
test('V2 static root and scripts are independent from V1 files',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../adapters/http/static-service.cjs'),'utf8');assert.ok(!source.includes('../../../frontend'));
 for(const file of ['index.html','app.js','styles.css','v2-components.js','img/mascot-iron.png','offline-client.js','local-knowledge.js','site-compat.js'])assert.ok(fs.statSync(path.join(__dirname,'../frontend',file)).isFile());
 const v1=fs.readFileSync(path.join(__dirname,'../../backend/server.js'),'utf8');assert.ok(v1.includes('path.join(__dirname, "..", "frontend")'));
});
test('Frontend development serves its own edits, proxies existing APIs and never forwards secrets or log writes',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'v2-ui-isolation-'));fs.writeFileSync(path.join(temp,'index.html'),'<body>isolated UI</body>');fs.writeFileSync(path.join(temp,'app.js'),'first');
 const seen=[];const backend=http.createServer((req,res)=>{seen.push({url:req.url,headers:req.headers});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({results:[{name:'synthetic'}]}));});
 const base=await listen(backend),reserve=http.createServer();await listen(reserve);const port=reserve.address().port;await close(reserve);
 const front=createFrontendServer({backend:base,frontendRoot:temp,port});await listen(front,port);const url='http://127.0.0.1:'+port;
 try{
  assert.match(await fetch(url+'/wiki').then(r=>r.text()),/isolated UI/);assert.match(await fetch(url+'/huiai').then(r=>r.text()),/data-client="offline"/);
  assert.equal((await fetch(url+'/quick',{redirect:'manual'})).status,404);const root=await fetch(url+'/?cat=manual',{redirect:'manual'});assert.equal(root.status,302);assert.equal(root.headers.get('location'),'/wiki?cat=manual');
  assert.equal(await fetch(url+'/app.js').then(r=>r.text()),'first');fs.writeFileSync(path.join(temp,'app.js'),'edited');assert.equal(await fetch(url+'/app.js').then(r=>r.text()),'edited');
  const r=await fetch(url+'/api/search?q=synthetic',{headers:{Cookie:'private=secret',Authorization:'Bearer secret','X-Upload-Key':'secret'}}).then(r=>r.json());assert.equal(r.results[0].name,'synthetic');assert.equal(seen[0].headers.cookie,undefined);assert.equal(seen[0].headers.authorization,undefined);assert.equal(seen[0].headers['x-upload-key'],undefined);
  assert.equal((await fetch(url+'/api/huidu/log',{method:'POST',body:'{}'})).status,404);assert.equal((await fetch(url+'/v2/offline/log-status')).status,404);
  assert.equal((await fetch(url+'/api/search?q=x',{headers:{Origin:'https://example.com'}})).status,403);assert.equal(seen.length,1);
 }finally{await close(front);await close(backend);fs.rmSync(temp,{recursive:true,force:true});}
});

test('Frontend proxy exposes only the existing read-only software QR image route',async()=>{
 const backend=http.createServer((req,res)=>{res.setHeader('Content-Type','image/png');res.end('synthetic-image');});const base=await listen(backend),reserve=http.createServer();await listen(reserve);const port=reserve.address().port;await close(reserve);const front=createFrontendServer({backend:base,port});const url=await listen(front,port);
 try{const image=await fetch(url+'/v2/software-access/screen-control.png');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(await image.text(),'synthetic-image');assert.equal((await fetch(url+'/v2/software-access/screen-control.png',{method:'POST'})).status,404);assert.equal((await fetch(url+'/v2/software-access/unregistered.png')).status,404);}finally{await close(front);await close(backend);}
});

test('Static delivery selects an explicit mode, does not inject scripts or rewrite JavaScript',async()=>{
 const {serveStatic}=require('../adapters/http/static-service.cjs');const root=path.resolve(__dirname,'../frontend');
 for(const [options,mode]of [[{},'rules'],[{offlineKnowledge:true},'offline'],[{localKnowledge:true},'local']]){
  const server=http.createServer((req,res)=>{if(!serveStatic(req,res,root,options)){res.writeHead(404);res.end();}});const url=await listen(server);
  try{const page=await fetch(url+'/huiai').then(r=>r.text());assert.match(page,new RegExp('data-client="'+mode+'"'));assert.equal((page.match(/src="site-compat.js/g)||[]).length,1);assert.ok(!page.includes('/v2/offline/client.js'));assert.ok(!page.includes('/v2/local-knowledge/client.js'));assert.equal(await fetch(url+'/app.js').then(r=>r.text()),fs.readFileSync(path.join(root,'app.js'),'utf8'));}finally{await close(server);}
 }
});