'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {comparisonValue}=require('../domain/knowledge/comparison-value.cjs');
test('source placeholders and unlabelled glyphs do not establish capabilities',()=>{
 for(const value of ['','/','／','—','--','N/A','未记录','未知'])assert.deepEqual(comparisonValue(value),{state:'unknown',capability:null},value);
 for(const value of ['x','X','×','√','✓'])assert.deepEqual(comparisonValue(value),{state:'uninterpreted-symbol',capability:null},value);
 for(const value of ['不支持','不具备','否'])assert.deepEqual(comparisonValue(value),{state:'explicit-negative',capability:false},value);
 assert.equal(comparisonValue('支持').capability,true);
 for(const value of ['0','USB×1','1920x1080','无缝切换'])assert.equal(comparisonValue(value).state,'recorded-value');
 assert.equal(comparisonValue('2口',{conflict:true}).state,'conflict');
 assert.equal(comparisonValue('资料未记录',{recorded:false}).state,'unknown');
});
