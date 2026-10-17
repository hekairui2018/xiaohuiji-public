'use strict';
const {gzipSync}=require('node:zlib');
// Cache final representations, not originals. Download endpoints still check originals.
function createCatalogResponseCache({ttl=30000,maxEntries=24,now=Date.now}={}){
 const entries=new Map();
 return async function respond(req,res,key,load){
  let entry=entries.get(key);
  if(!entry||now()-entry.time>=ttl){
   if(entry)entries.delete(key);
   entry={time:now()};
   entry.result=Promise.resolve().then(load).then(body=>{
    const plain=Buffer.from(JSON.stringify(body));
    return {plain,gzip:gzipSync(plain)};
   });
   entries.set(key,entry);
   if(entries.size>maxEntries)entries.delete(entries.keys().next().value);
  }
  let data;try{data=await entry.result;}catch(error){if(entries.get(key)===entry)entries.delete(key);throw error;}
  const compressed=String(req.headers['accept-encoding']||'').split(',').some(part=>{
   const [encoding,...params]=part.trim().split(';');
   const quality=params.find(p=>/^\s*q\s*=/i.test(p));
   return encoding.toLowerCase()==='gzip'&&(!quality||Number(quality.split('=')[1])>0);
  });
  const payload=compressed?data.gzip:data.plain;
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Accept-Encoding',...(compressed?{'Content-Encoding':'gzip'}:{}),'Content-Length':payload.length});
  res.end(payload);
 };
}
module.exports={createCatalogResponseCache};
