'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withResourceLocations}=require('./reference-overlay.cjs');
const path=require('node:path');
test('candidate location overlay leaves the original knowledge and paths unchanged',()=>{
 const sha='a'.repeat(64),root=path.resolve('tmp/resource-test-root'),newPath=path.join(root,'original.docx'),original={document:{sha256:sha,originalPath:'old.docx'}};
 const knowledge=Object.freeze({version:'unchanged',evidenceDocuments:()=>structuredClone([original])});
 const next=withResourceLocations(knowledge,{schemaVersion:'resource-location-overlay-1',roots:[root],bySha256:{[sha]:[newPath]}});
 assert.equal(next.version,knowledge.version);assert.equal(next.evidenceDocuments()[0].document.originalPath,newPath);assert.equal(knowledge.evidenceDocuments()[0].document.originalPath,'old.docx');
});
test('candidate overlay rejects traversal and malformed hashes',()=>{
 const k={evidenceDocuments:()=>[]},root=path.resolve('tmp/resource-test-root');
 assert.throws(()=>withResourceLocations(k,{schemaVersion:'resource-location-overlay-1',roots:[root],bySha256:{['a'.repeat(64)]:[path.resolve(root,'../outside')]}}),/Unsafe/);
 assert.throws(()=>withResourceLocations(k,{schemaVersion:'resource-location-overlay-1',roots:[root],bySha256:{bad:[path.join(root,'file')]}}),/Unsafe/);
});
test('existing original-resource adapter serves a relocated candidate and rejects changed bytes',async()=>{
 const fs=require('node:fs'),crypto=require('node:crypto'),http=require('node:http');
 const {createOriginalResource}=require('../adapters/http/original-resource.cjs');
 const root=fs.mkdtempSync(path.resolve('tmp/resource-overlay-')),file=path.join(root,'original.docx'),bytes=Buffer.from('exact original test bytes'),sha=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(file,bytes);
 const k={evidenceDocuments:()=>[{document:{name:'original.docx',sha256:sha,originalPath:path.join(root,'old-missing.docx')}}]};
 const serve=createOriginalResource(withResourceLocations(k,{schemaVersion:'resource-location-overlay-1',roots:[root],bySha256:{[sha]:[file]}}));
 const server=http.createServer((req,res)=>serve(sha,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 try{let r=await fetch(url);assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);fs.writeFileSync(file,'changed');r=await fetch(url);assert.equal(r.status,409);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
