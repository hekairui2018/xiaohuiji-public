'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {caseAdviceContract}=require('../domain/aftersales/case-advice-contract.cjs');
const {separateModelPortRanges}=require('../domain/identity/model-port-ranges.cjs');
const {comparisonValue}=require('../domain/knowledge/comparison-value.cjs');
const {comparisonAnswer}=require('../domain/knowledge/comparison-answer.cjs');
test('historical state, current applicability and synthetic port ranges are independent',()=>{
 const c=caseAdviceContract({caseStatus:'tracking',historicalSolution:'测试固件9.99.99后复位',scope:{chips:['EXAMPLE']}});
 assert.equal(c.caseStatus,'tracking');assert.equal(c.presentSiteCompatibilityConfirmed,false);assert.equal(c.hasDocumentedWorkflow,false);assert.equal(c.temporaryFirmwareMentioned,true);
 const lookup={findProducts:id=>id==='HD-X100'?[{modelId:id}]:[]};
 assert.equal(separateModelPortRanges('X1001~8网口',lookup),'X100 1~8网口');
 assert.equal(separateModelPortRanges('X100A规格书',lookup),'X100A规格书');
});
test('comparison source placeholders survive the deterministic overview without invented capabilities',()=>{
 assert.equal(comparisonValue('/').state,'unknown');assert.equal(comparisonValue('不支持').capability,false);
 const source={sourceKind:'structured-comparison-original',readPerformed:true,evidenceId:'example',text:JSON.stringify({models:[{model:'X100'},{model:'X200'}],rows:[{parameter:'输入',different:true,values:[{value:'/'},{value:'HDMI×2'}]}]})};
 const a=comparisonAnswer({decision:{action:'query-parameters',answerNeed:'parameter-overview'}},[source]);
 assert.equal(a.modelCallCount,0);assert.match(a.reply,/资料未确认/);assert.doesNotMatch(a.reply,/不支持/);assert.equal(a.parameterComparison.rows.length,1);
});
