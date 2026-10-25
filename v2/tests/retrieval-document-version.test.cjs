'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectRetrievalDocuments:select}=require('../adapters/http/retrieval-document-version.cjs');
const doc=(version,extension='pdf',extra={})=>({name:'HD-X1规格书 V'+version+'.'+extension,category:'spec',modelIds:['HD-X1'],documentId:version+'-'+extension,...extra});
const names=rows=>rows.map(d=>d.name);
test('The highest version is chosen before retrieval and same-version PDF replaces DOCX',()=>{
 const rows=[doc('2.1'),doc('2.2','docx'),doc('2.2'),doc('2.1','docx'),doc('2.1','pdf',{name:'HD-X1 Specification V2.1.pdf'}),doc('2.2','pdf',{name:'HD-X1规格书 V2.2_已签章.pdf'})];
 assert.deepEqual(names(select(rows,'X1带载多少')),['HD-X1规格书 V2.2.pdf']);
 assert.deepEqual(names(select([doc('2.9'),doc('2.10')],'X1参数')),['HD-X1规格书 V2.10.pdf']);
 assert.deepEqual(names(select([doc('2.2'),doc('2.3','docx')],'X1参数')),['HD-X1规格书 V2.3.docx']);
});
test('Explicit older document versions and version comparisons remain available',()=>{
 const rows=[doc('2.1'),doc('2.1','docx'),doc('2.2')];
 assert.deepEqual(names(select(rows,'请用V2.1规格书')),[rows[0].name]);
 assert.equal(select(rows,'规格书版本9.9').length,0);
 assert.equal(select(rows,'对比V2.1和V2.2规格书').length,2);
 assert.equal(select(rows,'软件版本2.1怎么操作').length,1);
});
test('Hardware, model suffix and unrelated document families are preserved',()=>{
 const rows=[doc('2.1'),doc('2.2'),doc('1.0','pdf',{name:'HD-X1A规格书 V1.0.pdf',modelIds:['HD-X1A']}),doc('1.0','pdf',{name:'HD-X1 HW2规格书 V1.0.pdf'})];
 assert.equal(select(rows,'参数').length,3);
 const unknown=doc('2.2','pdf',{name:'未标版本规格书.pdf'});assert.ok(select([...rows,unknown],'参数').includes(unknown));
});
