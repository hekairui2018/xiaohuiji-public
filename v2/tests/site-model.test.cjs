'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../adapters/http/server.cjs');
const {createApp}=require('../app/bootstrap.cjs');
const {createLocalQwen}=require('../model-adapter/local-qwen.cjs');
const {createDialogueService}=require('../adapters/http/dialogue-service.cjs');
const originalVideos=require('../../data/video-manifest.json').items.filter(v=>v.status==='uploaded'&&v.publicUrl);
test('Same-site quick and huiai pages and real resources work without a model or dialogue interception',async()=>{
 let calls=0;const fail=()=>{calls++;throw Error('Quick must not call dialogue');};const server=createServer(createApp({handlers:{ordering:fail,aftersales:fail,consultation:fail}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{for(const route of ['/wiki','/huiai','/app.js']){const r=await fetch(base+route);assert.equal(r.status,200);assert.ok((await r.text()).length>100);}
  const search=await fetch(base+'/api/search?q=R712').then(r=>r.json());assert.equal(search.results[0].name,'HD-R712');assert.ok(search.results[0].docGroups.some(g=>g.key==='firmware'));
  assert.ok(search.results[0].specGroups.some(g=>g.key==='spec'&&g.items.length));assert.ok(search.results[0].firmwareGroup.items.every(f=>f.url));
  for(const cat of ['spec','manual','firmware']){const d=await fetch(base+'/api/docs?cat='+cat).then(r=>r.json());assert.ok(d.docs.total>0);}
  const sw=await fetch(base+'/api/software?q=HDSet').then(r=>r.json());assert.ok(sw.software.items[0].downloadUrl);assert.ok(sw.software.items[0].manuals.length);
  const videos=await fetch(base+'/api/videos').then(r=>r.json());assert.equal(videos.video.total,originalVideos.length);assert.deepEqual(videos.video.groups.flatMap(g=>g.videos.map(v=>v.url)),originalVideos.map(v=>v.publicUrl));assert.equal(calls,0);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('Existing web and WeCom message envelope receives readable dialogue output independently of quick',async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{const post=body=>fetch(base+'/api/ai/chat',{method:'POST',body:JSON.stringify(body)}).then(r=>r.json());
  const result=await post({message:'CT800参数',source:'wecom',history:[]});assert.equal(result.status,'answer');assert.equal(result.model,'v2-rules');assert.ok(result.reply.includes('CT800'));assert.equal(result.result.operation,'consultation');
  const fault=await post({message:'R712黑屏',source:'web'});assert.equal(fault.status,'clarify');assert.ok(fault.clarifyQuestion);assert.equal(fault.result.operation,'aftersales');
  const json=await post({message:JSON.stringify({schemaVersion:'2.0',operation:'ordering'})});assert.equal(json.result.operation,'ordering');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('Reserved local Qwen adapter cannot return decisions or send internal inputs to external hosts',async()=>{
 assert.equal(createLocalQwen().enabled,false);assert.throws(()=>createLocalQwen({baseUrl:'https://example.com'}),/loopback/);
 const mock=data=>async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(data)}}]})});
 const config={baseUrl:'http://127.0.0.1:1234'};
 const safe={intent:'ordering',model_mentions:['R712'],missing_parameters:['模组规格']};assert.equal((await createLocalQwen({...config,transport:mock(safe)}).understand('R712配单')).status,'understood');
 assert.equal((await createLocalQwen({...config,transport:mock({...safe,selectedController:'VP620A'})}).understand('R712配单')).status,'invalid_model_output');
 assert.equal((await createLocalQwen({...config,transport:mock({...safe,model_mentions:['R716']})}).understand('R712配单')).status,'invalid_model_output');
});
test('No-AI website diagnosis progresses over multiple turns without contaminating another session',async()=>{
 const chat=createDialogueService(createApp()),sessionId='diagnosis-a';
 let r=await chat({message:'加载软件内置的参数后，调式完客户有拍照有水波纹',sessionId});assert.equal(r.result.diagnosis.state,'confirm-scope');
 r=await chat({message:'条件一致',sessionId});assert.equal(r.result.diagnosis.state,'execute-checks');
 const unrelated=await chat({message:'条件一致',sessionId:'diagnosis-b'});assert.ok(!unrelated.result.diagnosis);
 r=await chat({message:'已完成排查',sessionId});assert.equal(r.result.diagnosis.state,'verify-phenomenon');
 r=await chat({message:'现象消失',sessionId});assert.equal(r.result.diagnosis.state,'user-reported-resolution');assert.equal(r.result.diagnosis.conclusion.kind,'customer-observation');
});
