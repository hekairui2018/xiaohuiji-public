'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
const name='HDPlayer用户手册.docx',boundary='explicit-heading-continuous-section;visual-steps-unverified';
const app={quickResources:()=>({}),quickBrowse:()=>[],quickSearch:()=>({records:[]}),resourceMedia:{softwareItems:q=>/HDPlayer/i.test(q)?[{name:'HDPlayer'}]:[]}};
const knowledge={products:()=>[],findProducts:()=>[]};
function fixture(texts,{complete=true,legacy=false}={}){
 const requests=[],contexts=new Map(),rows=texts.map((text,i)=>{
  const id=String(i+1).repeat(64),lines=text.split('\n');
  const sourceSpans=lines.map((line,j)=>({blockId:i*100+j,start:0,end:line.length,locator:{paragraph:i*100+j+1},role:'body'}));
  const unit={id,kind:'operation',sourceSpans,boundaryBasis:boundary,complete:false,bodyParsed:true};
  const row={name,sha256:'d'.repeat(64),blockId:i*100,locator:sourceSpans[0].locator,text,...(legacy?{}:{unitId:id,knowledgeUnit:unit})};
  contexts.set(row.blockId,{text,contextBoundary:boundary,contextComplete:complete,...(legacy?{}:{knowledgeUnit:unit})});return row;
 });
 const api=createQuickRetrieval({app,knowledge,search:async()=>({results:[]}),searchCases:async()=>({results:[]}),localCatalog:async()=>[{name}],searchContext:async args=>{requests.push(args);return rows;},readContext:async r=>contexts.get(r.blockId)});
 return {api,requests};
}
const update='2.U盘更新节目\n电脑插入U盘后，点击【控制】->【导出U盘】，选择“节目更新”。\n将U盘插入控制卡，将节目拷贝到板载内存。\n拷贝完成后即可拔出U盘，显示屏播放新节目。\n升级过程中不可断电。\n图5-3 U盘更新节目';
const direct='3.U盘无限扩容节目\n导出U盘时选择“直接播放”，插入后播放U盘内容。\n图5-4 U盘直接播放';
test('A transport plus task retrieves the full contiguous task, including following steps and cautions',async()=>{
 const {api,requests}=fixture([direct,update]);const r=await api.answer('HDPlayer怎么用U盘更新节目');
 assert.deepEqual(requests[0].concepts,['节目更新','U盘']);assert.match(requests[0].query,/更新节目/);
 assert.equal(r.results.length,1);assert.equal(r.results[0].text,update);assert.match(r.reply,/拷贝完成后即可拔出U盘/);assert.match(r.reply,/不可断电/);assert.doesNotMatch(r.reply,/直接播放/);assert.equal(r.results[0].evidenceId,r.results[0].unitId);
});
test('Long task names survive generic evidence terms and reject unrelated clickable network content',async()=>{
 const schedule='6.定时开关机设置\n设置定时开关机可在指定时间黑屏或播放节目，只断开视频信号，电源正常通电。\n图7-9 定时开关机设置';
 const {api,requests}=fixture(['2.网络设置\n点击控制，进入网络设置，选择IP地址。',schedule]);const r=await api.answer('HDPlayer怎么设置定时开关机');
 assert.deepEqual(requests[0].concepts,['定时开关机']);assert.equal(r.results[0].text,schedule);assert.doesNotMatch(r.reply,/IP地址|网络设置/);assert.match(r.reply,/具体界面在原文插图中/);assert.match(r.reply,/电源正常通电/);
});
test('A parent chapter quotes the matching subsection with its real source locator',async()=>{
 const chapter='第五章 节目更新\n1.集群发送\n点击发送。\n'+update+'\n'+direct;
 const {api}=fixture([chapter]);const r=await api.answer('HDPlayer怎么用U盘更新节目');
 assert.equal(r.results[0].text,update);assert.equal(r.results[0].locator.paragraph,4);assert.equal(r.results[0].excerptSourceSpans[0].locator.paragraph,4);assert.doesNotMatch(r.reply,/集群发送|无限扩容/);
});
test('Synonyms preserve the task, while figure-only content never becomes invented UI steps',async()=>{
 const {api,requests}=fixture(['6.定时开关机设置\n设置定时开关机可按时黑屏。\n图7-9 定时开关机设置']);const r=await api.answer('HDPlayer开关机时间怎么设置');
 assert.deepEqual(requests[0].concepts,['定时开关机']);assert.match(r.reply,/当前文字未包含完整点击步骤/);assert.doesNotMatch(r.reply,/点击.*确定/);
});
test('Sibling configuration sections are excluded even when a software and a media name match',async()=>{
 const {api}=fixture(['3.Wi-Fi设置\n点击设置可配置Wi-Fi密码。\n图3-1 Wi-Fi设置','2.网络连接\n打开HDPlayer，选择网线连接。']);const r=await api.answer('HDPlayer怎么设置定时开关机');
 assert.equal(r.results.length,0);assert.equal(r.answerType,'insufficient-evidence');
});
test('Legacy context continues to answer program-send requests without assuming a transport',async()=>{
 const {api}=fixture(['第五章 节目更新\n1.集群发送\n选择设备后点击发送。\n2.U盘更新节目\n点击导出U盘。'],{legacy:true});const r=await api.answer('HDPlayer如何发送节目');
 assert.match(r.reply,/选择设备后点击发送/);assert.match(r.reply,/你使用网线/);
});
test('A role read that ends mid-unit does not get marked as a complete operation section',async()=>{
 const {api}=fixture([update],{complete:false});const r=await api.answer('HDPlayer怎么用U盘更新节目');
 assert.ok(r.results.every(row=>!row.operationSectionMatch));
});
test('A software selection retains its established model association validation',async()=>{
 const constrained={...knowledge,findProducts:id=>id==='HD-R712'?[{modelId:id}]:[]};
 const api=createQuickRetrieval({app,knowledge:constrained,search:async()=>({results:[]}),searchCases:async()=>({results:[]}),localCatalog:async()=>[{name:'R712说明书.pdf'}],searchContext:async()=>[{name:'R712说明书.pdf'}],readContext:async()=>({text:'HD-R712接收卡配套调试软件为HDSet，配置屏参。'})});
 const r=await api.answer('R712用什么软件调试');assert.match(r.reply,/HDSet/);
});
