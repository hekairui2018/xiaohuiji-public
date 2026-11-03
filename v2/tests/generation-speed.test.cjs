'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {generationSpeed}=require('../model-adapter/generation-speed.cjs');
test('Engine decode timing excludes prefill and preserves thinking label',()=>{
 const r=generationSpeed([{httpStatus:200,usage:{completion_tokens:100,completion_tokens_details:{reasoning_tokens:60}},elapsedMs:8000,timings:{predicted_n:100,predicted_ms:2000,prompt_ms:6000}}]);
 assert.equal(r.tokensPerSecond,50);assert.equal(r.kind,'decode');assert.equal(r.includesThinking,true);
});
test('Missing decode timing is labelled generation average and rounds are weighted',()=>{
 const r=generationSpeed([{httpStatus:200,usage:{completion_tokens:100},elapsedMs:2000},{httpStatus:200,usage:{completion_tokens:200},elapsedMs:8000}]);assert.equal(r.tokensPerSecond,30);assert.equal(r.kind,'generation-average');assert.equal(r.callCount,2);
 assert.equal(generationSpeed([]),null);assert.equal(generationSpeed([{httpStatus:500,usage:{completion_tokens:20},elapsedMs:100}]),null);
});

test('input and output rates use their own processing times, not total request duration',()=>{const r=generationSpeed([{httpStatus:200,elapsedMs:15000,usage:{completion_tokens:100},timings:{prompt_n:500,prompt_ms:500,predicted_n:100,predicted_ms:2000}},{httpStatus:200,elapsedMs:25000,usage:{completion_tokens:300},timings:{prompt_n:1000,prompt_ms:1500,predicted_n:300,predicted_ms:3000}}]);assert.equal(r.inputTokensPerSecond,750);assert.equal(r.tokensPerSecond,80);assert.equal(r.elapsedMs,5000);});
