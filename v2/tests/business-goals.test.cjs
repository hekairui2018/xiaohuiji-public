'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseOrderingFields}=require('../domain/parser/ordering-fields.cjs');
const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
const {supportsQuote}=require('../domain/knowledge/quote-support.cjs');
const {nativeLines}=require('../domain/knowledge/native-lines.cjs');
const {parameterFacets,parameterAnswerExcerpt}=require('../adapters/http/quick-retrieval.cjs');
test('Parameter paragraphs retain wrapped limits, distinct interface fields and native table rows',()=>{
 const text='二、产品特性\n1. 单卡带载12万像素，级联最\n大支持14台；\n2. 支持2路输入；\n25 | 输出网口×2 | 2路网口\n26 | USB | USB接口';
 assert.deepEqual(nativeLines(text),['二、产品特性','1. 单卡带载12万像素，级联最 大支持14台；','2. 支持2路输入；','25 | 输出网口×2 | 2路网口','26 | USB | USB接口']);
 const q={intent:'parameters',original:'X1带载',models:['HD-X1'],attributes:['load']};
 assert.match(parameterAnswerExcerpt(q,{text}).text,/大支持14台/);
 const facets=parameterFacets({...q,original:'X1和X2带载、网口、HDMI',attributes:['load','ports']});
 assert.deepEqual(facets.map(f=>f.attributes[0]),['load','ports','ports']);assert.equal(facets[1].original,'网口');assert.equal(facets[2].original,'HDMI');
});
test('Axis corrections and retained counts are typed module changes, while meter units never become module counts',()=>{
 for(const text of ['横向改成12块，高保持10块','横排调整为12块，竖排仍为10块','宽变为12块，高保留10块']){
  const fields=parseOrderingFields(text);assert.equal(fields.screen.moduleColumns,12);assert.equal(fields.screen.moduleRows,10);
 }
 assert.equal(parseOrderingFields('宽改成12米').screen?.moduleColumns,undefined);
});
test('Reading two specification contents for a comparison differs from requesting two downloadable files',()=>{
 const products=['HD-X1','HD-X2'].map(modelId=>({modelId,aliases:[modelId.replace('HD-','')]}));
 const lookup={products:()=>products,findProducts:id=>products.filter(p=>p.modelId===id),softwareItems:()=>[],isSoftware:()=>false};
 for(const text of ['请依据X1和X2规格书，对比带载和接口','比较X1与X2的带载','请根据X1和X2资料，分析差异']){
  const comparison=parseQuickQuery(text,lookup);
  assert.equal(comparison.intent,'parameters',text);assert.deepEqual(comparison.models.sort(),['HD-X1','HD-X2']);
  assert.ok(comparison.attributes.includes('load'));assert.equal(comparison.attributes.includes('ports'),!text.endsWith('的带载'));
 }
 const files=parseQuickQuery('把X1和X2的规格书发我，用来比较',lookup);assert.equal(files.intent,'resources');
 assert.equal(parseQuickQuery('不要对比，发我X1和X2规格书',lookup).intent,'resources');
});
test('Abridged quotations may omit sentences, but cannot invent fragments or change their order',()=>{
 const text='板载12个接口，相当于自带接收卡。这里是无关说明。单独带载20万像素。';
 assert.equal(supportsQuote(text,'板载12个接口，相当于自带接收卡；... 单独带载20万像素。'),true);
 assert.equal(supportsQuote(text,'板载14个接口... 单独带载20万像素'),false);
 assert.equal(supportsQuote(text,'单独带载20万像素...板载12个接口'),false);
 assert.equal(supportsQuote(text,'板载12个接口，相当于自带接收卡。单独带载20万像素。'),false);
});
