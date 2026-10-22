'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRegisteredFaq}=require('../adapters/http/registered-faq.cjs');
const {createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
function fixture(options={}){
 let allowed=true,reads=0;
 const file={name:'常见问题FQA.csv',sha256:'abc',download:'/v2/offline/resource?id=7',sourceDirectory:'registered/FQA'};
 const blocks=[{id:1,locator:{row:1,cells:['日期','问题描述','解决方法','姓名']}},{id:2,locator:{row:2,cells:['2026','R712如何升级','先核对硬件 | 然后备份\n不能跨型号刷入','不应输出的联系人']}}];
 const lookup=createRegisteredFaq({findFiles:async()=>[file],authorize:async()=>allowed,readPage:async()=>{reads++;return {name:file.name,sha256:file.sha256,blocks,nextOffset:null};},normalize:r=>r,...options});
 return {lookup,file,blocks,deny:()=>allowed=false,reads:()=>reads};
}
test('Registered row recovery preserves full answer, source hash and row, not private columns',async()=>{
 const f=fixture(),rows=await f.lookup(' R712如何升级？');
 assert.equal(rows.length,1);assert.equal(rows[0].locator.row,2);assert.equal(rows[0].sha256,'abc');
 assert.match(rows[0].standardAnswer,/硬件 \| 然后备份\n不能跨型号/);
 assert.equal(rows[0].sourceDirectory,'registered/FQA');assert(!JSON.stringify(rows).includes('不应输出的联系人'));
 assert.equal((await f.lookup('R716如何升级')).length,0);assert.equal(f.reads(),1);
});
test('Permission revocation denies a warm exact cache and FTS hydration cache',async()=>{
 const f=fixture();await f.lookup('R712如何升级');f.deny();
 assert.deepEqual(await f.lookup('R712如何升级'),[]);
 assert.deepEqual(await f.lookup.hydrate([{sha256:'abc',locator:{row:2},text:'cached content'}]),[]);
});
test('Original identity mismatch fails closed and a failed load can retry',async()=>{
 let bad=true;const f=fixture({readPage:async()=>({name:'常见问题FQA.csv',sha256:bad?'different':'abc',blocks:[{locator:{row:1,cells:['问题','答案']}},{locator:{row:2,cells:['测试','原文答案']}}],nextOffset:null})});
 await assert.rejects(f.lookup('测试'),/identity-mismatch/);bad=false;assert.equal((await f.lookup('测试')).length,1);
});
test('Missing question/answer header is not inferred from arbitrary column positions',async()=>{
 const f=fixture({readPage:async()=>({name:'常见问题FQA.csv',sha256:'abc',blocks:[{locator:{row:1,cells:['型号','记录','员工']}},{locator:{row:2,cells:['R712','如何升级','不应输出']}}],nextOffset:null})});
 assert.deepEqual(await f.lookup('如何升级'),[]);
});
test('Malformed or non-progressing preview pagination cannot loop forever',async()=>{
 const f=fixture({readPage:async()=>({name:'常见问题FQA.csv',sha256:'abc',blocks:[],nextOffset:0})});
 await assert.rejects(f.lookup('问题'),/pagination-invalid/);
});
test('FTS restoration uses exact hash/row; no other row is substituted',async()=>{
 const f=fixture(),rows=await f.lookup.hydrate([{sha256:'abc',locator:{row:2},score:4},{sha256:'abc',locator:{row:99}},{sha256:'other',text:'ordinary document'}]);
 assert.equal(rows.length,2);assert.equal(rows[0].score,4);assert.equal(rows[0].faqExact,false);assert.match(rows[0].standardAnswer,/不能跨型号/);assert.equal(rows[1].text,'ordinary document');
});
test('Exact FAQ replies keep strict compatibility pending and collapse duplicate answer display',async()=>{
 const row={name:'FQA.csv',sha256:'abc',locator:{row:2},standardQuestion:'R712可以刷这个固件吗',standardAnswer:'旧记录：需核对硬件',type:'faq'};
 const api=createQuickRetrieval({knowledge:{products:()=>[],findProducts:id=>id==='HD-R712'?[{modelId:id}]:[]},faqLookup:async()=>[row,{...row,locator:{row:3}},{...row,locator:{row:4},standardAnswer:'另一版记录'}]});
 const r=await api.answer(row.standardQuestion);
 assert.equal(r.intent,'compatibility');assert.equal(r.status,'clarify');assert.equal(r.results.length,3);
 assert.equal(r.reply.split('旧记录：需核对硬件').length-1,1);assert.match(r.reply,/第2行.*第3行/);
 assert.match(r.reply,/不能确认现场兼容/);assert.equal(r.routeLog.businessStatus.answer,'needs-input');
});
