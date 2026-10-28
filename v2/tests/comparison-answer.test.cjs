'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {comparisonAnswer}=require('../domain/knowledge/comparison-answer.cjs');
const route={intent:'technical',decision:{action:'query-parameters',answerNeed:'parameter-overview'}};
const source={sourceKind:'structured-comparison-original',readPerformed:true,evidenceId:'source1',text:JSON.stringify({models:[{brand:'甲',model:'X100'},{brand:'乙',model:'X200'}],rows:[
 {parameter:'输入',different:true,values:[{value:'/'},{value:'HDMI×2'}]},
 {parameter:'播放',different:true,values:[{value:'x'},{value:'√'}]},
 {parameter:'带载',different:true,values:[{value:'100万'},{value:'不同来源',conflict:true}]}
]})};
test('comparison overview renders only source cells, preserving missing, glyph and conflict semantics',()=>{
 const out=comparisonAnswer(route,[source]);assert.equal(out.modelCallCount,0);assert.equal(out.parameterComparison.rows.length,3);
 assert.match(out.reply,/甲X100＝资料未确认/);assert.match(out.reply,/图例未确认/);assert.match(out.reply,/来源冲突/);assert.doesNotMatch(out.reply,/不支持|无SDI/);
 assert(out.claims.every(c=>c.evidenceIds[0]==='source1'));
});
test('engineering selection, single device, and unread sources retain expert handling',()=>{
 for(const action of ['ordering','analyze-fault','clarify','select-product'])assert.equal(comparisonAnswer({decision:{action,answerNeed:'parameter-overview'}},[source]),null);
 assert.equal(comparisonAnswer(route,[{...source,readPerformed:false}]),null);
 assert.equal(comparisonAnswer(route,[{...source,text:JSON.stringify({models:[{model:'X1'}],rows:[]})}]),null);
});
