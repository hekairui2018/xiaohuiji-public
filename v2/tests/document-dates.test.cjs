'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {documentDate,newestFirst}=require('../domain/knowledge/document-dates.cjs');
test('only labelled original dates determine descending order; invalid or incidental dates stay unknown',()=>{
 const a=documentDate({documentIntro:'发布日期：2024年2月29日\n修订日期：2025-03-01'});
 assert.equal(a.documentDate,'2025-03-01');
 assert.equal(documentDate({documentIntro:'修订日期：2025-02-30\n保修截止2026-12-31',mtime:'2026-10-17'}).documentDate,null);
 const items=[{documentDate:null},{documentDate:'2024-01-01'},a].sort(newestFirst);
 assert.equal(items[0],a);assert.equal(items[2].documentDate,null);
});
