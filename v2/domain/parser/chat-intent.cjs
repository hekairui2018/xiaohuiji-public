'use strict';
const {extractKnownModels,isTechnicalToken}=require('../identity/extract-models.cjs');
const {parseOrderingFields}=require('./ordering-fields.cjs');
const resourceCategories=[['manual',/说明书|说名书|说明数|手册|使用说明|操作说明|manual/i],['spec',/规格书|技术规格|datasheet|specification/i],['firmware',/固件|升级程序|firmware|\.bin\b/i],['software',/软件|安装包|安装程序|客户端|HDSet|HDPlayer|HDShow|HDSign/i],['video',/视频|教程|演示/i]];
// One action decision, shared by engineering input parsing and quick conversation.
// Topic/object words inform retrieval; they never override this result afterwards.
function decideClause(text,{models=[],software=[],orderingContext=null,relations=[],lexicalSpans=[],socialSignal=false,reportSignal=null,fastSemantics=false,operationSignal=null,requestOperation=null}={}){
 const original=String(text),query=original.normalize('NFKC').trim();
 const social=query.replace(/[\s，。！？!?,.～~]/g,'').toLowerCase();
 const reasons=[],missing=[],objects=[],topics=[];
 const cite=(rule,match)=>{if(match){const index=original.indexOf(match[0]);reasons.push({rule,text:index<0?original:match[0],start:index<0?0:index});}};
 const positive=query.replace(/(?<!是)(?:不是|并非|没有|不要|不用|不需要|无需|不)\s*(?:做|要|查|找|下载|看)?(?:故障排查|故障诊断|售后排查|说明书|手册|规格书|固件|配单|配卡|配屏|参数|资料|黑屏|灰阶异常|花屏|故障)/g,s=>' '.repeat(s.length));
 const categories=resourceCategories.filter(([,re])=>re.test(positive)).map(([k])=>k);
 // A software name identifies the object; it does not turn its manual/spec
 // request into an installer request.
 if(categories.includes('software')&&categories.some(c=>['manual','spec','firmware','video'].includes(c))&&!/安装包|下载器|安装程序|下载软件|软件安装/.test(positive))categories.splice(categories.indexOf('software'),1);
 for(const [type,re]of [['document',/说明书|说名书|说明数|手册|规格书|资料|文档|教程|固件|\.pdf|\.bin/i],['interface',/HDMI|HUB75|USB|DVI|网口/i],['software',/软件|APP|云平台/i],['module',/模组|单元板/],['device',/设备|控制卡|接收卡|发送卡|屏幕|显示屏/]]){const m=re.exec(positive);if(m)objects.push({type,text:m[0]});}
 for(const id of models)objects.push({type:'product',id});for(const name of software)objects.push({type:'software',id:name});
 for(const [id,re]of [['grayscale',/灰阶|灰度(?:等级|级)/],['load',/带载|带得|带几|带多少/],['size',/尺寸|宽高|宽|高|分辨率/],['function',/功能|用途|支持|能干啥|有什么用/],['firmware',/固件|刷|烧录|升级/]]){const m=re.exec(positive);if(m)topics.push({id,text:m[0]});}
 const deictic=/这个|那个|刚才|上一款|上一个|它的?|这份/.exec(positive);
 const observedPhenomenon=relations.find(r=>r.role!=='negated'&&r.predicate.type==='observation'&&r.target?.type==='phenomenon');
 const fault=reportSignal?[reportSignal.text]:/(?:(?:发现|出现|发生|存在)[^，。；]{0,6}异常|(?:屏|卡|设备|软件)[^，。；]{0,6}(?:坏了|不工作|没反应)|(?:灰阶|显示|亮度|颜色|画面)[^，。；]{0,6}(?:异常|不正常)|(?:升级|刷(?:入|机|固件)?|烧录|发送|联网|连接|安装)[^，。；]{0,8}(?:失败|报错|不成功)|黑屏|花屏|灰阶异常|闪烁|闪屏|闪点|偏色|色差|颜色异常|颜色不正常|颜色不对|变色|色块|连不上|掉线|不开机|水波纹|摩尔纹|鬼影|拖影|横线|竖线|死机|卡死|不亮|无显示|(?:无|没(?:有)?)信号|闪退|崩溃|无响应|打不开|升级失败|刷机失败|刷不上|烧录失败|(?:设备|控制卡|接收卡|Wi-?Fi|SSID|热点)[^，。；]{0,12}(?:搜不到|搜索不到|搜索不到|找不到|异常)|(?:搜不到|搜索不到|找不到)[^，。；]{0,10}(?:设备|控制卡|Wi-?Fi|SSID|热点)|(?:一直|局部|右边|左边)[^，。；]{0,8}(?:闪|异常)|故障)/i.exec(positive)||(observedPhenomenon?[observedPhenomenon.predicate.text+observedPhenomenon.target.text]:null);
 const document=/使用说明|操作说明|安装程序|升级程序|SDK|API文档|视频讲解|操作视频|网址|升级文件|升级包|安装包|下载器|说明书|说名书|说明数|手册|规格书|文档|资料|教程|\.pdf\b/i.exec(positive);
 let find=/(?:找|搜|查|要|发|给|下载|获取|有没有|在哪|哪里)[^，。；]{0,30}(?:说明书|说名书|说明数|手册|规格书|文档|资料|教程|固件|视频)|(?:说明书|手册|规格书|资料)[^，。；]{0,10}(?:在哪|哪里|找不到|搜不到)/i.exec(positive);
 // A media object being sent/played is not a request for a tutorial file.
 if(fastSemantics&&find&&/^(?:发|发送)[^，。；]{0,8}视频/.test(find[0])&&!/教学|教程|操作视频|演示|给我|发我|下载/.test(positive))find=null;
 let compatible=/(?:能不能|可不可以|能否|可以|可否|是否|能)\s*(?:使用|用|换成)[^，。；]{0,20}(?:固件|文件)|兼容|互刷|混刷|混用|通用|跨型号|(?:能不能|可不可以|能否|可以|可否|是否|能)\s*(?:用.{0,10})?(?:刷|升级|烧录|装)|(?:刷|固件)[^，。；]{0,20}(?:行吗|行不行|可以吗|能用吗|能不能用|适不适用)/i.exec(positive);
 if(fastSemantics&&!compatible)compatible=/(?:需要|要不要|是否需要).{0,12}(?:升级|刷|更换).{0,12}(?:吗|么|[?？])|(?:用|选).{0,6}(?:哪个|那个|哪款|哪种).{0,5}(?:固件|升级包)|(?:能否|能不能|可不可以|可以|能).{0,4}(?:使用|用|安装).{1,20}(?:吗|么|[?？])$/.exec(positive);
 // Edition adjectives describe software/documents; they are not a suitability action.
 if(compatible&&lexicalSpans.some(t=>t.type==='edition'&&t.start<=compatible.index&&t.end>=compatible.index+compatible[0].length)&&!/(?:能否|能不能|可不可以|可以|是否|兼容|互刷|混刷|[?？])/.test(positive))compatible=null;
 if(fastSemantics&&!compatible)compatible=/(?:能否|可以|能|可否).{0,12}(?:替代|代替|替换)|用.{1,20}(?:替代|代替|替换)/.exec(positive);
 let how=/(?:怎么|如何|怎样|咋|步骤|步奏|操作|教我|使用方法|播放方法|注意事项|调屏)|发送节目|节目发送/i.exec(positive)||(operationSignal?[operationSignal.text]:null);
 if(fastSemantics&&how&&lexicalSpans.some(t=>t.type==='document'&&t.start<=how.index&&t.end>=how.index+how[0].length))how=null;
 const documentInquiry=relations.find(r=>r.role!=='negated'&&r.target?.type==='document'&&r.predicate.type==='question'&&['吗','有没有','有无','哪些'].includes(r.predicate.text));
 const attributeQuestion=relations.find(r=>r.role!=='negated'&&r.predicate.type==='question'&&r.target?.type==='attribute');
 const capabilityInquiry=(/支持|有没有|有无|什么是|是什么意思|什么叫/.test(positive)||fastSemantics&&/(?:(?<!不|未)(?:能否|可否)[^，。；;！？!?\n]{1,35}|(?<!不|未)(?:可以|能)[^，。；;！？!?\n]{1,35}[吗么?？])$/.test(positive))&&!/(?:我这|我的|我们|突然|一直|出现|发生|现在).{0,20}(?:黑屏|花屏|异常|无信号|没信号|闪|失败)/.test(positive);
 const parameter=/数量|(?:参数|带载|灰阶|灰度等级|灰度级|尺寸|接口|网口|分辨率|宽高)[？?\s]*$|多少|多大|多宽|多高|几路|几个|几口|几块|几张|几级|几种|参数|规格参数|电池|代载|接口规格|缩放|尺寸是|什么尺寸|什么分辨率|有什么接口|哪些接口|最大(?:带载|宽|高)|带载是|带得动|支持|功能|用途|能干啥|有什么用/i.exec(positive)||(attributeQuestion?[attributeQuestion.predicate.text]:fastSemantics&&(capabilityInquiry||/(?:最薄|最厚)|(?:是|为).{1,30}[吗么?？]$/.test(positive))&&!document&&!find?[query]:null);
 if(fastSemantics&&capabilityInquiry&&!requestOperation&&!/(?:怎么|如何|步骤|教我)/.test(positive))how=null;
 if(fastSemantics&&document&&/操作手册|操作视频|调试说明书|使用教程/.test(document.input)&&!/(?:怎么|如何|步骤|教我)/.test(positive))how=null;
 const propertyInquiry=fastSemantics&&/(?:多长|叫什么|是啥|是什么|名称|全称|需不需要|是否需要|必须(?:需要|配)?)/.test(positive)&&!/怎么|如何|步骤|步奏|注意|方式|方法/.test(positive);
 const productSelection=fastSemantics&&!models.length&&/(?:哪款|哪种|哪些|什么|哪个).{0,8}(?:设备|产品|控制卡|接收卡|发送卡|播放盒)|(?:用|选).{0,5}(?:什么|哪款|哪个)(?:产品|设备)|有.{1,25}(?:控制板|控制卡|处理器|播放盒)[吗么?？]/.test(positive);
 const supportingLookup=parameter&&!/说明书|说名书|说明数|手册|规格书|教程|安装包|下载/.test(positive);
 const service=fastSemantics&&/(?:销售|代理|技术支持|技术).{0,12}(?:电话|联系|上班|工作时间)|(?:电话|联系).{0,12}(?:销售|代理)|多少钱|报价|价格|报修|维修.{0,6}(?:电话|联系)|保修期|售后.{0,6}(?:电话|联系)|(?:人工(?:服务|客服)?|转人工|销售|技术支持)$|(?:想|打算|需要)购买/.exec(positive);
 const requestedAssistance=fastSemantics&&/(?:需要|请|帮忙|能否|找人).{0,8}远程.{0,8}(?:协助|调整|调试)|谁有空.{0,6}(?:调个屏|调试|帮忙)/.exec(positive);
 const softwareAvailability=fastSemantics&&/(?:还有|有没有|有无).{0,8}(?:软件|安装包)(?:吗|么|呀|[?？])?$|^(?:电脑(?:版|端)?|手机(?:版|端)?)?(?:发布|播控|播放|控制)?软件$/.exec(positive);
 let explicitOrder=/配单|配卡|配屏|配个|配一|我要配|帮我配|选型|BOM|用几张卡|网口规划|算.{0,5}(?:张卡|接收卡|配单)|选控制卡|(?:用|选)什么(?:控制|发送|接收)卡|画.{0,6}(?:接线图|拓扑)/i.exec(positive);
 const accessorySelection=fastSemantics&&/4G|5G|RF/.test(positive)&&/模块/.test(positive)&&/选型|怎么配|型号/.test(positive);
 const delta=parseOrderingFields(query),geometry=Object.keys(delta.screen||{}).length>0;
 if(explicitOrder?.[0]==='选型'&&!geometry&&models.length&&/选型.{0,10}(?:注意|条件|原则)/.test(positive))explicitOrder=null;
 const continuation=orderingContext&&!fault&&!document&&!compatible&&!software.length&&!how&&(Object.keys(delta).some(k=>k!=='provenance')||Object.values(delta.provenance||{}).some(v=>v.kind==='user-negated')||/继续配单|恢复配单|按暂定|刚才.*(?:那个|方案)|允许调整尺寸|可以调整尺寸|按整拼尺寸|按这个尺寸|不限定设备|取消指定设备|不限制设备型号/.test(positive)||/换成|改用|能不能用|不能用|为啥不用/.test(positive)&&models.length);
 let intent='clarify',action='clarify',chosen=null;
 if(socialSignal||/^(?:(?:你好|您好|嗨|嘿|哈喽|hello|hi|早上好)|(?:谢谢|多谢|感谢|thanks|明白了|不错|好的)|(?:你是谁|你能做什么|你有什么功能|能帮我什么))(?:呀|啊|哦|了)?$/.test(social)){intent='social';action='social';chosen=[query];}
 else if(service||requestedAssistance){intent='service';action='request-service';chosen=service||requestedAssistance;}
 else if(fastSemantics&&fault&&how&&!/能不能|能否|可不可以|可以.{0,20}吗|兼容吗|通用吗/.test(positive)&&!find&&!document){intent='aftersales';action='troubleshoot';chosen=fault;}
 else if(compatible&&(!document||/能否|是否|吗|么|什么|哪些|哪种|能不能|可不可以|兼容性|确认|适不适用|哪个|那个/.test(positive))&&!(how&&/告诉我|教我/.test(positive))){intent=software.length&&!/固件|刷|升级|烧录/.test(positive)?'software-function':'compatibility';action=intent==='compatibility'?'confirm-compatibility':'ask-software-function';chosen=compatible;}
 else if(fastSemantics&&/(?:说明书|手册|教程|视频讲解|固件)[^，。；]{0,15}(?:发我|给我|一份)|(?:SDK|API)(?:文档)?$/i.test(positive)){intent='resources';action='find-resources';chosen=[query];}
 else if(fastSemantics&&!requestOperation&&/下载|在哪获取|哪里获取/.test(positive)&&/软件|APP|安装包/i.test(positive)){intent='resources';action='find-resources';chosen=[query];}
 else if(fastSemantics&&requestOperation&&!fault){intent='operation';action='guide-operation';chosen=[requestOperation.text];}
 else if(softwareAvailability){intent='resources';action='find-resources';chosen=softwareAvailability;}
 else if(fastSemantics&&documentInquiry||find&&!supportingLookup||document&&!how&&!parameter||document&&/找不到|搜不到|搜索不到/.test(positive)){intent='resources';action='find-resources';chosen=find||document;}
 else if(fault&&capabilityInquiry){intent=software.length?'software-function':'parameters';action=software.length?'ask-software-function':'query-parameters';chosen=parameter||fault;}
 else if(fault){intent='aftersales';action='troubleshoot';chosen=fault;}
 else if(productSelection||accessorySelection||explicitOrder||continuation||/另一块屏|重新配单|另外.{0,5}配/.test(positive)){intent='ordering';action='plan-engineering';chosen=explicitOrder||[query];}
 else if(how){intent='operation';action='guide-operation';chosen=how;}
 else if(fastSemantics&&/(?:用|使用).{0,4}(?:什么|哪个|那个|哪款)软件|调试软件|使用方法|不会调试/.test(positive)){intent='operation';action='guide-operation';chosen=[query];}
 else if(parameter||propertyInquiry||fastSemantics&&/有.{1,20}[吗么?？]$/.test(positive)&&objects.some(o=>o.type==='software')){intent=software.length||objects.some(o=>o.type==='software')?'software-function':'parameters';action=intent==='software-function'?'ask-software-function':'query-parameters';chosen=parameter||[query];}
 else if(document||categories.some(c=>['firmware','video'].includes(c))&&(!fastSemantics||categories.includes('firmware')||/下载|获取|给我|帮我找|找一下|download/i.test(positive)||!positive.replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*/gi,'').replace(/固件|视频|[\s，。！？!?]/g,''))){intent='resources';action='find-resources';chosen=document||[query];}
 else if(geometry||/^P\s*\d+(?:\.\d+)?\s*(?:屏|全彩|室内|户外|的)?$/i.test(query)){intent='ordering';action='plan-engineering';chosen=[query];}
 else if(software.length){intent='software-function';action='ask-software-function';chosen=[software[0]];}
 else if(models.length){const free=query.replace(/^(?:Model|型号)\s*[:：]\s*/i,'').replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*/gi,'').replace(/[\s，,。.!！?？]/g,'');intent=free?'technical':'product';action=free?'ask-technical':'identify-product';chosen=[query];}
 else if(/芯片|智能设置|LED|HUB75|接收卡|模组|显示屏/i.test(query)){intent='technical';action='ask-technical';chosen=[query];}
 const parameterGoal=/(?:查|问|看|了解)[^，。；]{0,12}(?:参数|带载|灰阶)/.exec(positive),documentGoal=/(?:给|找|发|下载)[^，。；]{0,12}(?:说明书|规格书|手册)/.exec(positive);
 const alternatives=[];
 if(parameterGoal&&documentGoal&&/并且|同时|还要|再给|再找|再发|以及/.test(positive)){alternatives.push('query-parameters','find-resources');intent='clarify';action='clarify-multiple-actions';chosen=[query];missing.push('action-priority');}
 cite(action,chosen);
 if(intent==='compatibility'){if(deictic&&!/\.(?:bin|zip)\b/i.test(query))missing.push('referenced-file');if(!models.length)missing.push('device-model');missing.push('hardware-and-chip-scope');}
 if(intent==='parameters'&&!models.length&&!software.length)missing.push(objects.some(o=>o.type==='module')?'module-specification':'query-object');
 if(intent==='operation'&&!models.length&&!software.length)missing.push('operation-object');
 const parameterOverview=intent==='parameters'&&parameter&&parameter[0]==='参数'&&!topics.length;
 const answerNeed=parameterOverview?'parameter-overview':intent==='software-function'&&(/是什么|什么功能|哪些功能|功能介绍|软件功能|有什么用|干什么|用途|能干啥/.test(positive)||software.some(name=>query.toLowerCase()===name.toLowerCase()))?'software-overview':intent==='software-function'?'specific-software-capability':intent==='parameters'&&(capabilityInquiry||propertyInquiry&&/需要|必须/.test(positive))&&!/多少|多大|几级|几个|几路|几口/.test(positive)?'capability-confirmation':intent;
 return {intent,action,orderingKind:accessorySelection?'accessory':productSelection&&!explicitOrder&&!geometry?'catalog-selection':null,alternatives,objects,topics,answerNeed,reference:deictic?{text:deictic[0],resolved:intent==='compatibility'?false:models.length+software.length>0}:null,missing,reasons,original,categories,contextUsed:!!continuation,social:intent==='social'?/谢|thanks/.test(social)?'thanks':/谁|什么|功能/.test(social)?'capabilities':'greeting':null};
}
function decideAction(text,options={}){
 const original=String(text),frame=require('./intent-frames.cjs').analyzeFrames(original);
 const socialSignal=frame.clauses.length===1&&frame.clauses[0].tokens.some(t=>t.type==='social'&&t.start===0&&t.end===original.length);
 let decision=decideClause(frame.focusText,{...options,relations:frame.focusedRelations,lexicalSpans:frame.focusedSpans,socialSignal,reportSignal:frame.reportSignal,fastSemantics:true,operationSignal:frame.operationSignal,requestOperation:frame.requestOperation});
 if(frame.clauses.length&&frame.clauses.every(c=>c.role==='negated')&&!(options.orderingContext&&Object.values(parseOrderingFields(original).provenance||{}).some(p=>p.kind==='user-negated')))decision={...decision,intent:'clarify',action:'clarify-negated-request',missing:['positive-request'],reasons:[{rule:'only-negated-goal',text:original,start:0}]};
 const requests=frame.clauses.filter(c=>c.role==='request');
 if(requests.length>1&&frame.clauses.some(c=>c.tokens.some(t=>t.type==='conjunction'))){
  const goals=[...new Set(requests.map(c=>decideClause(c.text,{...options,relations:frame.relations.filter(r=>r.clauseStart===c.start).map(r=>({...r,predicate:{...r.predicate,start:r.predicate.start-c.start,end:r.predicate.end-c.start},target:r.target?{...r.target,start:r.target.start-c.start,end:r.target.end-c.start}:null})),lexicalSpans:c.tokens.map(t=>({...t,start:t.start-c.start,end:t.end-c.start}))}).action))].filter(a=>a!=='clarify');
  if(goals.length>1)decision={...decision,intent:'clarify',action:'clarify-multiple-actions',alternatives:goals,missing:['action-priority'],reasons:[{rule:'independent-clause-goals',text:original,start:0}]};
 }
 // The request focus can be the final clause (“按常规模组就行”). Screen facts
 // elsewhere in the same request still describe the engineering task.
 const fullFields=parseOrderingFields(original);
 const wholeOperation=/(?:怎么|如何|怎样|教我|步骤).{0,25}(?:存入|存到|拷到|拷贝|导出|发送|发布|更新|设置|复制|备份|调整|修改|连接)/.test(original);
 if(wholeOperation&&(options.software?.length||options.models?.length)&&!['aftersales','compatibility','resources','service'].includes(decision.intent)&&!/黑屏|花屏|发绿|闪烁|还闪|连不上|发送失败/.test(original))decision={...decision,intent:'operation',action:'guide-operation',missing:[],reasons:[{rule:'whole-request-operation',text:original,start:0}]};
 if(!['aftersales','compatibility','service','social'].includes(decision.intent)&&!/(?:查|找|下载|给我|发我).{0,8}(?:规格书|说明书|手册|固件|视频)|(?:怎么|如何).{0,12}(?:设置|发送|升级|导出)|黑屏|花屏|发绿|闪烁|还闪|连不上|发送失败/.test(original)&&require('./customer-meaning.cjs').orderingScene(original,fullFields)){
  decision={...decision,intent:'ordering',action:'plan-engineering',orderingKind:null,missing:[],alternatives:[],reasons:[{rule:'whole-request-screen-conditions',text:original,start:0}]};
 }
 return {...decision,original,focusText:decision.intent==='ordering'||wholeOperation&&decision.intent==='operation'?original:frame.focusText,frames:frame.clauses,relations:frame.relations,requestRelations:frame.focusedRelations,
  reasons:decision.reasons.map(r=>({...r,start:Math.max(0,original.indexOf(r.text)),rule:frame.changed?'request-scope:'+r.rule:r.rule}))};
}
function chatIntent(text,lookup,state={}){
 const query=String(text).normalize('NFKC').trim();let models=extractKnownModels(query,lookup),software=(lookup.softwareItems?.(query)||[]).map(x=>x.name);
 let decision=(state.expertHint?decideClause:decideAction)(String(text),{models,software,orderingContext:state.orderingContext});
 // A new explicit object in the selected request replaces objects mentioned
 // only as background. With no new object, keep the existing exact registry IDs.
 if(decision.focusText&&decision.focusText!==query){
  const focusedModels=extractKnownModels(decision.focusText,lookup),focusedSoftware=(lookup.softwareItems?.(decision.focusText)||[]).map(x=>x.name);
  if(focusedModels.length||focusedSoftware.length||!decision.reference&&decision.objects.some(o=>['interface','module'].includes(o.type))){models=focusedModels;software=focusedSoftware;decision=decideAction(String(text),{models,software,orderingContext:state.orderingContext});}
 }
 const unknownModels=(query.match(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+-]*/gi)||[]).filter(t=>!isTechnicalToken(t,query)&&!(/^(?:P|V|LS|ICN|ICND|SM|FM|MBI|HUB)\d/i.test(t))&&!extractKnownModels(t,lookup).length&&!lookup.isSoftware?.(t));
 const demand=['ordering','aftersales'].includes(decision.intent)?require('./deterministic-parser.cjs').parseInput(query,lookup,{decision}).demand:undefined;
 return {intent:decision.intent,query,models,software,unknownModels,decision,demand,social:decision.social,category:decision.categories[0]||null,hardwareRequested:/硬件(?:版本)?[：:\s]*[A-Za-z0-9]/i.test(query)};
}

// Expert hints never decide the meaning of an engineering request or restrict its tools.
function expertIntent(text,lookup,state={}){
 const hint=chatIntent(text,lookup,{expertHint:true});
 if(hint.intent==='social')return {...hint,decisionAuthority:'social-shortcut'};
 let remainder=hint.query.replace(/(?:不是|并非|无需|不需要|不用)(?:做)?(?:故障排查|故障诊断|故障|售后排查)/g,'');
 remainder=remainder.replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+-]*/gi,token=>extractKnownModels(token,lookup).length?'':token);
 remainder=remainder.replace(/请给我|请提供|帮我找|给我|查询|查找|下载|我要|需要|请|的|一份|一下|说明书|手册|规格书|固件|中文|英文|即可|版本|资料|[\s，,。.!！?？、：:]/g,'');
 const simple=hint.intent==='resources'&&hint.models.length===1&&!hint.unknownModels.length&&!remainder;
 const history=(state.messages||[]).filter((m,i,a)=>m.role==='user'&&!(i===a.length-1&&m.content===text)).slice(-6);
 return {...hint,intent:simple?'resources':'technical',hintIntent:hint.intent,simpleResource:simple,decisionAuthority:simple?'simple-resource-shortcut':'bonsai',contextModels:[...new Set(history.flatMap(m=>extractKnownModels(m.content||'',lookup)))]};
}
module.exports={chatIntent,expertIntent,decideAction,resourceCategories};
