'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createApp}=require('../app/bootstrap.cjs');
const {parseQuickQuery}=require('../domain/knowledge/quick-query.cjs');
const {createQuickRetrieval,rank}=require('../adapters/http/quick-retrieval.cjs');
const knowledge=loadKnowledge(),app=createApp({knowledge}),lookup={...knowledge,softwareItems:app.resourceMedia.softwareItems,isSoftware:s=>!!app.resourceMedia.softwareItems(s).length,chipLookup:app.chipLookup};

test('Procedure relations distinguish precautions, UI navigation and device export from capability or catalogue requests',()=>{
 const pairs=[
  ['T16网口串线方式有什么需要注意的吗','operation','T16网口数量是多少','parameters'],
  ['异步软件测试功能在哪里','operation','HDPlayer支持什么功能','software-function'],
  ['HDPlayer设置入口在哪儿','operation','HDPlayer操作手册在哪儿','resources'],
  ['3566S把视频从盒子里下载出来','operation','3566S操作视频下载','resources'],
  ['通过哪一根网线连接我的电脑','operation','网线连接教程','resources'],
  ['R712升级时有什么需要注意','operation','R712升级注意事项说明书在哪','resources'],
 ];
 for(const [a,ia,b,ib]of pairs){assert.equal(parseQuickQuery(a,lookup).intent,ia,a);assert.equal(parseQuickQuery(b,lookup).intent,ib,b);}
 assert.equal(parseQuickQuery('R712升级失败，有什么需要注意',lookup).intent,'aftersales');
 assert.equal(parseQuickQuery('R712可以刷这个固件吗',lookup).intent,'compatibility');
});

test('Event complements, requested file heads and capability predicates keep distinct meanings',()=>{
 const pairs=[
  ['我换电脑了，然后我无法发送节目了','aftersales','HDPlayer能发送节目吗','software-function'],
  ['HDShow打开后LED屏上没有我播放的内容','aftersales','HDShow有什么功能','software-function'],
  ['无法搜索到wifi信号','aftersales','Wifi名称是啥','parameters'],
  ['有没有屏掌控的操作步奏','operation','屏掌控有没有节目编辑功能','software-function'],
  ['A5L操作说明','resources','A5L怎么操作','operation'],
  ['D16升级程序','resources','D16怎么升级','operation'],
  ['A4L软件安装程序','resources','HDPlayer怎么安装','operation'],
  ['Model: HD-VP210A','product','VP210A带载多长','parameters'],
  ['哪款设备支持8路HDMI采集和20路网口发送','ordering','T16有多少网口','parameters'],
  ['130万像素点用什么产品','ordering','R712参数','parameters'],
  ['5158可以用哪个芯片代替','compatibility','1065','chip'],
 ];
 for(const [a,ia,b,ib]of pairs){assert.equal(parseQuickQuery(a,lookup).intent,ia,a);assert.equal(parseQuickQuery(b,lookup).intent,ib,b);}
 for(const text of ['忘记了Wi-Fi密码','单色屏忘记密码'])assert.equal(parseQuickQuery(text,lookup).intent,'operation',text);
 assert.equal(parseQuickQuery('接收卡技术支持',lookup).intent,'service');
});

test('Availability, technical assistance and post-upgrade procedure keep their requested action',async()=>{
 for(const q of ['电脑版发布软件','你好HD2018还有这个软件吗'])assert.equal(parseQuickQuery(q,lookup).intent,'resources',q);
 for(const q of ['控制软件有问题，需要远程控制调整','谁有空调个屏幕'])assert.equal(parseQuickQuery(q,lookup).intent,'service',q);
 assert.equal(parseQuickQuery('灰度升级了需要重启吗',lookup).intent,'operation');
 assert.equal(parseQuickQuery('H6升级失败，需要重启吗',lookup).intent,'aftersales');
 assert.equal(parseQuickQuery('A6L用什么方法控制播放内容',lookup).intent,'operation');
 assert.equal(parseQuickQuery('HDPlayer有什么功能',lookup).intent,'software-function');
 const api=createQuickRetrieval({app,knowledge,search:async()=>({results:[]}),searchCases:()=>({results:[]})});
 const r=await api.answer('电脑版发布软件');assert.equal(r.answerType,'software-choice');assert.match(r.reply,/设备型号/);assert.equal(r.results.length,0);
});

test('Negative operating constraints are not failures and standards/media are not unknown devices',()=>{
 const q=parseQuickQuery('HD-D16在不使用网络的方法下，有什么方法控制播放内容吗',lookup);
 assert.equal(q.intent,'operation');assert.deepEqual(q.models,['HD-D16']);
 assert.equal(parseQuickQuery('HD-D16无法使用网络播放内容',lookup).intent,'aftersales');
 for(const text of ['A6L插U盘MP4素材画面不亮','RS232串口怎么接线控制视频处理器','RS485怎么接线'])assert.deepEqual(parseQuickQuery(text,lookup).unknownModels,[],text);
 assert.deepEqual(parseQuickQuery('R712S3参数',lookup).unknownModels,['R712S3']);
 assert.equal(parseQuickQuery('HDPlayer是什么',lookup).decision.answerNeed,'software-overview');
 assert.equal(parseQuickQuery('HD-C16L必须需要接收卡吗',lookup).decision.answerNeed,'capability-confirmation');
});

test('Capability-based product selection preserves requirements without invoking an LED screen BOM',async()=>{
 let calculations=0;
 const api=createQuickRetrieval({app,knowledge,businessAnswer:async()=>{calculations++;return {};}});
 const lcd=await api.answer('有四路视频输出的LCD控制板吗');assert.equal(lcd.answerType,'product-selection-scope');assert.match(lcd.reply,/各路独立播放/);assert(!/宽|高|米/.test(lcd.reply));
 const led=await api.answer('全彩控制卡，130万像素点用什么产品');assert.match(led.reply,/130万像素/);assert.match(led.reply,/同步输入/);assert.equal(calculations,0);
});

test('Reported UI status and configuration transitions retain their customer action',()=>{
 assert.equal(parseQuickQuery('显示服务已到期怎么处理',lookup).intent,'aftersales');
 // Name the object and requested capability; bare 'service' is ambiguous.
 assert.equal(parseQuickQuery('软件支持到期提醒吗',lookup).intent,'software-function');
 assert.equal(parseQuickQuery('异步卡新流程改原流程',lookup).intent,'operation');
 assert.equal(parseQuickQuery('异步卡新流程操作说明',lookup).intent,'resources');
});

test('Unknown discovery and sending task objects ask one scoped question before recommending historical remedies',async()=>{
 let calls=0;const api=createQuickRetrieval({app,knowledge,search:async()=>{calls++;return {results:[]};},searchCases:()=>{calls++;return {results:[]};}});
 const discovery=await api.answer('无法搜索到wifi信号');assert.equal(discovery.intent,'aftersales');assert.equal(discovery.answerType,'fault-scope-question');assert.match(discovery.reply,/热点/);assert.equal(discovery.results.length,0);
 const sending=await api.answer('我换电脑了，然后我无法发送节目了');assert.equal(sending.intent,'aftersales');assert.match(sending.reply,/哪款软件/);assert(!/芯片|刷|固件|整屏/.test(sending.reply));assert.equal(calls,0);
});
test('Polite model introduction does not discard subsequent completed-event fault description',()=>{
 for(const text of ['请问VP210这款机子，用U盘播放完一个视频就不能循环播放，是什么情况呢','请问H6，用了一天以后就没有输出了']){
  const q=parseQuickQuery(text,lookup);assert.equal(q.intent,'aftersales');assert(q.decision.focusText.includes('播放')||q.decision.focusText.includes('输出'));
 }
 assert.equal(parseQuickQuery('H6黑屏，先给我R712说明书',lookup).intent,'resources');
});
test('Document noun heads distinguish named manuals and videos from operation or faults',()=>{
 for(const text of ['HDPlayer操作手册','屏掌控操作视频','HDSet异步电脑版调试说明书'])assert.equal(parseQuickQuery(text,lookup).intent,'resources');
 assert.equal(parseQuickQuery('HDPlayer怎么操作',lookup).intent,'operation');
 assert.equal(parseQuickQuery('发送视频节目黑屏',lookup).intent,'aftersales');
 assert.equal(parseQuickQuery('HDPlayer打不开怎么办',lookup).intent,'aftersales');
});
test('Commercial service requests cannot consume unrelated technical passages or claim live transfer',async()=>{
 let calls=0;
 const api=createQuickRetrieval({app,knowledge,search:async()=>{calls++;return {results:[]};},searchCases:()=>({results:[]})});
 for(const text of ['西藏的销售电话','技术什么时候上班','人工','我的东西坏了 怎么报修','灰度W63多少钱一台']){
  const r=await api.answer(text);assert.equal(r.intent,'service');assert.equal(r.status,'clarify');assert.equal(r.results.length,0);assert(!/已转接|已创建工单/.test(r.reply));assert.equal(r.routeLog.businessStatus.answer,'needs-input');
 }
 assert.equal(calls,0);
});
test('An unspecified app download asks software identity and does not recommend every package',async()=>{
 const api=createQuickRetrieval({app,knowledge,search:async()=>({results:[]}),searchCases:()=>({results:[]})});
 const r=await api.answer('app下载');assert.equal(r.intent,'resources');assert.equal(r.answerType,'software-choice');assert.equal(r.results.length,0);assert.match(r.reply,/设备型号/);
});
test('Software selection evidence comes from exact model original and never other model manual',async()=>{
 const documents=[{document:{name:'R712用户手册.pdf',sha256:'right',pages:[{page:3,text:'使用HDSet软件调试接收卡。'}]}},{document:{name:'A6L用户手册.pdf',sha256:'wrong',pages:[{page:2,text:'使用HDPlayer软件调试。'}]}}];
 const api=createQuickRetrieval({app,knowledge,originalDocuments:documents,search:async()=>({results:[]}),searchCases:()=>({results:[]})});
 const r=await api.answer('HDR712用什么软件');assert.equal(r.answerType,'software-selection-original');assert.match(r.reply,/HDSet/);assert(!r.reply.includes('HDPlayer'));assert.equal(r.results[0].sha256,'right');
});
test('A battery question cannot display verified load or interface claims as its answer',async()=>{
 const modelId='HD-A6L',claim={claimId:'verified-load',field:'load',text:'最大控制范围260万像素',verificationStatus:'verified',sourceReferences:[{originalSha256:'original-hash',originalName:'A6L规格书.pdf',verificationStatus:'verified',page:2}]};
 const k={products:()=>[{modelId}],findProducts:id=>id===modelId?[{modelId,claims:[claim]}]:[]};
 const api=createQuickRetrieval({knowledge:k,search:async()=>({results:[]}),searchCases:()=>({results:[]})});
 const result=await api.answer('A6L的电池型号是什么？');assert.equal(result.intent,'parameters');assert(!result.reply.includes('260万'));assert.equal(result.results.length,0);
});
test('Misspelled load question retains original words while searching the canonical technical term',async()=>{
 const modelId='HD-W64A',queries=[],k={products:()=>[{modelId}],findProducts:id=>id===modelId?[{modelId}]:[]};
 const api=createQuickRetrieval({knowledge:k,search:async query=>{queries.push(query);return {results:[]};},searchCases:()=>({results:[]})});
 const r=await api.answer('W64A最大代载');assert.equal(r.intent,'parameters');assert.equal(r.query,'W64A最大代载');assert(queries.some(q=>q.includes('带载')));
});
test('SDK requests cannot be satisfied by an ordinary specification or firmware package',()=>{
 const q=parseQuickQuery('C16L的SDK',lookup),rows=['C16L规格书.pdf','C16L固件.bin','C16L SDK接口说明.pdf'].map(name=>({name,type:'document',modelIds:['HD-C16L'],download:'/registered-original'}));
 assert.equal(q.intent,'resources');assert.deepEqual(rank(q,[{source:'catalog',rows}],lookup).map(r=>r.candidate.name),['C16L SDK接口说明.pdf']);
});
test('Language and format constraints stay attached to the requested document object',()=>{
 const q=parseQuickQuery('给我R712规格书，只要中文版且PDF格式的',lookup);
 assert.equal(q.intent,'resources');assert.deepEqual(q.models,['HD-R712']);
 const rows=[{name:'R712规格书.pdf',documentLanguage:'zh'},{name:'R712 Specification.pdf',documentLanguage:'en'},{name:'R712规格书.docx',documentLanguage:'zh'}].map(r=>({...r,type:'document',category:'spec',modelIds:['HD-R712'],download:'/original'}));
 assert.deepEqual(rank(q,[{source:'catalog',rows}],lookup).map(r=>r.candidate.name),['R712规格书.pdf']);
});
test('Compound document noun governs embedded operation word, not the converse',()=>{
 for(const q of ['HDSign最新的操作说明书有吗','有软件操作的视频讲解吗'])assert.equal(parseQuickQuery(q,lookup).intent,'resources');
 assert.equal(parseQuickQuery('HDSign怎么操作',lookup).intent,'operation');
});
test('Resolution/interface attributes cannot become fake model identities',()=>{
 const q=parseQuickQuery('T08的HDMI接口是否支持4K',lookup);assert.deepEqual(q.models,['HD-T08']);
 assert.deepEqual(parseQuickQuery('哪款设备支持8路HDMI1.4高清采集',lookup).unknownModels,[]);
 assert.deepEqual(parseQuickQuery('3568V用什么软件',lookup).models,['HD-3568V']);
});
test('Chip firmware follow-up retains the requested action when customer supplies receiver identity',()=>{
 const state={retrievalHistory:[{quickContext:{intent:'resources',chips:['ICN1065'],models:[],query:'1065的固件'}}]};
 const q=parseQuickQuery('R712',lookup,state);assert.equal(q.intent,'resources');assert.deepEqual(q.models,['HD-R712']);assert(q.chips.includes('ICN1065'));
});
test('Communication module selection does not ask screen dimensions or create a screen BOM',async()=>{
 let calculations=0;
 const api=createQuickRetrieval({app,knowledge,businessAnswer:async()=>{calculations++;return {};}});
 const r=await api.answer('日本的4G模块选型');assert.equal(r.intent,'ordering');assert.equal(calculations,0);assert.match(r.reply,/主控型号和当地运营商/);assert(!/宽|高|米|BOM/.test(r.reply));
});
