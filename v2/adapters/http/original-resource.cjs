'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const mime={'.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
function createOriginalResource(knowledge){
 const documents=new Map((knowledge?.evidenceDocuments?.()||[]).map(({document})=>[document.sha256,document]));
 return async function serveOriginal(id,res){
  const d=documents.get(id);if(!/^[a-f0-9]{64}$/.test(id)||!d||!mime[path.extname(d.name).toLowerCase()]){res.writeHead(404);res.end('Original resource not registered');return;}
  try{const hash=crypto.createHash('sha256');for await(const part of fs.createReadStream(d.originalPath))hash.update(part);if(hash.digest('hex')!==id){res.writeHead(409);res.end('Original resource checksum mismatch');return;}
   res.writeHead(200,{'Content-Type':mime[path.extname(d.name).toLowerCase()],'Content-Length':fs.statSync(d.originalPath).size,'X-Content-Type-Options':'nosniff','X-Original-SHA256':id,'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(d.name)});fs.createReadStream(d.originalPath).pipe(res);
  }catch{if(!res.headersSent)res.writeHead(503);res.end('Original resource temporarily unavailable');}
 };
}
module.exports={createOriginalResource};
