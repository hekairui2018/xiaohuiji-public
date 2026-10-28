'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {moduleInputCount}=require('../domain/ordering/module-input.cjs');
test('manufacturer input variants require explicit source labels, never inferred pixel or scan values',()=>{
 for(const [remark,count]of [['模组单输入',1],['模组双输入',2],['',undefined],['128×128 32S',undefined]])assert.equal(moduleInputCount({remark}),count);
});
