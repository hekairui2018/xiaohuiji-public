'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {organize}=require('../frontend/video-groups.js');

test('video browse preserves API taxonomy instead of filename taxonomy',()=>{
 const videos=[{name:'HDPlayer操作.mp4',url:'/v2/offline/file?id=1'},
  {name:'接收卡调试.mp4',url:'/v2/offline/file?id=2'}];
 const input=[{key:'receiver',label:'接收卡',count:2,videos},
  {key:'other',label:'其他',count:1,videos:[{name:'复位.mp4',url:'/v2/offline/file?id=3'}]}];
 const snapshot=JSON.stringify(input);
 const output=organize(input);
 assert.deepEqual(output.map(x=>[x.key,x.label,x.count]),
  [['receiver','接收卡',2],['other','其他',1]]);
 assert.equal(output[0].sections[0].videos[0],videos[0]);
 assert.equal(JSON.stringify(input),snapshot);
});
