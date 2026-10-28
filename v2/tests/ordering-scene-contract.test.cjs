'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sceneMissing,sceneConflict}=require('../domain/ordering/scene-contract.cjs');
const {parseOrderingScenes,orderingDeviceText}=require('../domain/parser/ordering-scenes.cjs');
test('official source options require typed input while display geometry never supplies source resolution',()=>{
 for(const [label,id]of [['2K',1],['4K@30Hz',2],['4K 60帧',3]]){
  const fields=parseOrderingScenes('拼接器，信号源'+label+'，网口输出板');
  assert.deepEqual(fields.requirements.sourceResolution,[{id}]);assert.equal(sceneMissing(fields).length,0);assert.equal(sceneConflict(fields),null);
 }
 assert.equal(parseOrderingScenes('整屏3840x2160').requirements,undefined);
 assert(sceneMissing({requirements:{controllerFamily:'splicer'}}).length===2);
 for(const key of ['sourceResolution','outInput'])for(const value of [null,{},'4K',[{id:999}]])assert(sceneConflict({requirements:{[key]:value}}));
 assert(sceneConflict({requirements:{T16:true,outInput:[{id:1}]}}));
});
test('scene components are removed from main-controller text without removing explicit controller constraints',()=>{
 const text='指定C16L，C16共享，每箱模组1x4，箱体阵列3x2',fields=parseOrderingScenes(text);
 assert.deepEqual(fields.cabinet,{moduleColumns:1,moduleRows:4,columns:3,rows:2});
 assert.equal(orderingDeviceText(text,fields).includes('指定C16L'),true);assert(!orderingDeviceText(text,fields).includes('C16共享'));
 const t16=parseOrderingScenes('使用T16，前端拼接器');assert.equal(t16.requirements.T16,true);assert.equal(t16.requirements.applicationScenarios.id,2);assert(!orderingDeviceText('使用T16，指定VP8000M',t16).includes('T16'));assert(orderingDeviceText('使用T16，指定VP8000M',t16).includes('VP8000M'));
 assert.equal(parseOrderingScenes('不用T16').requirements.T16,false);
});
