'use strict';
const http=require('node:http');
const {StringDecoder}=require('node:string_decoder');
// Local development inference can exceed fetch/undici's default header deadline.
// Cancellation remains active throughout headers and body; there is no implicit timer.
function localModelTransport(url,options={}){
 return new Promise((resolve,reject)=>{
  const req=http.request(url,{method:options.method||'GET',headers:options.headers,signal:options.signal},res=>{
   const chunks=[],decoder=new StringDecoder('utf8'),stream=/text\/event-stream/.test(res.headers['content-type']||'')?require('./model-stream.cjs').modelStream(options.onContentDelta):null;let bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024){req.destroy(Error('expert-model-response-too-large'));return;}try{if(stream)stream.push(decoder.write(chunk));else chunks.push(chunk);}catch(error){req.destroy(error);reject(error);}});
   res.on('error',reject);res.on('end',()=>{try{if(stream)stream.push(decoder.end());const body=stream?stream.finish():JSON.parse(Buffer.concat(chunks).toString('utf8'));resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,json:async()=>body});}catch(error){reject(error);}});
  });
  req.on('error',reject);if(options.body!==undefined)req.write(options.body);req.end();
 });
}
module.exports={localModelTransport};
