'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {classifyResource,groupVideos}=require('../domain/knowledge/resource-categories.cjs');
test('Video categories follow product/source evidence rather than shared operation words',()=>{
 assert.equal(classifyResource({name:'LCD主板开启Wi-Fi热点.mp4'}).categoryKey,'lcd');
 assert.equal(classifyResource({name:'设置固定IP.mp4',folders:['LCD资料','操作视频和文档']}).categoryKey,'lcd');
 assert.equal(classifyResource({name:'LCD云平台发布教程.mp4',folders:['LCD资料']}).categoryKey,'lcd'); // Registered folder beats title-only platform hints.
 assert.equal(classifyResource({name:'LCD云平台发布教程.mp4'}).categoryKey,'lcd');
 assert.equal(classifyResource({name:'R712复位.mp4'}).categoryKey,'receiver');
 assert.equal(classifyResource({name:'VP620A联网.mp4'}).categoryKey,'processor');
 assert.equal(classifyResource({name:'复位.mp4'}).categoryKey,'other');
 assert.equal(classifyResource({name:'LED基础知识.mp4'}).categoryKey,'other'); // Generic LED/training words do not establish a product.
});
test('Shared original appears once; different files, versions and language stay independent',()=>{
 const groups=groupVideos([{name:'R712复位.mp4',url:'/file?id=1'},{name:'R712复位副本.mp4',url:'/file?id=1'},{name:'R712复位-英文.mp4',url:'/file?id=2'},{name:'R712复位V2.mp4',url:'/file?id=3'}]);
 assert.equal(groups.length,1);assert.equal(groups[0].count,3);assert.ok(groups[0].videos.some(v=>v.language==='en'));assert.ok(groups[0].videos.some(v=>v.language==='unknown'));assert.equal(groups[0].videos.find(v=>v.url==='/file?id=1').alternativeNames.length,1);
});
test('Directory-only response skips binary verification and never exposes original folders',async()=>{
 const calls=[];const server=http.createServer((req,res)=>{calls.push(req.url);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({resources:[{name:'设置热点.mp4',locationId:1,sizeBytes:100,sourceDrive:'G:',availabilityState:'present',folders:['LCD资料','操作视频']},{name:'外盘操作.mp4',locationId:2,sourceDrive:'F:',availabilityState:'present',folders:['操作视频']},{name:'缺失操作.mp4',locationId:3,sourceDrive:'G:',availabilityState:'missing',folders:['操作视频']}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const {createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');const k=createOfflineKnowledge({resourceBase:'http://127.0.0.1:'+server.address().port});const out=await k.localizeMedia({video:{total:0,groups:[],topicGroups:[]}},{metadataOnly:true});assert.deepEqual(calls,['/catalog']);assert.equal(out.groups[0].key,'lcd');assert.equal(out.total,1);assert.equal(out.groups.length,1);assert.ok(!JSON.stringify(out).includes('locationId'));assert.ok(!JSON.stringify(out).includes('folders'));assert.equal(out.metadataOnly,true);}finally{await new Promise(r=>server.close(r));}
});
