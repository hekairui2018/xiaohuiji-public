'use strict';
// Loopback-only bridge to the approved section index, never the legacy G: scan.
function createSectionSearch({resourceBase,internalToken}){
 async function search(query,{signal}={}){
  const response=await fetch(resourceBase+'/internal/fulltext?q='+encodeURIComponent(query),{headers:{'X-Internal-Token':internalToken,'X-Internal-Purpose':'fulltext'},signal:signal||AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('section-search-unavailable');return response.json();
 }
 // File-type requests are answered from registry columns, never from body passages.
 async function registry(query,{limit=10,signal}={}){
  const url=resourceBase+'/internal/file-registry?q='+encodeURIComponent(query)+'&limit='+Number(limit);
  const response=await fetch(url,{headers:{'X-Internal-Token':internalToken,'X-Internal-Purpose':'fulltext'},signal:signal||AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('file-registry-unavailable');return response.json();
 }
 async function softwareSections(query,{software=[],signal}={}){
  const params=new URLSearchParams({q:query,software:JSON.stringify(software)});
  const response=await fetch(resourceBase+'/internal/quick-sections?'+params,{headers:{'X-Internal-Token':internalToken,'X-Internal-Purpose':'quick-knowledge'},signal:signal||AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('software-sections-unavailable');return response.json();
 }
 async function knowledge(query,{kind,models=[],focus=[],software=[],unknown=[],signal}={}){
  const params=new URLSearchParams({q:query,kind,models:JSON.stringify(models),focus:JSON.stringify(focus),software:JSON.stringify(software),unknown:JSON.stringify(unknown)});
  const response=await fetch(resourceBase+'/internal/quick-knowledge?'+params,{headers:{'X-Internal-Token':internalToken,'X-Internal-Purpose':'quick-knowledge'},signal:signal||AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('quick-knowledge-unavailable');return response.json();
 }
 async function serve(req,res,id){
  if(!/^config-[a-f0-9]{64}$/.test(id)){res.writeHead(404);res.end();return;}
  const r=await fetch(resourceBase+'/internal/fulltext-file?id='+encodeURIComponent(id),{headers:{'X-Internal-Token':internalToken,'X-Internal-Purpose':'fulltext'},signal:AbortSignal.timeout(15000)});
  const headers={};for(const key of ['content-type','content-length','content-disposition','x-content-type-options'])if(r.headers.has(key))headers[key]=r.headers.get(key);
  res.writeHead(r.status,headers);if(r.body){const {Readable}=require('node:stream');Readable.fromWeb(r.body).pipe(res);}else res.end();
 }
 return {search,registry,knowledge,softwareSections,serve};
}
module.exports={createSectionSearch};
