'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {advantages}=require('../domain/knowledge/competitive-knowledge.cjs');
const {plan}=require('../frontend/mascot-advice.js');
const row=(brand,model,value,extra={})=>({kind:'comparison',brand,model,parameter:'环路备份',value,sheet:'接收卡-对比',modelCell:brand==='灰度'?'B3':'C3',parameterCell:'A7',...extra});
test('only an explicit comparable difference produces a highlight; no competitor or internal source escapes',()=>{
 const data={records:[row('灰度','X10','√'),row('诺瓦','N10','×')]};
 assert.deepEqual(advantages(data,'HD-X10'),[{parameter:'环路备份',text:'支持环路备份'}]);
 for(const value of ['√','/','','选配','资料未记录'])assert.deepEqual(advantages({records:[row('灰度','X10','√'),row('诺瓦','N10',value)]},'X10'),[]);
 assert.deepEqual(advantages({records:[...data.records,row('灰度','X10','×')]},'X10'),[]);
 assert.deepEqual(advantages({records:[row('灰度','X10','√'),row('诺瓦','N10','×',{parameterCell:'A17'})]},'X10'),[]);
});
test('numeric comparisons require an explicit supported quantity, matching scope and units',()=>{
 const data={records:[row('灰度','X10','262万像素点',{parameter:'最大带载'}),row('卡莱特','Y10','230万像素点',{parameter:'最大带载'})]};
 assert.equal(advantages(data,'X10')[0].text,'最大带载 262万像素点');
 data.records[1].value='230万像素点（2主2备）';assert.deepEqual(advantages(data,'X10'),[]);
 data.records[1].value='';assert.deepEqual(advantages(data,'X10'),[]);
});
test('existing exact products keep their results while offering longer catalogue variants',()=>{
 const result={modelId:'HD-C16',name:'HD-C16'};
 const advice=plan({query:'C16',results:[result],models:['C16','C16L']});
 assert.equal(advice.kind,'model');assert.deepEqual(advice.models,['C16L']);assert.match(advice.message,/当前仍保留 HD-C16/);assert.doesNotMatch(advice.message,/未找到/);assert.equal(result.modelId,'HD-C16');
 for(const query of ['A5','R71','HD-VP82'])assert(plan({query,results:[],models:[query.replace(/^HD-/,'' )+'L']})?.models.length);
});
test('approximate results are identified, exact results only describe actual competitive differences',()=>{
 const r={modelId:'HD-X10',name:'HD-X10',competitiveHighlights:[{text:'支持环路备份'}]};
 assert.match(plan({query:'X10',results:[r]}).message,/对标亮点：支持环路备份/);
 assert.equal(plan({query:'X10',results:[{modelId:'HD-X10'}]}),null);
 const hint=plan({query:'X1',results:[r],approximateMatch:{selected:'X10'}});assert.equal(hint.kind,'model');assert.match(hint.message,/未找到完全一致/);
 assert.equal(plan({query:'R708固件',results:[r]}),null);
});
