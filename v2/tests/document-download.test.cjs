'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
const {createServer}=require('../adapters/http/server.cjs');
const listen=async s=>{await new Promise(r=>s.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.address().port;};
const close=s=>new Promise(r=>{s.closeAllConnections();s.close(r);});
test('Preview and explicit download deliver the same original, filename and ranges',async()=>{
 const upstream=http.createServer((req,res)=>{assert.equal(req.url,'/resource?id=7');res.writeHead(req.headers.range?206:200,{'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''X9.pdf",...(req.headers.range?{'Content-Range':'bytes 0-3/4'}:{})});res.end('%PDF');});
 const source=await listen(upstream),offline=createOfflineKnowledge({resourceBase:source}),server=createServer(undefined,{offlineKnowledge:offline}),base=await listen(server);
 try{
  const preview=await fetch(base+'/v2/offline/file?id=7'),download=await fetch(base+'/v2/offline/file?id=7&download=1',{headers:{Range:'bytes=0-3'}});
  assert.match(preview.headers.get('content-disposition'),/^inline;/);assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.match(download.headers.get('content-disposition'),/X9.pdf/);
  assert.equal(download.status,206);assert.equal(download.headers.get('content-range'),'bytes 0-3/4');assert.equal(await preview.text(),await download.text());
  assert.equal((await fetch(base+'/v2/offline/file?id=../file&download=1')).status,400);
 }finally{await close(server);await close(upstream);}
});
test('Large closing responses survive slow readers and repeated downloads',async()=>{
 const body=Buffer.alloc(8*1024*1024,65),upstream=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':body.length,Connection:'close'});res.end(body);});
 const source=await listen(upstream),server=createServer(undefined,{offlineKnowledge:createOfflineKnowledge({resourceBase:source})}),base=await listen(server);
 try{for(let i=0;i<3;i++)await new Promise((resolve,reject)=>http.get(base+'/v2/offline/file?id=7&download=1',res=>{let size=0;res.pause();setTimeout(()=>res.resume(),30);res.on('data',b=>size+=b.length);res.on('error',reject);res.on('end',()=>{try{assert.equal(size,body.length);resolve();}catch(e){reject(e);}});}).on('error',reject));}
 finally{await close(server);await close(upstream);}
});
