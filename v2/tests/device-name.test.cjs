'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deviceName,selectedDeviceName}=require('../domain/knowledge/device-name.cjs');
test('Chinese device description uses exact-model filename or cached cover, without rewriting names',()=>{
 const resource={name:'HD-S207亮度传感器规格书V1.0.pdf'};assert.equal(deviceName(resource,'HD-S207').name,'亮度传感器');assert.equal(deviceName(resource,'HD-S20'),null);assert.equal(resource.name,'HD-S207亮度传感器规格书V1.0.pdf');
 assert.equal(deviceName({name:'HD-X9规格书.pdf',documentMetadata:{coverModels:['X9']},documentIntro:'产品规格书\n光纤收发器\nHD-X9\nV1.0'},'HD-X9').name,'光纤收发器');
});
test('Unknown, conflicting and other-model descriptions are never guessed',()=>{
 assert.equal(deviceName({name:'HD-X9规格书.pdf',documentMetadata:{coverModels:['X8']},documentIntro:'光纤收发器'},'HD-X9'),null);
 assert.equal(deviceName({name:'HD-X9规格书.pdf'},'HD-X9'),null);
 assert.equal(deviceName({name:'HD-X9规格书.pdf',documentMetadata:{coverModels:['X9']},documentIntro:'支持其他控制卡\n配合发送卡'},'HD-X9'),null);
 assert.equal(selectedDeviceName([{kind:'spec',deviceName:'光纤收发器'},{kind:'spec',deviceName:'传感器'}]),null);
});
