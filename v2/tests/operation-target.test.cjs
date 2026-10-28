'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {operationTarget,operationCoverage}=require('../domain/knowledge/operation-target.cjs');
const {selectOperationEvidence}=require('../adapters/http/expert-operation-evidence.cjs');
test('a shared software name and many clicks do not replace the requested action and object',()=>{
 const plan={focus:'读取接收卡参数并保存',terms:['读取','接收','保存']},target=operationTarget(plan);
 assert.deepEqual(target.steps.map(s=>[s.action,s.object]),[['read','接收卡参数'],['save','接收卡参数']]);
 const wrong={text:'打开软件，点击网口备份，点击添加，然后保存。'},otherRead={text:'点击回读按钮，回读连接关系。接收卡参数可以设置。'},right={text:'在接收卡参数页面点击回读接收卡参数，再保存接收卡参数。'};
 assert.equal(operationCoverage(wrong.text,target).primarySupported,false);assert.equal(operationCoverage(otherRead.text,target).primarySupported,false);
 assert.equal(operationCoverage('读取发送卡参数。接收卡另设。',target).primarySupported,false);
 assert.deepEqual(selectOperationEvidence([wrong,otherRead,right],plan),[right]);
});
test('media creation retains its requested object and does not substitute a startup image or another content type',()=>{
 const plan={focus:'在节目中添加图片',terms:['节目','添加','图片']};
 const rows=[{text:'手动找卡点击添加。开机画面可选择开机图片。'},{text:'单击工具栏相应图标添加视频、图片、动画字。'},{text:'单击天气图标添加天气。'}];
 assert.deepEqual(selectOperationEvidence(rows,plan),[rows[1]]);
});
test('an action mentioned as a permission or status is not an executable instruction',()=>{
 const target=operationTarget({focus:'创建节目并发布'});
 const coverage=operationCoverage('点击新建节目。发布的节目需要管理员审核。',target);
 assert.equal(coverage.steps[1].supported,true);assert.equal(coverage.steps[1].instructionLocated,false);assert.equal(coverage.complete,false);
});
