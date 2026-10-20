const test=require('node:test'),assert=require('node:assert/strict');const {organize,classify}=require('../frontend/video-groups.js');
test('Video browsing uses explicit software titles while preserving LCD domain and uncertainty',()=>{
 assert.deepEqual(classify({name:'HDPlayer节目编辑.mp4'},{key:'source-led',label:'LED'}),['software','HDPlayer']);
 assert.equal(classify({name:'LCD云平台发布教程.mp4'},{key:'lcd'})[0],'lcd');
 assert.equal(classify({name:'屏掌控Wi-Fi排查.mp4'})[0],'app');
 assert.equal(classify({name:'小灰云操作（印尼语）.mp4'})[0],'cloud');
 assert.equal(classify({name:'华硕主板 H510M-K 开启核显的教程.mp4'},{key:'player'})[0],'support');
 assert.equal(classify({name:'HD-A6L投屏.mp4'},{key:'accessory'})[0],'player');
 assert.equal(classify({name:'HDSet操作.mp4'})[0],'display');
 assert.equal(classify({name:'复位.mp4'})[0],'other');
 assert.equal(classify({name:'LCD主板固件升级.mp4'},{key:'lcd'})[1],'固件升级与烧录');
});
test('Regrouping preserves every original record and URL including languages, versions and same names',()=>{
 const items=[{name:'HDPlayer操作-英.mp4',url:'/one',version:'1'},{name:'HDPlayer操作.mp4',url:'/two'},{name:'HDPlayer操作.mp4',url:'/three'},{name:'设置.mp4',url:'/four'}];
 const input=[{key:'source-led',label:'LED',videos:items}],before=JSON.stringify(input),out=organize(input);
 assert.equal(JSON.stringify(input),before);assert.equal(out.reduce((n,g)=>n+g.count,0),4);assert.deepEqual(new Set(out.flatMap(g=>g.videos)),new Set(items));assert.deepEqual(out.flatMap(g=>g.sections.flatMap(s=>s.videos)).sort((a,b)=>a.url.localeCompare(b.url)),[...items].sort((a,b)=>a.url.localeCompare(b.url)));
});

test('Software card videos contain only the matching introductory walkthroughs',()=>{
 const {softwareVideos}=require('../frontend/video-groups.js');
 const names=['不对称多开接线和设置.mp4','HDset操作.mp4','HDPlayer操作.mp4','HDPlayer动态数据功能.mp4','HDPlayer操作视频（720P）.mp4','HDShow操作演示.mp4','屏掌控单色版简易操作.mp4','HD2020操作.mp4'];
 const videos={primary:{name:names[0]},more:names.slice(1).map(name=>({name}))};
 assert.deepEqual(softwareVideos({id:'HDSet',videos}).map(v=>v.name),['HDset操作.mp4']);
 assert.deepEqual(softwareVideos({id:'HDPlayer',videos}).map(v=>v.name),['HDPlayer操作.mp4','HDPlayer操作视频（720P）.mp4']);
 assert.deepEqual(softwareVideos({id:'HDSign',videos}),[]);
 assert.deepEqual(softwareVideos({id:'PingZhangKong',videos}).map(v=>v.name),['屏掌控单色版简易操作.mp4']);
 assert.deepEqual(softwareVideos({id:'HD2018',videos:{}}),[]);
});

test('Computer environment videos stay separate regardless of inherited product folders',()=>{
 for(const key of ['lcd','player','processor','software-cloud'])assert.deepEqual(classify({name:'华硕主板 H510M-K 开启核显的教程.mp4'},{key}),['support','电脑主板与显示环境']);
 assert.equal(classify({name:'VPX系列操作视频.mp4'})[0],'processor');
 assert.equal(classify({name:'B8H操作视频.mp4'})[0],'player');
 assert.equal(classify({name:'the update of M20.mp4'})[0],'lcd');
 assert.equal(classify({name:'连接设置操作视频.mp4'})[0],'other');
 assert.equal(classify({name:'UI更新操作--安卓版.mp4'})[0],'other');
 const {topic}=require('../frontend/video-groups.js');
 assert.equal(topic('11.15 update program by Udisk of M20.mp4'),'节目制作与发布');
 assert.equal(topic('LCD主板如何升级屏参.mp4'),'屏参与显示配置');
 assert.equal(topic('RK系列LCD主板线刷教程.mp4'),'固件升级与烧录');
 assert.equal(topic('VPX20开两画面操作视频.mp4'),'开窗与多画面');
 assert.equal(topic('VP8000M调试英文.mp4'),'基础操作与调试');
 assert.equal(topic('LCD云平台设备绑定操作说明.mp4'),'云平台与远程管理');
});
