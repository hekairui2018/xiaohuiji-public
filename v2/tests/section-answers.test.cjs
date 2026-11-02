'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSectionAnswers}=require('../adapters/http/section-answers.cjs');
const {createSectionTools}=require('../adapters/http/section-tools.cjs');
const row={name:'synthetic.pdf',fileId:'file-1',models:['HD-X100'],text:'输入电源 DC 5V，最大功耗 18W。',download:'/original/file-1'};
test('quick answers preserve literal query, source paragraph and original link; errors never use a second index',async()=>{
 let query;const answers=createSectionAnswers({async search(q){query=q;return {results:[row],retrievalBackend:'sections-sql-bm25-vector'};}});
 const ambiguous=await answers.answer('X100 电多少？');assert.equal(query,'X100 电多少？');assert.equal(ambiguous.status,'not-found');
 const result=await answers.answer('X100输入电源和最大功耗');assert.equal(query,'X100输入电源和最大功耗');assert.match(result.reply,/18W/);assert.equal(result.results[0].download,row.download);
 await assert.rejects(createSectionAnswers(null).answer('X100'),/fulltext-not-configured/);
 await assert.rejects(createSectionAnswers({async search(){throw Error('offline');}}).answer('X100'),/offline/);
});
test('expert shares fulltext, reads only issued section handles, keeps tables and calculator independent',async()=>{
 const calls=[];const tools=createSectionTools({resourceSearch:async q=>{calls.push(q);return {results:[row]};},expertMaterials:{evidence:q=>q==='对比'? [{evidenceId:'table-1',name:'table',text:'original cells'}]:[]},calculateOrdering:async args=>({calculated:args.userQuotes})});
 const found=await tools.execute('search_evidence',{kind:'text',query:'电源',models:['HD-X100']});assert.deepEqual(calls,['HD-X100 电源']);assert.equal(found.notice.scope,'sections-sql-bm25-vector');
 const read=await tools.execute('read_document',{blockId:found.evidence[0].blockId});assert.equal(read.evidence[0].text,row.text);
 await assert.rejects(tools.execute('read_document',{blockId:999}),/expert-invalid-tool/);
 const table=await tools.execute('search_evidence',{kind:'products',query:'对比'});assert.equal(table.notice.scope,'expert-structured-original-tables');assert.equal(calls.length,1);
 const calculated=await tools.execute('calculate_ordering',{userQuotes:['P2']});assert.deepEqual(calculated.calculated,['P2']);
 await tools.execute('search_evidence',{kind:'cases',query:'闪屏'});assert.equal(calls.at(-1),'闪屏');
});
test('quick mode separates table facts, file requests, procedures and greetings without using history',async()=>{
 let searches=0,tableReads=0;
 const table={models:[{model:'X100'},{model:'X200'}],rows:[{parameter:'输入电源',different:true,values:[{model:'X100',value:'DC 5V',source:[{name:'synthetic.xlsx',sheet:'产品',cell:'B3'}]},{model:'X200',value:'/',meaning:{state:'unknown'},source:[{name:'synthetic.xlsx',sheet:'产品',cell:'C3'}]}]}]};
 const materials={data:{records:[{kind:'comparison',model:'X100'},{kind:'comparison',model:'X200'}]},evidence(query){tableReads++;return query.includes('规格书')||query.includes('发布')?[]:[{evidenceId:'table-1',sourceKind:'structured-comparison-original',modelIds:['HD-X100','HD-X200'],name:'原表',text:JSON.stringify(table)}];}};
 const answers=createSectionAnswers({async search(){searches++;return {results:[row],retrievalBackend:'sections-sql-bm25-vector'};}},{materials});
 const compared=await answers.answer('X100和X200有什么区别',{state:{facts:{models:['OTHER']}}});assert.equal(compared.retrievalBackend,'knowledge-table');assert.match(compared.reply,/DC 5V/);assert.match(compared.reply,/资料未确认/);assert.match(compared.reply,/B3/);assert.doesNotMatch(compared.reply,/OTHER/);assert.equal(searches,0);
 const before=tableReads;const file=await answers.answer('发我X100规格书');assert.equal(file.intent,'resources');assert.equal(tableReads,before);assert.equal(searches,1);assert.doesNotMatch(file.reply,/18W/);
 await answers.answer('X100怎么发布节目');assert.equal(tableReads,before);assert.equal(searches,2);
 await answers.answer('你好');assert.equal(tableReads,before);assert.equal(searches,2);
 const wrongKind=createSectionAnswers({async search(){return {results:[{...row,kind:'manual'}]};}});
 const spec=await wrongKind.answer('发我X100规格书');assert.equal(spec.status,'not-found');assert.deepEqual(spec.results,[]);
});
