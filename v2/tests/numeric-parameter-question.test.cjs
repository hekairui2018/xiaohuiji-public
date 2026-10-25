'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
const {numericQuestionCandidates}=require('../domain/identity/extract-models.cjs');
const products=['HD-VP4060','HD-VP3060','HD-R712'].map(modelId=>({modelId,aliases:[modelId.replace('HD-','')]}));
const lookup={products:()=>products,findProducts:id=>products.filter(p=>p.modelId===id)};
test('A registered numeric shorthand retains the requested parameter task',()=>{
 for(const text of ['4060带载能力多少','3060的接口有哪些','712灰度等级是多少']){
  const q=parseQuickQuery(text,lookup);assert.equal(q.intent,'parameters',text);assert.equal(q.models.length,1,text);
 }
 assert.deepEqual(parseQuickQuery('4060带载能力多少',lookup).models,['HD-VP4060']);
});
test('Pixel quantities, dimensions, versions and unregistered numbers cannot become product identities',()=>{
 for(const text of ['带载4060点可以吗','整屏4060×2160像素','宽4060毫米','版本号4060','刷新率4060Hz','9999带载多少'])assert.deepEqual(numericQuestionCandidates(text,products),[],text);
});
test('Ambiguous registered number never silently chooses a product family',()=>{
 const q=parseQuickQuery('4060带载多少',{products:()=>[...products,{modelId:'HD-X4060',aliases:[]}],findProducts:lookup.findProducts});assert.equal(q.ambiguous,true);
});
