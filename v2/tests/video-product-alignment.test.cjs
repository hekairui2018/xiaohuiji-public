'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {groupVideos,classifyResource}=require('../domain/knowledge/resource-categories.cjs');
const {browseGroup}=require('../domain/knowledge/source-classification.cjs');
test('Video categories use existing product labels/order and every category has operation topics',()=>{
 const names=['VP8000M调试.mp4','HDSet操作.mp4','LCD主板复位.mp4','C16L复位.mp4','B6基础操作.mp4','A6L投屏.mp4','R712固件升级.mp4','VPX20固件升级.mp4'];
 const result=groupVideos(names.map((name,i)=>({name,url:'/file?id='+i})));
 assert.deepEqual(result.map(g=>g.key),['receiver','player',browseGroup('B系列-广告机专用').key,'cd-control','processor',browseGroup('矩阵、音频处理器、分配器、切换器、延长器等信号传输设备').key,'lcd','software-cloud']);
 assert.equal(result[1].label,'全彩播放盒（A、H系列）');assert.equal(result[4].label,'VP系列-处理器');
 for(const g of result){assert.equal(g.sections.reduce((n,s)=>n+s.videos.length,0),g.count);assert.ok(g.sections.every(s=>s.label&&s.videos.length));}
});
test('Language and generic LED folders do not become product categories',()=>{
 for(const folder of ['LED','产品操作视频','印尼语操作视频']){
  const result=groupVideos([{name:'连接设置.mp4',url:'/file?id=1'}],[{name:'连接设置.mp4',locationId:1,folders:['操作视频',folder]}]);
  assert.equal(result[0].key,'other');assert.equal(result[0].sections[0].label,'待分类');
 }
 assert.equal(classifyResource({name:'华硕主板 H510M-K 开启核显的教程.mp4',folders:['多媒体服务器']}).categoryKey,'other');
});
test('Registered identity selects the corresponding source while duplicates retain original URLs and names',()=>{
 const name='操作.mp4',resources=[{name,sha256:'a'.repeat(64),locationId:1,folders:['操作视频','K系列-接收卡']},{name,sha256:'b'.repeat(64),locationId:2,folders:['操作视频','VP系列-处理器']}];
 const records=groupVideos([{name,url:'/file?id=1'},{name,url:'/file?id=2'}],resources);
 assert.deepEqual(records.map(g=>g.key),['receiver','processor']);assert.equal(records.flatMap(g=>g.videos).length,2);
 const same=groupVideos([{name:'原名.mp4',sha256:'a'.repeat(64),url:'/one'},{name:'副本.mp4',sha256:'a'.repeat(64),url:'/two'}]);
 assert.equal(same.flatMap(g=>g.videos).length,1);assert.deepEqual(same[0].videos[0].alternativeUrls,['/one','/two']);
});
test('Other keeps explicit history and signing reasons without inventing a product',()=>{
 const items=['历史操作.mp4','签章操作.mp4','设置.mp4'].map((name,i)=>({name,url:'/file?id='+i})),resources=items.map((v,i)=>({...v,locationId:i,folders:[['历史老视频','签章','视频'][i]]}));
 const other=groupVideos(items,resources)[0];assert.equal(other.key,'other');assert.deepEqual(other.sections.map(s=>s.label),['历史视频','签章相关','待分类']);
});

test('Operation topics distinguish startup images from actual multi-window operations',()=>{
 const {videoTopic}=require('../domain/knowledge/video-topics.cjs');
 assert.equal(videoTopic('HDPlayer开机画面设置.mp4'),'调试与显示设置');
 assert.equal(videoTopic('VPX20开两画面操作.mp4'),'拼接、同步与多画面');
 assert.equal(videoTopic('update program by Udisk.mp4'),'节目制作与发布');
 assert.equal(videoTopic('VPX20固件升级.mp4'),'固件升级与烧录');
});
