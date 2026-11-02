'use strict';
// Loopback-only bridge to the approved section index, never the legacy G: scan.
function createSectionSearch({resourceBase,internalToken}){
 async function search(query,{signal}={}){
  const response=await fetch(resourceBase+'/internal/fulltext?q='+encodeURIComponent(query),{headers:{'X-Internal-Token':internalToken,'X-Internal-Purpose':'fulltext'},signal:signal||AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('section-search-unavailable');return response.json();
 }
 async function serve(req,res,id){
  if(!/^config-[a-f0-9]{64}$/.test(id)){res.writeHead(404);res.end();return;}
  const r=await fetch(resourceBase+'/internal/fulltext-file?id='+encodeURIComponent(id),{headers:{'X-Internal-Token':internalToken,'X-Internal-Purpose':'fulltext'},signal:AbortSignal.timeout(15000)});
  const headers={};for(const key of ['content-type','content-length','content-disposition','x-content-type-options'])if(r.headers.has(key))headers[key]=r.headers.get(key);
  res.writeHead(r.status,headers);if(r.body){const {Readable}=require('node:stream');Readable.fromWeb(r.body).pipe(res);}else res.end();
 }
 return {search,serve};
}
module.exports={createSectionSearch};
