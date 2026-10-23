'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {requirements,meetsRequirements,softwareAssociationExcerpt}=require('../domain/knowledge/question-requirements.cjs');
const {answerPlan}=require('../domain/knowledge/answer-plan.cjs');
const {isTechnicalToken}=require('../domain/identity/extract-models.cjs');
test('A software recommendation for a specific operation requires that operation in the same passage',()=>{
 const q={intent:'operation',original:'构造箱体用什么软件',models:[],operation:{selectSoftware:true}};
 assert.equal(softwareAssociationExcerpt('使用HDSet软件，用原流程调试设备。',q,{name:'示例用户手册.pdf'}),null);
 const native='选择构造箱体，设置箱体排列，再保存参数。';
 const r=softwareAssociationExcerpt(native,q,{name:'HDSet操作说明书.pdf'});assert.match(r.text,/构造箱体/);
});
test('A comparison can independently establish load, Ethernet and HDMI instead of requiring every field in every paragraph',()=>{
 const q={intent:'parameters',original:'比较X1和X2的带载、网口及HDMI',models:['HD-X1','HD-X2'],attributes:['load','ports']};
 for(const text of ['单卡带载12万像素','2路输出网口','HDMI 1.4 输入接口'])assert.equal(meetsRequirements({text},q).accepted,true,text);
 assert.equal(meetsRequirements({text:'支持音频播放'},q).accepted,false);
});
test('Device load and component load stay separate even when both contain valid numbers',()=>{
 const q={original:'Z9能控制多少像素',intent:'parameters',models:['HD-Z9'],attributes:['load']};
 assert.equal(meetsRequirements({text:'控制范围 | 12万像素（600×200）'},q).accepted,true);
 assert.equal(meetsRequirements({text:'辅助接口：最大带载64×64'},q).accepted,false);
 assert.equal(meetsRequirements({text:'辅助接口：最大带载64×64'},{...q,original:'辅助接口带载多少像素'}).accepted,true);
});
test('A file title can locate evidence, but a different device class cannot supply its operation',()=>{
 const q={original:'接收卡配置文件怎么导出',intent:'operation',models:[]};
 assert.equal(meetsRequirements({name:'处理器手册.pdf',text:'点击系统管理，导出配置文件'},q).accepted,false);
 assert.equal(meetsRequirements({name:'调屏操作手册.pdf',text:'接收卡参数设置：点击导出，保存参数文件'},q).accepted,true);
});
test('Battery interface and preservation precautions do not answer a battery model question',()=>{
 const q={original:'Z9电池是什么型号',intent:'parameters',models:['HD-Z9']};
 for(const text of ['电池接口 | 连接2PIN RTC电池','确保电池未松落'])assert.equal(meetsRequirements({text},q).accepted,false);
 assert.equal(meetsRequirements({text:'电池型号：CR2032'},q).accepted,true);
});
test('A black-screen feature is not a black-screen fault report',()=>{
 const q={original:'局部黑屏',intent:'aftersales',models:[]};
 assert.equal(meetsRequirements({text:'支持一键黑屏，按下黑屏键关闭输出'},q).accepted,false);
 assert.equal(meetsRequirements({text:'部分黑屏故障，先检查供电及连接条件'},q).accepted,true);
});
test('Platform-scoped questions cannot borrow a different operating system answer',()=>{
 assert.equal(meetsRequirements({text:'支持Android 11'},{original:'有麒麟系统版本吗',intent:'parameters'}).accepted,false);
 assert.equal(meetsRequirements({text:'Android手机需要定位权限'},{original:'苹果手机找不到设备',intent:'aftersales'}).accepted,false);
 assert.equal(meetsRequirements({text:'找不到设备时检查软件连接'},{original:'苹果手机找不到设备',intent:'aftersales'}).accepted,true);
});
test('An interface capability question cannot be answered by unrelated connectors',()=>{
 const q={original:'HDMI能分窗口显示吗',intent:'parameters'};
 assert.equal(meetsRequirements({text:'Type-C接口，支持外部传感器'},q).accepted,false);
 assert.equal(meetsRequirements({text:'两个HDMI输入接口'},q).accepted,true);
});
test('Software association keeps native labels and mobile prerequisites',()=>{
 const text='应用软件：\nPC端：HDSign（HD2020）；\n移动端：屏掌控（需无线局域网）；\n云端：小灰云。';
 const excerpt=softwareAssociationExcerpt(text,{original:'Z9的软件',operation:{selectSoftware:true}});
 assert.match(excerpt.text,/HDSign/);assert.match(excerpt.text,/需无线局域网/);
});
test('Search plans never send an empty concept list and unbound credentials only clarify',()=>{
 const q={original:'Z9规格书',query:'Z9规格书',intent:'resources',models:['HD-Z9'],software:[],concepts:[],literals:[],attributes:[]};
 assert.deepEqual(answerPlan(q).search.concepts,['Z9']);
 assert.equal(answerPlan({...q,original:'默认密码',intent:'technical',models:[],concepts:['password']}).search,null);
});
test('Chips, electrical standards and labelled connectors are not unknown products',()=>{
 for(const value of ['TC5958','SM12345','RJ45'])assert.equal(isTechnicalToken(value),true);
 assert.equal(isTechnicalToken('J12','J12口坏了'),true);
 assert.equal(isTechnicalToken('J12','J12规格书'),false);
 assert.equal(isTechnicalToken('R712S'),false);
});
test('Expert handoff resumes the original question even when it had no specific device',()=>{
 const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
 const lookup={findProducts:()=>[],products:()=>[],softwareItems:()=>[],chipLookup:()=>null};
 const original='我想知道控制卡配套的手机APP叫什么';
 const state={taskState:{version:1,sequence:1,activeId:'task-1',tasks:[{id:'task-1',type:'operation',status:'active',context:{query:original,intent:'operation',models:[],software:[],chips:[],retrieval:{attributes:[],concepts:[],categories:[]}}}],events:[]}};
 const q=parseQuickQuery('请结合上文继续分析我的问题，沿用我已提供的条件',lookup,state);
 assert.equal(q.taskPlan.reason,'explicit-analysis-continuation');assert.equal(q.answerQuestion,original);assert.equal(q.query,original);
 const plan=answerPlan(q);assert.equal(plan.requirements.softwareSelection,true);assert.equal(plan.requirements.phone,true);
 assert.match(plan.search.query,/手机控屏/);
 const next=parseQuickQuery('另外一个新问题，默认密码是什么',lookup,state);
 assert.equal(next.answerQuestion,null);assert.equal(next.taskPlan.reason,'independent-request');
});

test('Connector counts never become a screen size',()=>{
 const {geometryObservation}=require('../domain/parser/ordering-fields.cjs');
 for(const text of ['RJ45 * 3, USB * 2','HDMI2×1，USB3×2'])assert.equal(geometryObservation(text).values,null);
 assert.deepEqual(geometryObservation('整屏1920×960像素').values,{width:1920,height:960});
});
test('Configuration export cannot be satisfied by network redundancy',()=>{
 const q={original:'接收卡配置导出',intent:'operation',models:[]};
 assert.equal(meetsRequirements({name:'接收卡手册',text:'网口备份：点击保存，发送固化'},q).accepted,false);
 assert.equal(meetsRequirements({name:'接收卡手册',text:'导出配置：选择保存到文件'},q).accepted,true);
});
test('Known Wi-Fi questions ask for the device instead of repeating the password category',()=>{
 const {clarificationPlan}=require('../domain/knowledge/question-requirements.cjs');
 const p=clarificationPlan({original:'屏掌控连接WiFi密码忘了',intent:'operation',models:[],software:['屏掌控'],concepts:['password']});
 assert.match(p.question,/设备/);assert.doesNotMatch(p.question,/还是/);
});
