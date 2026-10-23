'use strict';
const {extractKnownModels,numericModelCandidates,isTechnicalToken}=require('../identity/extract-models.cjs');
const {chatIntent}=require('../parser/chat-intent.cjs');
const {canonical,evidencePlan}=require('./evidence-plan.cjs');
// Controlled retrieval vocabulary; these are lexical clues, never diagnoses.
const {phenomenonWords}=require('../parser/intent-frames.cjs');
const concepts=[
 {id:'program-send',type:'topic',words:['发送节目','节目发送','发布节目','发送失败','发布失败','发送不了','发不出去']},
 {id:'password',type:'topic',words:['密码','口令','password']},
 {id:'power-schedule',type:'topic',words:['定时开关机','开关机时间','定时开关屏']},
 {id:'brightness',type:'topic',words:['亮度','色度']},
 {id:'battery',type:'attribute',words:['电池']},
 {id:'program-cycle',type:'topic',words:['循环播放','播放一次','节目单']},
 {id:'usb',type:'topic',words:['U盘','USB','优盘']},
 {id:'white-screen',type:'symptom',words:['白屏']},
 {id:'red-dots',type:'symptom',words:['红点','红色亮点','红色点']},
 {id:'no-output',type:'symptom',words:['没有输出','无输出']},
 {id:'ghost',type:'symptom',words:phenomenonWords},
 {id:'grayscale',type:'attribute',words:['灰阶','灰度等级','灰度级','grayscale','gray level','gray scale','grey scale']},
 {id:'size',type:'attribute',words:['尺寸','分辨率','大小']},
 {id:'load',type:'attribute',words:['带载','控制范围','像素','load','control range','代载']},
 {id:'width',type:'attribute',words:['宽高','长宽高','宽度','高度','最宽','最高','长宽','水平','垂直','width','height','horizontal','vertical']},
 {id:'ports',type:'attribute',words:['接口','网口','HDMI','HUB75','USB','端口','interface','port']},
 {id:'function',type:'attribute',words:['功能','支持','音频','4G','播放','function','support']},
 {id:'flicker',type:'symptom',words:['闪烁','闪屏','频闪','一直闪','还闪','flicker']},
 {id:'color',type:'symptom',words:['颜色异常','颜色不正常','颜色不对','偏色','色差','变色','色块','发绿','发红','发蓝','color abnormal']},
 {id:'black',type:'symptom',words:['黑屏','不亮','无显示','black screen']},
 {id:'garbled',type:'symptom',words:['花屏','乱码','garbled']},
 {id:'discovery',type:'symptom',words:['搜不到','搜索不到','找不到','无法搜索','不广播','发现不了']},
 {id:'network',type:'symptom',words:['连不上','连接失败','掉线','离线','断网']},
 {id:'upgrade-failure',type:'symptom',words:['升级失败','刷机失败','刷不上','烧录失败']},
 {id:'application-failure',type:'symptom',words:['闪退','崩溃','无响应','打不开','卡死']},
 {id:'wifi',type:'topic',words:['Wi-Fi','wifi','无线','SSID','热点']},
 {id:'cable',type:'topic',words:['排线','网线','接线','接触','cable']},
 {id:'local',type:'scope',words:['局部','右边','左边','几排','部分区域','local']}
];
const norm=canonical;
function parseQuickQuery(message,lookup,state={}){
 const {decideTask}=require('../parser/task-context.cjs');
 const interpretation=require('../parser/customer-language.cjs').interpretCustomerText(message);
 const task=decideTask(interpretation.query,lookup,state);
 task.original=interpretation.original;
 const context=task.target?.context;
 const scoped={...state,messages:[],currentIntent:task.reason==='explicit-analysis-continuation'?chatIntent(task.executionText,lookup):task.raw,retrievalHistory:context?[{quickContext:{...context,ordering:task.ordering?task.target.ordering:null}}]:[]};
 const result=parseScopedQuery(task.executionText,lookup,scoped);
 if(task.ordering){result.intent='ordering';result.models=[];result.chips=[];result.orderingContext=task.target?.ordering||null;result.demand={schemaVersion:'2.0',operation:'ordering',topic:String(message),...task.delta,provenance:{...task.delta.provenance}};result.taskUpdate=task.update;result.decision={...result.decision,intent:'ordering',action:'plan-engineering',orderingKind:task.target?null:task.raw.decision.orderingKind,missing:[],contextUsed:!!task.target};}
 if(task.target&&task.target.type!=='ordering'&&['product','technical'].includes(task.raw.intent)&&['CONTINUE','CORRECT'].includes(task.relation)){
  result.intent=task.target.context.intent;result.decision.intent=result.intent;
  const inherited=task.target.context.retrieval||{};
  result.categories=inherited.categories||chatIntent(task.target.context.query||'',lookup).decision.categories;
  result.attributes=inherited.attributes||concepts.filter(c=>c.type==='attribute'&&c.words.some(w=>norm(task.target.context.query||'').includes(norm(w)))).map(c=>c.id);
  result.decision.reasons=[{rule:'task-owned-action',text:result.original,start:0,taskId:task.taskId}];
  result.evidencePlan=evidencePlan(result);
 }
 if(task.relation==='NEW_TOPIC')result.orderingContext=null;
 result.answerQuestion=task.reason==='explicit-analysis-continuation'?task.target?.context?.query:null;
 result.original=String(message).trim();result.interpretation=interpretation;result.executionText=task.executionText;
 Object.defineProperty(result,'taskPlan',{value:task});result.decision.taskRelation={relation:task.relation,taskId:task.taskId,reason:task.reason};
 if(task.reason==='multiple-actions'){result.decision.missing=[...new Set([...result.decision.missing,'action-priority'])];result.decision.alternatives=task.raw.decision.alternatives?.length?task.raw.decision.alternatives:['plan-engineering',task.raw.decision.action];}
 if(task.ordering)result.decision.reasons=[{rule:'task-owned-engineering-update',text:result.original,start:0,taskId:task.taskId,operations:task.update.operations.map(o=>({op:o.op,path:o.path}))}];
 result.contextUsed=!!task.target;return result;
}
function parseScopedQuery(message,lookup,state={}){
 const original=String(message).trim();
 const previous=(state.retrievalHistory||[]).findLast(r=>r.quickContext)?.quickContext;
 const orderingContext=previous?.ordering||null;
 const initial=state.currentIntent||chatIntent(original,lookup,{orderingContext});
 if(initial.intent==='social')return {original,query:original,intent:'social',social:true,models:[],concepts:[],categories:[],orderingContext,decision:initial.decision};
 const followup=require('../parser/task-context.cjs').isOutcomeUpdate(original);
 // Task ownership has already been resolved. Inherit typed identities only;
 // do not concatenate old chat and run another intent classification over it.
 let context=null;
 const numeric=/^\d+$/.test(original),numericCandidates=numeric?numericModelCandidates(original,lookup.products?.()||[]):[];
 const chipRecord=lookup.chipLookup?.(original),chipCandidates=chipRecord?.items||[];
 const ambiguous=numeric&&(numericCandidates.length+new Set(chipCandidates.flatMap(c=>c.models)).size>1);
 const currentSoftware=lookup.softwareItems?.(original)||[];
 if(followup&&previous?.query)context=previous.query;
 if(initial.intent==='product'&&previous?.intent==='resources'&&previous.chips?.length&&!previous.models?.length&&/固件|升级包/.test(previous.query||''))context=[...previous.chips,previous.query].join(' ');
 const entityCorrection=initial.models.length&&/说错|不是.{0,20}[，,].{0,4}是|型号改为/.test(original)&&['technical','product'].includes(initial.intent)&&['parameters','resources','operation','compatibility','software-function'].includes(previous?.intent);
 if(entityCorrection)context=previous.query.replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*/gi,' ');
 const newTopicObject=!initial.decision.reference&&initial.decision.objects.some(o=>['interface','module'].includes(o.type)||o.type==='software'&&previous?.models?.length);
 if(!context&&!newTopicObject&&!initial.models.length&&!initial.unknownModels?.length&&!numeric&&!chipCandidates.length&&!currentSoftware.length){
  const last=previous;
  if(last&&(last.models?.length||last.software?.length||last.chips?.length))context=[...(last.models||[]),...(last.software||[]),...(last.chips||[])].join(' ');
 }
 const query=followup&&previous?.query?previous.query:original;
 const deniedFault=/(?:不要|不是|并非|无需|不需要|不用)(?:做)?(?:故障排查|故障诊断|故障|售后排查)/.test(query);
 let active=query.replace(/(?:不要|不是|并非|无需|不需要|不用)(?:做)?(?:故障排查|故障诊断|故障|售后排查)/g,'');
 active=active.replace(/(?:不是|说错了?)[ ]*(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*(?=[，,])/gi,'').replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*说错了?[，,]/gi,'');
 const scope=initial.decision.focusText&&initial.decision.focusText!==original?initial.decision.focusText:active;
 const models=(scope!==active?[...initial.models]:extractKnownModels(active,lookup));
 if(!models.length&&context)models.push(...previous?.models||[]);
 const normalized=norm(scope);
 if(!ambiguous&&numericCandidates.length===1&&!chipCandidates.length)models.push(numericCandidates[0].modelId);
 const found=concepts.filter(c=>c.words.some(w=>normalized.includes(norm(w))));
 if(/(?:控制|带载|带|拖|驱动).{0,8}(?:多少|几).{0,3}(?:点|像素|模组|板)/.test(scope)&&!found.some(c=>c.id==='load'))found.push(concepts.find(c=>c.id==='load'));
 const routed=followup&&previous?{...initial,intent:previous.intent,decision:{...initial.decision,intent:previous.intent,action:previous.intent==='aftersales'?'troubleshoot':initial.decision.action,missing:[]}}:initial;
 const cats=routed.decision.categories;
 const compatibility=routed.intent==='compatibility';
 // Numbers attached to model identities remain intact. Explicit labelled versions
 // are constraints; an unlabelled number is not interpreted as a hardware version.
 const versions=[...active.matchAll(/(?:硬件(?:版本)?|固件(?:版本)?|版本)[：:\s]*V?(\d+(?:[._]\d+)+)/gi)].map(m=>({kind:/硬件/.test(m[0])?'hardware':/固件/.test(m[0])?'firmware':'version',value:m[1]}));
 const chips=[...active.matchAll(/\b(?:ICND?|SM|FM|LS|DP|MBI|TC|RUL|RUC)\d{3,5}[A-Z0-9]*\b/gi)].map(m=>m[0].toUpperCase());
 if(context&&!chips.length)chips.push(...previous?.chips||[]);
 let unknownModels=(active.match(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+-]*/gi)||[]).filter(t=>!isTechnicalToken(t,active)&&!require('../identity/extract-models.cjs').isIdentifierDetail(t,active)&&!extractKnownModels(t,lookup).length&&!/^(?:P|V|ICND?|SM|FM|LS|DP|MBI|TC|HUB)\d/i.test(t)&&!lookup.isSoftware?.(t)&&!/^(?:HDMI|DP|SDI|USB|HUB)\d/i.test(t));
 if(!unknownModels.length&&!models.length&&!currentSoftware.length)unknownModels=[...(initial.unknownModels||[])];
 let free=active.replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*/gi,' ');
 for(const c of found)for(const w of c.words)free=free.split(w).join(' ');
 free=free.replace(/请问|请|帮我|我只要|不要|只要|想要|查询|资料|说明书|规格书|固件|技术|问题|多少|最大|可以|怎么|如何|什么|有没有|完全|对应|没有|的|了|吗|我|是|这|个|公司|屏幕|显示屏|LED|控制卡|接收卡|发送卡|正常|但|并|和|还|一直|本次反馈/gi,' ');
 const literals=[...new Set(free.match(/[a-z]{3,}|\d{3,}|[\u3400-\u9fff]{2,}/gi)||[])].slice(0,5);
 const discoveryTarget=found.some(c=>c.id==='wifi')&&found.some(c=>c.id==='discovery')?/(?:搜不到|搜索不到|找不到|发现不了|无法找到)[^。；\n]{0,4}设备/.test(active)?'device':'ssid':null;
 const route=routed,attributes=route.intent==='parameters'?found.filter(c=>c.type==='attribute').map(c=>c.id):[],symptoms=route.intent==='aftersales'&&!deniedFault?found.filter(c=>c.type==='symptom').map(c=>c.id):[];
 // A symptom modifying an attribute (e.g. gray-level + abnormal) keeps
 // that attribute as a retrieval signal without turning every attribute into a fault.
 if(route.intent==='aftersales'&&!deniedFault)for(const relation of route.decision.requestRelations||route.decision.relations||[]){
  if(relation.role==='negated'||relation.predicate.type!=='symptom'||relation.target?.type!=='attribute')continue;
  for(const c of concepts)if(c.type==='attribute'&&c.words.some(w=>norm(relation.target.text).includes(norm(w)))&&!symptoms.includes(c.id))symptoms.push(c.id);
 }
 if(route.decision.answerNeed==='parameter-overview'&&!attributes.length)attributes.push('load','ports','size','grayscale');
 const operation=route.intent==='operation',selectSoftware=operation&&(/(?:用|使用|在).{0,4}(?:什么|哪个|那个|哪款)软件|调试软件|配套软件|的软件|手机软件|软件名/.test(active)||/手机.{0,6}(?:APP|软件)/i.test(active)),upgrade=operation&&/升级|烧录/.test(active),sendProgram=operation&&/发送.*节目|节目.*发送|(?:更新|发布|拷贝|导出|存入|存到).{0,10}节目|节目.{0,20}(?:更新|发布|拷|导出|存到|存入)/.test(active);
 const software=[...new Set([...(route.software||[]),...(context&&!currentSoftware.length?previous?.software||[]:[])])];
 const intent=ambiguous?'ambiguous':numeric&&numericCandidates.length===1&&!chipCandidates.length?'product':chipCandidates.length&&['technical','clarify'].includes(route.intent)||chips.length&&['technical','clarify'].includes(route.intent)?'chip':software.length&&route.intent==='parameters'?'software-function':route.intent;
 const decision={...route.decision,intent,original,contextUsed:!!context||route.decision.contextUsed};
 if(selectSoftware)decision.missing=decision.missing.filter(key=>key!=='operation-object');
 if(intent==='chip'&&route.intent!=='chip')Object.assign(decision,{action:'identify-chip',reasons:[{rule:'registered-chip-identity',text:original,start:0}]});
 if(numeric&&intent==='product')Object.assign(decision,{action:'identify-product',reasons:[{rule:'registered-numeric-model-core',text:original,start:0}]});
 if(ambiguous)Object.assign(decision,{action:'clarify-identity',missing:['identity-choice']});
 decision.reasons=decision.reasons.map(r=>original.includes(r.text)?r:{rule:'context-inherited-action',text:original,start:0,contextSource:previous?.query||context});
 if(!ambiguous&&chipCandidates.length===1)chips.push(...chipCandidates[0].models);
 decision.objects=[...new Map([...decision.objects,...models.map(id=>({type:"product",id})),...chips.map(id=>({type:"chip",id})),...software.map(id=>({type:"software",id}))].map(o=>[o.type+":"+(o.id||o.text),o])).values()];
 const resourceConstraints={language:/只要中文|中文版|中文资料|中文规格|中文手册/.test(original)?'zh':/英文/.test(original)?'en':null,extension:/PDF(?:格式)?/i.test(original)?'pdf':null,subject:/\bSDK\b|\bAPI\b/i.test(original)?'sdk-api':null};
 const result={original,query,intent,decision,resourceConstraints,orderingContext,demand:route.demand,contextUsed:decision.contextUsed,contextQuery:context||null,models:[...new Set(models)],unknownModels,categories:cats,concepts:found.map(c=>c.id),attributes:intent==='parameters'?attributes:[],symptoms,discoveryTarget,deniedFault,compatibility,versions,chips:[...new Set(chips)],literals,social:false,software,numeric,numericCandidates,chipCandidates:chipCandidates.map(c=>({models:c.models,sourceReference:c.sourceReference})),ambiguous,operation:operation?{upgrade,sendProgram,selectSoftware,terms:selectSoftware?['软件']:upgrade?['升级','接收卡']:sendProgram?['节目更新']:found.some(c=>['password','power-schedule','brightness','usb'].includes(c.id))?found.filter(c=>['password','power-schedule','brightness','usb'].includes(c.id)).map(c=>c.words[0]):literals.filter(w=>!software.some(s=>norm(s)===norm(w)))}:null};
 result.evidencePlan=evidencePlan(result);if(result.operation&&result.evidencePlan.terms.length)result.operation.terms=result.evidencePlan.terms;return result;
}
function matchesConcept(id,text){const c=concepts.find(c=>c.id===id),s=norm(text);return !!c&&c.words.some(w=>s.includes(norm(w)));}
module.exports={parseQuickQuery,matchesConcept,concepts,norm};
