'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inferModuleGeometry,planningPreference}=require('../domain/ordering/planning-inference.cjs');
test('Any two compatible geometric properties derive the third and never invent scan/interface',()=>{
 for(const input of [{pitchMm:2,pixelWidth:160,pixelHeight:80},{pitchMm:2,physicalWidthMm:320,physicalHeightMm:160},{pixelWidth:160,pixelHeight:80,physicalWidthMm:320,physicalHeightMm:160}]){
  const result=inferModuleGeometry(input);assert.deepEqual(result.conflicts,[]);assert.equal(result.module.pitchMm,2);assert.equal(result.module.pixelWidth,160);assert.equal(result.module.pixelHeight,80);assert.equal(result.module.physicalWidthMm,320);assert.equal(result.module.physicalHeightMm,160);assert.equal(result.module.scan,undefined);assert.equal(result.module.interface,undefined);assert.deepEqual(input,Object.fromEntries(Object.keys(input).map(key=>[key,result.module[key]])));
 }
});
test('Contradictory axes, fractional pixels and explicit supplied values are not silently overwritten',()=>{
 assert.ok(inferModuleGeometry({pitchMm:2,pixelWidth:128,physicalWidthMm:320}).conflicts.length);
 assert.ok(inferModuleGeometry({pixelWidth:160,physicalWidthMm:320,pixelHeight:80,physicalHeightMm:200}).conflicts.includes('pitchMm'));
 assert.ok(inferModuleGeometry({pitchMm:3,physicalWidthMm:320}).conflicts.includes('pixelWidth'));
});
test('Not knowing module details is a planning preference, and refusing defaults overrides its positive words',()=>{
 for(const text of ['不知道模组','模组不知道，按常规的配','不知道扫描，按常规配','按常规模组配'])assert.equal(planningPreference(text).useCatalog,true);
 assert.equal(planningPreference('不要默认模组').useCatalog,false);assert.equal(planningPreference('R712规格书').related,false);
});
test('A later module preference or label cannot steal the object and units of a screen dimension clause',()=>{
 const {geometryObservation}=require('../domain/parser/ordering-fields.cjs');
 for(const text of ['配单P2，宽10米高10米，室内同步，按常规模组配','按常规模组配，P2宽10米高10米，室内同步','P2宽10米高10米按常规模组配','P2，宽10米高10米，模组分辨率不知道']){const g=geometryObservation(text);assert.notEqual(g.entity,'module',text);assert.equal(g.unit,'m',text);assert.equal(g.conflict,false,text);assert.deepEqual(g.values,{width:10,height:10});}
 const module=geometryObservation('P2，模组尺寸320×160mm，整屏按常规配');assert.equal(module.entity,'module');assert.equal(module.unit,'mm');
});
