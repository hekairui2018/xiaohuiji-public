'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {quotationLocation}=require('../domain/knowledge/evidence-location.cjs');
test('A claim late in a chapter cites its actual source page, not its first page or stale heading',()=>{
 const first='说明部分',last='定时关机仅切断视频信号，电源保持通电。';
 const row={text:first+'\n'+last,locator:{page:1,section:'固件升级'},contextParts:[{charStart:200,charEnd:200+first.length,locator:{page:1}},{charStart:300,charEnd:300+last.length,locator:{page:8,section:'固件升级'}}]};
 assert.deepEqual(quotationLocation(row,'定时关机仅切断视频信号，\n电源保持通电。'),{page:8});
 assert.equal(quotationLocation({...row,answerOnly:true},last),undefined);
 assert.deepEqual(quotationLocation(row,'定时关机仅切断视频信号…电源保持通电。'),{page:8});
});
