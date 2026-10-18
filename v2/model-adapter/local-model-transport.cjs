'use strict';
const http=require('node:http');
// Local development inference can exceed fetch/undici's default header deadline.
// Cancellation remains active throughout headers and body; there is no implicit timer.
function localModelTransport(url,options={}){
 return new Promise((resolve,reject)=>{
  const req=http.request(url,{method:options.method||'GET',headers:options.headers,signal:options.signal},res=>{
   const chunks=[];let bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024){req.destroy(Error('expert-model-response-too-large'));return;}chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>{const raw=Buffer.concat(chunks).toString('utf8');resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,json:async()=>JSON.parse(raw)});});
  });
  req.on('error',reject);if(options.body!==undefined)req.write(options.body);req.end();
 });
}
module.exports={localModelTransport};
