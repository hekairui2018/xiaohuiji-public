'use strict';
const {extractKnownModels}=require('../identity/extract-models.cjs');
// Controlled retrieval vocabulary; these are lexical clues, never diagnoses.
const concepts=[
 {id:'load',type:'attribute',words:['带载','控制范围','像素','load','control range']},
 {id:'width',type:'attribute',words:['宽高','长宽高','宽度','高度','最宽','最高','长宽','水平','垂直','width','height','horizontal','vertical']},
 {id:'ports',type:'attribute',words:['接口','网口','HDMI','HUB75','USB','端口','interface','port']},
 {id:'function',type:'attribute',words:['功能','支持','音频','4G','播放','function','support']},
 {id:'flicker',type:'symptom',words:['闪烁','闪屏','频闪','一直闪','flicker']},
 {id:'color',type:'symptom',words:['颜色异常','颜色不正常','颜色不对','偏色','色差','变色','色块','color abnormal']},
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
const categories=[['manual',/说明书|手册|manual/i],['spec',/规格书|技术规格|datasheet|specification/i],['firmware',/固件|firmware|\.bin\b/i],['software',/软件|安装包|客户端|HDSet|HDPlayer|HDShow|HDSign/i],['video',/视频|教程|演示/i]];
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/wi[\s-]?fi/g,'wifi');
function parseQuickQuery(message,lookup,state={}){
 const original=String(message).trim(),social=original.replace(/[\s，。！？!?,.～~]/g,'').toLowerCase();
 if(/^(?:你好|您好|嗨|哈喽|hello|hi|谢谢|多谢|感谢|thanks|你是谁|你能做什么|你有什么功能)(?:呀|啊|哦|了)?$/.test(social))return {original,query:original,social:true,models:[],concepts:[],categories:[]};
 const followup=/^(?:还是这样|还是一样|仍然如此|没有改善|没用|换了也没用|依旧如此)[。！!？?\s]*$/.test(original);
 const prior=(state.messages||[]).filter((m,i,a)=>m.role==='user'&&!(i===a.length-1&&m.content===original)).slice(-3);
 const context=followup?prior.findLast(m=>! /^(?:还是这样|还是一样|没用)/.test(m.content))?.content:null;
 const query=context?context+'；本次反馈：'+original:original;
 const deniedFault=/(?:不要|不是|并非|无需|不需要|不用)(?:做)?(?:故障排查|故障诊断|故障|售后排查)/.test(query);
 const active=query.replace(/(?:不要|不是|并非|无需|不需要|不用)(?:做)?(?:故障排查|故障诊断|故障|售后排查)/g,'');
 const models=extractKnownModels(active,lookup),normalized=norm(active);
 const found=concepts.filter(c=>c.words.some(w=>normalized.includes(norm(w))));
 const cats=categories.filter(([,re])=>re.test(active)).map(([key])=>key);
 const compatibility=/通用|兼容|互刷|混用|跨型号/.test(active);
 // Numbers attached to model identities remain intact. Explicit labelled versions
 // are constraints; an unlabelled number is not interpreted as a hardware version.
 const versions=[...active.matchAll(/(?:硬件(?:版本)?|固件(?:版本)?|版本)[：:\s]*V?(\d+(?:[._]\d+)+)/gi)].map(m=>({kind:/硬件/.test(m[0])?'hardware':/固件/.test(m[0])?'firmware':'version',value:m[1]}));
 const chips=[...active.matchAll(/\b(?:ICND?|SM|FM|LS|DP|MBI|TC|RUL|RUC)\d{3,5}[A-Z0-9]*\b/gi)].map(m=>m[0].toUpperCase());
 const unknownModels=(active.match(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+-]*/gi)||[]).filter(t=>!extractKnownModels(t,lookup).length&&!/^(?:P|V|ICND?|SM|FM|LS|DP|MBI|TC|HUB)\d/i.test(t)&&!lookup.isSoftware?.(t));
 let free=active.replace(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+.-]*/gi,' ');
 for(const c of found)for(const w of c.words)free=free.split(w).join(' ');
 free=free.replace(/请问|请|帮我|我只要|不要|只要|想要|查询|资料|说明书|规格书|固件|技术|问题|多少|最大|可以|怎么|如何|什么|有没有|完全|对应|没有|的|了|吗|我|是|这|个|公司|屏幕|显示屏|LED|控制卡|接收卡|发送卡|正常|但|并|和|还|一直|本次反馈/gi,' ');
 const literals=[...new Set(free.match(/[a-z]{3,}|[\u3400-\u9fff]{2,}/gi)||[])].slice(0,5);
 const discoveryTarget=found.some(c=>c.id==='wifi')&&found.some(c=>c.id==='discovery')?/(?:搜不到|搜索不到|找不到|发现不了|无法找到)[^。；\n]{0,4}设备/.test(active)?'device':'ssid':null;
 return {original,query,contextUsed:!!context,contextQuery:context||null,models,unknownModels,categories:cats,concepts:found.map(c=>c.id),attributes:found.filter(c=>c.type==='attribute').map(c=>c.id),symptoms:deniedFault?[]:found.filter(c=>c.type==='symptom').map(c=>c.id),discoveryTarget,deniedFault,compatibility,versions,chips,literals,social:false};
}
function matchesConcept(id,text){const c=concepts.find(c=>c.id===id),s=norm(text);return !!c&&c.words.some(w=>s.includes(norm(w)));}
module.exports={parseQuickQuery,matchesConcept,concepts,norm};
