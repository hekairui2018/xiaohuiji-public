'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
test('local video browse and outline exclude cloud-only, other-drive and missing originals',async()=>{
 const names=['G操作.mp4','其他操作.mp4','缺失操作.mp4','云端操作.mp4'];
 const resources=names.slice(0,3).map((name,i)=>({name,locationId:i+1,sourceDrive:i===1?'F:':'G:',availabilityState:i===2?'missing':'present',folders:['操作视频','LED']}));
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/catalog')return res.end(JSON.stringify({resources}));
  let raw='';for await(const c of req)raw+=c;
  const {items}=JSON.parse(raw);res.end(JSON.stringify({results:items.map(()=>({available:true,locationId:1,sizeBytes:10}))}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const api=createOfflineKnowledge({knowledge:{products:()=>[],cases:()=>[],evidenceDocuments:()=>[]},resourceBase:'http://127.0.0.1:'+server.address().port});
 const input={video:{groups:[{videos:names.map(name=>({name,url:'https://example.com/video.mp4'}))}],total:4}};
 try{
  const full=await api.localizeMedia(input),rows=full.video.groups.flatMap(g=>g.videos);
  assert.deepEqual(rows.map(v=>v.name),[names[0]]);assert.equal(rows[0].sourceMode,'local');assert.equal(full.video.total,1);
  const outline=await api.localizeMedia(input,{metadataOnly:true});assert.equal(outline.total,1);
  assert.equal(input.video.groups[0].videos.length,4);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
