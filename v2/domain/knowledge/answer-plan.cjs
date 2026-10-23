'use strict';
// Reuses the same parsed question as quick retrieval. The model writes an
// answer from read evidence; it need not spend another call inventing a query.
function uncertainIdentity(text){
 return /(?:型号|照片|丝印|标签).{0,15}(?:不清|看不清|不确定)|(?:像|可能是).{0,12}[A-Za-z]\w*\d\w*.{0,12}(?:也可能|或者|或是)/.test(text);
}
function answerPlan(q,{documents=[]}={}){
 if(uncertainIdentity(q.original))return {identityUncertain:true,search:null};
 if(q.intent==='ordering'||q.social)return {search:null};
 if(q.intent==='compatibility')return {purpose:'compatibility',search:null,scope:'先明确回答：现在不能确认兼容，不要直接刷。型号、硬件版本和原固件身份须核对，芯片相同也不足以证明通用。客户已说不知道芯片，不重复索要芯片；只问清晰丝印图片或现有固件信息，不举未经提供的版本号示例。不检索无关产品参数。'};
 const parameterWords={load:'带载',size:'尺寸',width:'宽高',ports:'接口',grayscale:'灰度等级',brightness:'亮度',function:'功能',battery:'电池'};
 const operation=q.intent==='operation'||q.intent==='software-function';
 let terms=q.intent==='parameters'?q.attributes.map(a=>parameterWords[a]).filter(Boolean):operation?(q.evidencePlan?.terms||q.operation?.terms||[]):q.literals||[];
 if(operation&&/U盘|优盘|u盘/i.test(q.original)&&/节目|播放/.test(q.original))terms=['U盘','节目更新'];
 if(!terms.length)terms=(q.concepts||[]).filter(x=>x.length<=16).slice(0,3);
 const objects=[...q.models,...q.software];
 const query=[...objects,...terms].join(' ').trim()||q.query.slice(0,180);
 const manualNames=operation&&q.software.length?documents.filter(d=>/说明书|手册|manual/i.test(d.name)&&q.software.some(s=>d.name.toLowerCase().includes(s.toLowerCase()))).map(d=>d.name).slice(0,4):[];
 return {purpose:q.intent,...(q.intent==='parameters'?{scope:'只答当前型号所问参数及原文注明的限制。版本不同分别引用，不添加未记载条件；不要求客户提供配单尺寸，不扩展无关接口或功能。'}:operation?{scope:'只给本次操作所需的前提、步骤和完成标志，最多三个步骤。回答客户的后续操作问题，不扩展其他型号、延长线长度或无关联网方式。没有所用设备适用证据时明确说明。'}:{}),search:{action:'search',query:query.slice(0,240),kind:q.intent==='parameters'?'products':q.intent==='resources'?'resources':q.intent==='aftersales'?'cases':'text',
  ...(operation?{role:'operation'}:{}),models:q.models,concepts:terms.slice(0,5),goals:['回答当前问题并保留适用条件'],...(manualNames.length?{documents:manualNames}:{})}};
}
module.exports={answerPlan,uncertainIdentity};
