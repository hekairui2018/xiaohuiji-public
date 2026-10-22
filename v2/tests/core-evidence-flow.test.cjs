'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {scene,compareScene}=require('../domain/knowledge/evidence-plan.cjs');
const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
const {rank,createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
const products=['HD-A6L','HD-C16L','HD-D16','HD-R712','HD-R716','HD-D15'].map(modelId=>({modelId,aliases:[modelId,modelId.slice(3)]}));
const lookup={products:()=>products,findProducts:id=>products.filter(p=>p.modelId===id)};
const api=options=>createQuickRetrieval({knowledge:lookup,search:async()=>({results:[]}),searchCases:async()=>({results:[]}),...options});
test('Modal questions preserve original architectural evidence and reject another model',()=>{
 for(const question of ['C16L必须配接收卡吗','C16L是否需要接收卡','C16L不配接收卡可以吗']){
  const q=parseQuickQuery(question,lookup),audit=[];
  const rows=[{type:'passage',name:'C16L规格书',text:'板载12个HUB75E接口，相当于自带一张接收卡。',modelIds:['HD-C16L']},{type:'passage',name:'A6L规格书',text:'板载接口',modelIds:['HD-A6L']}];
  const found=rank(q,[{source:'original',rows}],lookup,{},audit);
  assert.equal(found.length,1);assert.equal(found[0].candidate.name,'C16L规格书');assert(audit.some(r=>r.disposition==='excluded'));
 }
});
test('Media, task, trigger and offline restrictions survive paraphrase',()=>{
 const s=scene('D16不联网控制U盤影片');assert(s.media.includes('usb-disk'));assert(s.deniedMedia.includes('network'));assert(!s.deniedMedia.includes('usb-disk'));assert(s.tasks.includes('play'));assert(s.tasks.includes('control'));
 const request=scene('A6L插U盘视频不亮');
 const exact=compareScene(request,'A6L插U盘播放视频不亮'),other=compareScene(request,'A6L断电重启后视频黑屏');assert(exact.score>other.score);assert(other.conditional);
 assert(compareScene(s,'联网通过网络控制节目').conflicts.includes('denied-media:network'));
});
test('Exact-scene case ranks before same symptom with different trigger; contradiction is excluded',()=>{
 const q=parseQuickQuery('A6L插U盘视频不亮',lookup),rows=[{type:'case',name:'重启黑屏',modelIds:['HD-A6L'],phenomenon:'A6L断电重启后视频黑屏',text:'黑屏'},{type:'case',name:'U盘黑屏',modelIds:['HD-A6L'],phenomenon:'A6L插U盘播放视频不亮',text:'不亮'}];
 const found=rank(q,[{source:'cases',rows}],lookup);assert.equal(found[0].candidate.name,'U盘黑屏');assert(found[1].signals.scene.conditional);
});
test('321 registered videos are filtered by exact identity before Top K; late item survives and permissions apply',async()=>{
 const rows=Array.from({length:319},(_,i)=>({name:'R716操作'+i+'.mp4',locationId:i+1,sha256:'wrong'+i,folders:['操作视频']}));
 rows.push({name:'A6L播放设置.mp4',locationId:700,sha256:'a6',folders:['操作视频']},{name:'C16L升级操作.mp4',locationId:701,sha256:'c16',folders:['操作视频']});
 let localized=0,restricted=false;const service=api({localCatalog:async()=>rows,localizeMedia:async()=>{localized++;throw Error('must use registered index');},filterEvidence:async items=>items.filter(r=>!restricted||r.sourceLocationId!==701)});
 const result=await service.answer('分别找A6L的播放视频，C16L的升级视频');
 assert.equal(result.results.length,2);assert.equal(result.routeLog.subrequests.length,2);assert(result.results.some(r=>r.name==='C16L升级操作.mp4'));assert.equal(localized,0);
 restricted=true;const again=await service.answer('C16L操作视频');assert.equal(again.results.length,0);
});
test('Task and language relevance precede video display limit and hash deduplication',async()=>{
 const rows=Array.from({length:12},(_,i)=>({name:'A6L升级操作(英)'+i+'.mp4',locationId:i+1,sha256:'upgrade'+i,folders:['操作视频']}));
 rows.push({name:'A6L播放设置.mp4',locationId:90,sha256:'same',folders:['操作视频']},{name:'A6L播放设置副本.mp4',locationId:91,sha256:'same',folders:['操作视频']});
 const result=await api({localCatalog:async()=>rows}).answer('A6L播放操作视频');assert.equal(result.results[0].sha256,'same');assert.equal(result.results.filter(r=>r.sha256==='same').length,1);assert(result.results.length<=4);
});
test('Missing service/software identity asks the relevant question without unrelated source calls',async()=>{
 let calls=0;const service=api({search:async()=>{calls++;return {results:[]};}});
 const expired=await service.answer('显示服务已到期');assert.match(expired.reply,/软件、平台或服务/);assert.doesNotMatch(expired.reply,/接收卡|固件/);
 const box=await service.answer('盒子用什么软件');assert.match(box.reply,/完整型号/);assert.equal(calls,0);
});

test('A controller upgrade cannot borrow a receiver-card recipe',async()=>{
 const service=api({localCatalog:async()=>[{name:'接收卡固件升级说明.docx'}],searchContext:async()=>[{name:'接收卡固件升级说明.docx',blockId:1}],readContext:async()=>({text:'接收卡升级说明\n打开HDSet，点击固件升级，选择接收卡固件。',contextComplete:true})});
 const r=await service.answer('D15怎么升级');assert.doesNotMatch(r.reply,/打开HDSet|选择接收卡固件/);assert.equal(r.results.length,0);
});
test('A shared manual does not turn another model paragraph into a software recommendation',async()=>{
 const service=api({localCatalog:async()=>[{name:'A6L C16L使用手册.docx'}],searchContext:async()=>[{name:'A6L C16L使用手册.docx',blockId:1,sha256:'shared'}],readContext:async()=>({text:'电脑端软件：下载HDPlayer以及HDSet。\n用户通过屏掌控连接A6L的热点进行调试。',contextComplete:true})});
 const r=await service.answer('C16L用什么软件');assert.match(r.reply,/HDPlayer/);assert.doesNotMatch(r.reply,/连接A6L/);
});
test('UI expiry evidence purpose is independent of incomplete routing labels',async()=>{
 const r=await api().answer('服务已到期那儿解');assert.match(r.reply,/软件、平台或服务/);assert.doesNotMatch(r.reply,/接收卡|整屏/);
});

test('A controller noun is not a playback-control action; broad context does not lend unrelated steps',()=>{
 assert(!scene('4G控制卡怎样添加到云帐号').tasks.includes('control'));
 const {operationExcerpt}=require('../adapters/http/quick-answer.cjs');
 assert.equal(operationExcerpt('点击新建多屏节目，设置主屏和副屏。',{terms:['添加到云帐号']}),null);
 assert.equal(operationExcerpt('点击设备详情，选择节目删除。',{terms:['添加','设备']}),null);
 const excerpt=operationExcerpt('可通过无线连接网络。\n激活语音播放功能\n点击语音播放设置\n输入激活码',{terms:['Wi-Fi']});assert.match(excerpt.text,/无线连接网络/);assert.doesNotMatch(excerpt.text,/语音|激活/);
});
