'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRagflowAnswers}=require('../adapters/http/ragflow-answer.cjs');
test('Task headings keep a contiguous procedure and its cautions without unrelated sibling sections',()=>{
 const {taskExcerpt}=require('../adapters/http/ragflow-answer.cjs');
 const q={operation:{terms:['账户管理']},literals:[]};
 assert.equal(taskExcerpt('5.1 登录\n打开登录。\n5.2 账户管理\n点击新建账户。\n完成后核对角色。\n注意保留原账户。\n5.3 设备分组\n点击分组。',q),'5.2 账户管理\n点击新建账户。\n完成后核对角色。\n注意保留原账户。');
});
const product={modelId:'HD-X1',displayName:'X1',aliases:['X1']};
const knowledge={products:()=>[product],findProducts:id=>id==='HD-X1'?[product]:[]};
test('Quick returns the requested original parameter without a generation call',async()=>{
 let calls=0;const api=createRagflowAnswers({knowledge,source:{search:async(q,scope)=>{calls++;assert.deepEqual(scope.models,['HD-X1']);return {results:[{name:'X1规格书.pdf',text:'最大带载10万点\n灰度等级256~65536级',modelIds:['HD-X1'],evidenceId:'x'}]};}}});
 const r=await api.quick('X1灰度等级是多少');assert.match(r.reply,/256~65536/);assert.doesNotMatch(r.reply,/10万/);assert.equal(r.modelCallCount,0);assert.equal(calls,1);
});
test('Unknown model and ordering never become a vector match presented as a fact',async()=>{
 const api=createRagflowAnswers({knowledge,source:{search:async()=>{throw Error('Unexpected vector search');}}});
 assert.equal(await api.quick('ZZ9999X灰度等级是多少'),null);
 assert.equal(await api.quick('配单P2室内同步10宽10高'),null);
});
test('Incomplete requested fields fall back instead of labelling a partial parameter lookup as complete',async()=>{
 const api=createRagflowAnswers({knowledge,source:{search:async()=>({results:[{name:'X1规格书.pdf',text:'支持256~65536级灰度等级',modelIds:['HD-X1'],evidenceId:'x'}]})}});
 assert.equal(await api.quick('X1带载和灰度等级分别是多少'),null);
});
test('A loading-capacity question retrieves total output capacity before per-port or input limits',async()=>{
 const api=createRagflowAnswers({knowledge,source:{search:async(query)=>({results:query.includes('最大控制')?[{name:'X1规格书.pdf',text:'最大控制2600万像素，最大宽度32768像素',modelIds:['HD-X1'],evidenceId:'total'}]:[{name:'X1规格书.pdf',text:'每个网口控制范围65万像素\n最大输入分辨率4096×2160像素',modelIds:['HD-X1'],evidenceId:'port'}]})}});
 const result=await api.quick('X1带载能力多少');assert.match(result.reply,/^最大控制2600万像素/);assert.doesNotMatch(result.reply,/4096/);
});
