'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {advantages}=require('../domain/knowledge/competitive-knowledge.cjs');
const {plan,resolve}=require('../frontend/mascot-advice.js');
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

test('model advice covers generated families and suffixes without named product exceptions',()=>{
 let checks=0;
 for(const family of ['A','B','C','D','H','K','R','VP','KV','T'])for(const number of ['16','210','716']){
  const base=family+number,models=[base,base+'L',base+'S',base+'PRO'];
  const r=resolve(base,models);assert.equal(r.kind,'exact-with-variants');assert.equal(r.autoSelect,null);assert(r.candidates.includes(base+'L'));checks++;
  for(const suffix of ['L','S','PRO']){const q=base+suffix;assert.equal(resolve(q,models).kind,'exact');assert.equal(plan({query:q,models,results:[{modelId:q}]}),null);checks++;}
  const only=[base+'L'];assert.equal(resolve(base,only).kind,'incomplete');assert.equal(resolve(base,only).autoSelect,base+'L');checks++;
 }
 assert.equal(checks,150);
});

test('one-edit mistakes include insertions, deletions, substitutions and transpositions, not arbitrary nearest strings',()=>{
 for(const family of ['A','C','R','VP','KV','T']){
  const correct=family+'716L',models=[correct];
  for(const wrong of [family+'716',family+'7716L',family+'726L',family+'176L']){
   const r=resolve(wrong,models);assert(r.candidates.includes(correct),wrong);assert.equal(r.exact,false);
  }
  assert.equal(resolve(family+'99999',models).kind,'none');
  assert.equal(resolve('Z716L',models).kind,'none');
 }
});

test('ambiguous corrections never fetch a first candidate; exact identifiers never become typo suggestions',()=>{
 for(const query of ['R71','A3','VP82']){
  const models=[query+'0',query+'1',query+'2',query+'3'];const r=resolve(query,models);
  assert.equal(r.autoSelect,null);assert.equal(r.candidates.length,3);
 }
 assert.equal(resolve('R715L',['R716L','R717L']).autoSelect,null);
 assert.equal(resolve('R716',['R712','R716','R718']).kind,'exact');
 assert.equal(resolve('R71',['R712','R716'],{resultModels:['R71']}).autoSelect,null);
});

test('normalization preserves product suffixes and blocks non-model searches from model guessing',()=>{
 for(const query of ['hd-r716l',' HD R716L ','ＨＤ－Ｒ７１６Ｌ'])assert.equal(resolve(query,['HD-R716L']).kind,'exact');
 for(const query of ['6363','HDPlayer','R716怎么接线','P2 10宽10高','<img src=x>',''])assert.equal(resolve(query,['R716L']).kind,'none');
 assert.equal(resolve('R716L',['R716']).kind,'possible-typo');
});
