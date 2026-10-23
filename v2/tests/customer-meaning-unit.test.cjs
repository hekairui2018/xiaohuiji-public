'use strict';
// Portable semantic contracts: no private catalogue, original or model required.
const test=require('node:test'),assert=require('node:assert/strict');
const {parseOrderingFields}=require('../domain/parser/ordering-fields.cjs');
const {messageUpdate}=require('../domain/parser/task-update.cjs');
const {decideAction}=require('../domain/parser/chat-intent.cjs');
const {diagnosticContext}=require('../domain/parser/customer-language.cjs');
const {rankAnswerEvidence}=require('../domain/knowledge/answer-evidence.cjs');
test('Natural geometry preserves count units and derives the requested use without rewriting identities',()=>{
 const fields=parseOrderingFields('P2.5室内，横排十二块模组，竖排八块，节目传进去断网也继续播');
 assert.equal(fields.screen.moduleColumns,12);assert.equal(fields.screen.moduleRows,8);assert.equal(fields.controlMode,'async');assert.equal(fields.module.pitchMm,2.5);
 assert.equal(parseOrderingFields('点间距2毫米，复制电脑画面').controlMode,'sync');
 assert.equal(parseOrderingFields('模组每排10张，总共6排').screen.moduleRows,6);
 const {spokenGeometry,describedControlMode}=require('../domain/parser/customer-meaning.cjs');assert.equal(spokenGeometry('R7I2 R712S V1.2.3'),'R7I2 R712S V1.2.3');assert.equal(describedControlMode('不需要复制电脑画面，节目发进去自己播放'),'async');
});
test('A one-axis correction and relative change preserve the untouched axis; absent units stay pending',()=>{
 const task={type:'ordering',ordering:{confirmed:{screen:{pixelWidth:1280,pixelHeight:640}}}};
 let change=messageUpdate('屏幕宽度改成1920像素，高度不变',task);assert.equal(change.delta.screen.pixelWidth,1920);assert.equal(change.delta.screen.pixelHeight,undefined);
 change=messageUpdate('宽再增加640像素，高不动',task);assert.equal(change.delta.screen.pixelWidth,1920);assert.equal(change.delta.screen.pixelHeight,undefined);
 change=messageUpdate('宽12高8',{type:'ordering',ordering:{confirmed:{}}});assert.ok(change.pending);assert.ok(!change.delta.screen?.pixelWidth);
});
test('Full requests retain engineering facts outside the final clause, while parameter principles and explicit operations keep their own actions',()=>{
 assert.equal(decideAction('同步室内，横16块高8块模组，用P2.5，控制设备帮我选，模组按常规').intent,'ordering');
 assert.equal(decideAction('R712带载多少，选型注意哪些条件',{models:['HD-R712']}).intent,'parameters');
 const operation=decideAction('HDPlayer做好节目，怎样通过U盘存到控制卡里，存完能拔吗',{software:['HDPlayer']});assert.equal(operation.intent,'operation');assert.match(operation.focusText,/怎样/);
 const manual=decideAction('找HDPlayer的使用手册',{software:['HDPlayer']});assert.ok(manual.categories.includes('manual'));assert.ok(!manual.categories.includes('software'));
});
test('Negative external wiring complements direct wiring and reseating is not a completed exchange',()=>{
 const prior=diagnosticContext('C16L右边几行发绿还闪，节目发送成功。',{}, {hintIntent:'aftersales',models:['HD-C16L']});
 const result=diagnosticContext('直接接模组，没有外接接收卡，排线重插无效，没有正常备件替换过，下一步查什么？',{diagnosticState:prior},{hintIntent:'technical',models:['HD-C16L']});
 assert.equal(result.requiresTopology,false);assert.equal(result.topology,'controller-direct-to-module');assert.equal(result.symptomDomain,'screen-display');assert.equal(result.reseated,true);assert.equal(result.exchanged,false);
});
test('Parameter evidence favours literal limits and keeps separate editions rather than duplicate signed copies',()=>{
 const rows=[{name:'SYN100 V1.0.pdf',text:'概述：带载26万点'},{name:'SYN100 V1.0.pdf',text:'参数表\n最大带载：26万点\n推荐带载128×1024\n注：实际带载与接口数有关'},{name:'SYN100 V1.0_已签章.pdf',text:'参数表\n最大带载：26万点\n推荐带载128×1024\n注：实际带载与接口数有关'},{name:'SYN100 V1.1.pdf',text:'参数表\n最大带载：26万点\n推荐带载256×1024\n注：实际带载与接口数有关'}];
 const ranked=rankAnswerEvidence(rows,{intent:'parameters',attributes:['load'],question:'版本不同分别给我'});assert.equal(ranked.length,2);assert.match(ranked[0].text,/参数表/);assert.equal(ranked[1].name,'SYN100 V1.1.pdf');
});
