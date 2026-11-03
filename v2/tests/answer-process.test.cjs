'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {answerProcess}=require('../adapters/http/answer-process.cjs');
test('Only bounded execution facts enter the customer-visible process summary',()=>{
 const result=answerProcess({models:['HD-X1','E:\\internal'],results:[{name:'X1规格书.pdf'},{name:'E:\\private\\secret.pdf'},{name:'https://private.test/file'}],modelCallCount:1,status:'answer',reasoning_content:'PRIVATE_REASONING',prompt:'PRIVATE_PROMPT',toolTrace:[{arguments:{secret:'PRIVATE_TOOL'}}]});
 const text=JSON.stringify(result);assert.match(text,/HD-X1|X1规格书/);assert.doesNotMatch(text,/PRIVATE|secret|private|E:/);assert.equal(result.steps.at(-1).detail,'已生成回答');
});
test('Unfinished work does not claim a completed answer',()=>{assert.equal(answerProcess({status:'unavailable'}).steps.at(-1).detail,'本次未完成');});

test('live totals include only nonnegative integer engine counts and keep arbitrary source fields private',()=>{const {answerProcess}=require('../adapters/http/answer-process.cjs');const a=answerProcess({status:'running',liveGeneration:{generatedTokens:1450,inputTokensPerSecond:1000,outputTokensPerSecond:80,includesThinking:true,reasoning:'not for display'}});assert.equal(a.liveGeneration.generatedTokens,1450);assert(!JSON.stringify(a).includes('not for display'));assert.equal(answerProcess({liveGeneration:{generatedTokens:-1}}).liveGeneration.generatedTokens,null);});
