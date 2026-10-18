'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
const {createQuickRetrieval,rank}=require('../adapters/http/quick-retrieval.cjs');
const lookup={findProducts:id=>['HD-A3','HD-A3L','HD-C16L','HD-R512','HD-R512S'].includes(id)?[{modelId:id}]:[]};
const knowledge={findProducts:lookup.findProducts,products:()=>[],cases:()=>[]};
test('Query parsing preserves original identities, negative routing and genuine prior user context',()=>{
 const q=parseQuickQuery('不要故障排查，我只要C16L规格书',lookup);assert.equal(q.original,'不要故障排查，我只要C16L规格书');assert.deepEqual(q.categories,['spec']);assert.equal(q.deniedFault,true);assert.deepEqual(q.models,['HD-C16L']);
 assert.deepEqual(parseQuickQuery('R512和R512S固件通用吗',lookup).models,['HD-R512','HD-R512S']);
 const follow=parseQuickQuery('还是这样',lookup,{messages:[{role:'user',content:'C16L局部颜色异常并闪烁'},{role:'assistant',content:'另一型号A3'},{role:'user',content:'还是这样'}]});assert.equal(follow.contextUsed,true);assert.deepEqual(follow.models,['HD-C16L']);assert.ok(follow.symptoms.includes('flicker'));
});
test('Exact model and suffix constraints precede scoring; title identity cannot be borrowed from body',()=>{
 const q=parseQuickQuery('A3L带载',lookup),rows=[{type:'passage',name:'A3规格书',text:'A3L对比，带载999像素'},{type:'passage',name:'A3L规格书',text:'带载655360像素'}];
 assert.deepEqual(rank(q,[{source:'text',rows}],lookup).map(r=>r.candidate.name),['A3L规格书']);
 const r=parseQuickQuery('R512固件',lookup);assert.equal(rank(r,[{source:'catalog',rows:[{type:'document',name:'R512S固件',category:'firmware',modelIds:['HD-R512S'],download:'/x'}]}],lookup).length,0);
});
test('Social messages make no source calls and non-social queries recall cases and text independently',async()=>{
 const calls=[];const api=createQuickRetrieval({knowledge,search:async()=>{calls.push('text');return {results:[{name:'C16L技术文档',text:'颜色异常且闪烁',download:'/text'}]};},searchCases:()=>{calls.push('cases');return {results:[]};}});
 assert.equal((await api.answer('你好')).results.length,0);assert.deepEqual(calls,[]);
 const r=await api.answer('C16L颜色异常并闪烁');assert.ok(calls.includes('cases')&&calls.includes('text'));assert.equal(r.results[0].name,'C16L技术文档');assert.equal(r.modelCallCount,0);
});
test('Multi-phenomenon relevance and discovery direction reject a shared word and the inverse fault',()=>{
 const q=parseQuickQuery('C16L颜色异常并闪烁',lookup);assert.equal(rank(q,[{source:'cases',rows:[{type:'case',name:'闪烁',text:'手机模拟屏闪烁',modelIds:[]}]}],lookup).length,0);
 const wifi=parseQuickQuery('Wi-Fi搜不到但网线正常',lookup),rows=[{type:'case',name:'网线搜不到Wi-Fi正常',phenomenon:'网线搜不到设备，Wi-Fi正常',text:'网线搜不到设备，Wi-Fi正常'},{type:'case',name:'无线发现异常',phenomenon:'搜不到卡的Wi-Fi',text:'搜不到卡的Wi-Fi'}];
 assert.deepEqual(rank(wifi,[{source:'cases',rows}],lookup).map(r=>r.candidate.name),['无线发现异常']);
});
test('Mentioning firmware in a fault is a recall hint and does not exclude historical cases',()=>{
 const q=parseQuickQuery('C16L固件升级后闪烁',lookup),rows=[{type:'case',name:'升级后闪烁',phenomenon:'升级后闪烁',text:'升级后闪烁记录',modelIds:['HD-C16L']}];assert.equal(rank(q,[{source:'cases',rows}],lookup).length,1);
});
test('Document category, chip and version conflicts stay hard constraints across sources',()=>{
 const q=parseQuickQuery('C16L说明书',lookup);assert.equal(rank(q,[{source:'text',rows:[{type:'passage',name:'C16L规格书',text:'说明书见另文'},{type:'case',name:'C16L故障',text:'说明书提到闪烁',modelIds:['HD-C16L']}]}],lookup).length,0);
 const version=parseQuickQuery('R512硬件版本1.2固件',lookup);assert.equal(rank(version,[{source:'catalog',rows:[{type:'document',name:'R512固件',category:'firmware',download:'/fw',modelIds:['HD-R512'],versions:['2.0']}]}],lookup).length,0);
 assert.equal(rank(version,[{source:'catalog',rows:[{type:'document',name:'R512固件',category:'firmware',download:'/fw',modelIds:['HD-R512'],versions:['1.2']}]}],lookup).length,0);
});
test('Unified ranking ignores incompatible raw source score scales and deduplicates shared evidence',()=>{
 const q=parseQuickQuery('C16L带载',lookup),row={type:'parameter',name:'C16L规格书',modelIds:['HD-C16L'],text:'带载20万像素',evidenceId:'same'},wrong={type:'passage',name:'C16L一般资料',text:'带载概述',score:1e12};
 const r=rank(q,[{source:'parameters',rows:[row]},{source:'text',rows:[wrong,row]}],lookup);assert.equal(r[0].candidate.evidenceId,'same');assert.equal(r.filter(x=>x.candidate.evidenceId==='same').length,1);assert.equal(r[0].sources.size,2);
});
test('Insufficient evidence reports no result rather than converting an unverified number or filename to an answer',async()=>{
 const api=createQuickRetrieval({knowledge:{...knowledge,findProducts:id=>lookup.findProducts(id).map(p=>({...p,claims:[{field:'load',text:'带载999万点',verificationStatus:'indexed-not-content-verified'}]}))},search:async()=>({results:[]}),searchCases:()=>({results:[]})});
 const r=await api.answer('A3L带载');assert.equal(r.results.length,0);assert.ok(!r.reply.includes('999'));assert.match(r.reply,/未找到/);
});
test('Indexed FAQ records use their real question and answer, with exact-question direct output only',async()=>{
 const question='C16L如何恢复出厂设置',api=createQuickRetrieval({knowledge,search:async()=>({results:[{name:'C16L常见问题FAQ.csv',text:'2026-01-01 | '+question+' | 请按原文指定复位步骤操作',download:'/faq',locator:{row:2}}]}),searchCases:()=>({results:[]})});
 const r=await api.answer(question);assert.equal(r.results[0].type,'faq');assert.match(r.reply,/FAQ标准答案/);assert.match(r.reply,/原文指定复位步骤/);
});
