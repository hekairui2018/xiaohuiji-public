'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareExpertSources}=require('../domain/knowledge/expert-source-contract.cjs');
const table={evidenceId:'table',name:'对比表',sourceKind:'structured-comparison-original',modelIds:['HD-X100'],text:JSON.stringify({models:[{model:'X100'}],rows:[{parameter:'带载能力',values:[{model:'X100',value:'384x512'}]},{parameter:'输出带载',values:[{model:'X100',value:'4网口×65万'}]}]})};
const spec={evidenceId:'spec',name:'X100规格书V2.1.pdf',modelIds:['HD-X100'],text:'带载范围 常规芯片：192*512；PWM芯片：384*512；留空不计入带载\n标配2路千兆网口。'};

test('unreleased generation and live site facts never borrow current specifications or default addresses',()=>{
 for(const message of ['X100下一代尚未发布的CPU是什么','Example软件未来版本菜单在哪','X100当前仓库库存多少','X100今天最低成交价多少','X100客户现场的实际IP地址是什么']){
  const r=prepareExpertSources(message,{hintIntent:'parameters'},[spec]);assert.equal(r.evidence[0].sourceKind,'source-scope-gap',message);assert(!r.evidence[0].text.includes('384*512'));assert(r.contract.scopeGaps.length);
 }
 for(const message of ['X100默认IP地址是什么','X100怎么修改IP地址','X100有库存查询功能吗']){
  assert.equal(prepareExpertSources(message,{hintIntent:'parameters'},[spec]).contract.scopeGaps.length,0,message);
 }
});
test('chip conditions and cross-source port conflicts stay attached to the same model',()=>{
 const r=prepareExpertSources('X100参数',{hintIntent:'parameters',models:['HD-X100']},[table,spec]);
 const body=JSON.parse(r.evidence[0].text);assert.match(body.rows[0].values[0].value,/PWM芯片/);assert.equal(body.rows[1].values[0].conflict,true);assert.match(body.rows[1].values[0].value,/4网口.*2网口/);assert.equal(r.contract.conflicts.length,1);
 assert.equal(JSON.parse(table.text).rows[1].values[0].value,'4网口×65万');
 const different=prepareExpertSources('X100参数',{hintIntent:'parameters'},[table,{...spec,modelIds:['HD-X200']}]);assert.equal(different.contract.conflicts.length,0);
});
test('a requested version cannot be answered with a different document version or a body mention',()=>{
 const route={hintIntent:'parameters',models:['HD-X100']};
 for(const message of ['给我2029版X100的参数','查X100版本V3.0的规格']){
  const r=prepareExpertSources(message,route,[{...spec,text:spec.text+'\n2029年计划，V3.0待发布'}]);assert.equal(r.evidence.length,1);assert.equal(r.evidence[0].sourceKind,'source-scope-gap');assert(!r.evidence[0].text.includes('384*512'));
 }
 const found=prepareExpertSources('X100版本V2.1的参数',route,[spec]);assert.equal(found.contract.scopeGaps.length,0);
 assert.equal(prepareExpertSources('X100硬件版本2.1的参数',route,[spec]).evidence[0].sourceKind,'source-scope-gap');
 assert.equal(prepareExpertSources('X100硬件版本2.1的参数',route,[{...spec,text:spec.text+'\n适用于硬件版本2.1。'}]).contract.scopeGaps.length,0);
 const fault=prepareExpertSources('X100版本V3.0升级后黑屏',{hintIntent:'aftersales'},[spec]);assert.equal(fault.evidence[0].evidenceId,'spec');
});
test('ambiguous tender field labels are reported without silently fixing the source',()=>{
 const source={evidenceId:'t',name:'控标原文',sourceKind:'structured-tender-original',text:'最大高度65536，最大高度8192。'};
 const r=prepareExpertSources('X100控标',{},[source]);assert.equal(r.contract.sourceAnomalies.length,1);assert.equal(r.evidence[0].text,source.text);
});
test('private credentials and unreleased inventories cannot be inferred from ordinary manuals',()=>{
 for(const message of ['客户自己改过的X100私有Wi-Fi密码是多少','给我未公开处理器的完整型号清单']){
  const r=prepareExpertSources(message,{},[spec]);assert.equal(r.evidence[0].sourceKind,'source-scope-gap');assert(r.contract.scopeGaps.length);
 }
 assert.equal(prepareExpertSources('客户的X100密码怎么修改',{hintIntent:'operation'},[spec]).contract.scopeGaps.length,0);
});
test('a device-specific historical case requires the matching current device before it is preloaded',()=>{
 const example={...spec,sourceKind:'indexed-case-record'};
 assert.equal(prepareExpertSources('升级后黑屏',{hintIntent:'aftersales',models:[]},[example]).evidence.length,0);
 assert.equal(prepareExpertSources('X100升级后黑屏',{hintIntent:'aftersales',models:['HD-X100']},[example]).evidence.length,1);
 assert.equal(prepareExpertSources('X200升级后黑屏',{hintIntent:'aftersales',models:['HD-X200']},[example]).evidence.length,0);
});
test('a typed chip identifier cannot become an unresolved device model',()=>{
 const r=prepareExpertSources('X100使用DP12345芯片黑屏',{hintIntent:'aftersales',models:['HD-X100'],unknownModels:['DP12345'],chips:['DP12345']},[spec]);assert.equal(r.contract.scopeGaps.length,0);assert.equal(r.evidence.length,1);
});
