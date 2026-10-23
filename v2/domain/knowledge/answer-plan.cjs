'use strict';
// Reuses the same parsed question as quick retrieval. The model writes an
// answer from read evidence; it need not spend another call inventing a query.
function uncertainIdentity(text){
 return /(?:型号|照片|丝印|标签).{0,15}(?:不清|看不清|不确定)|(?:像|可能是).{0,12}[A-Za-z]\w*\d\w*.{0,12}(?:也可能|或者|或是)/.test(text);
}
function answerPlan(q,{documents=[]}={}){
 if(q.answerQuestion)q={...q,original:q.answerQuestion,interpretation:{...q.interpretation,query:q.answerQuestion}};
 if(uncertainIdentity(q.original))return {identityUncertain:true,search:null};
 if(q.intent==='ordering'||q.social)return {search:null};
 const clarification=require('./question-requirements.cjs').clarificationPlan(q);
 if(clarification)return {purpose:'clarification',search:null,scope:clarification.scope,questionGuide:clarification.question};
 if(q.intent==='service')return {purpose:'service',search:null,scope:'当前未接入实时人工转接、维修工单、出厂日期或销售联系人查询。本轮沿用客户提供的型号及编号，明确能整理信息但不能声称已转接/报修/查到出厂日期，不猜测日期、价格或联系方式。只问确实缺少的服务条件。'};
 if(q.intent==='compatibility'&&!/固件|刷|升级|烧录|芯片|译码/.test(q.original))return {purpose:'compatibility',search:null,scope:'客户询问设备或系统能否互联。只说明尚不能确认；沿用已给的双方名称，追问缺少的具体系统型号或连接接口。不要套用固件互刷、芯片或硬件丝印的核对流程，不重复询问已给型号。'};
 if(q.intent==='compatibility')return {purpose:'compatibility',search:null,scope:'先明确回答：现在不能确认兼容，不要直接刷。型号、硬件版本和原固件身份须核对，芯片相同也不足以证明通用。客户已说不知道芯片，不重复索要芯片；只问清晰丝印图片或现有固件信息，不举未经提供的版本号示例。不检索无关产品参数。'};
 const parameterWords={load:'带载',size:'尺寸',width:'宽高',ports:'接口',grayscale:'灰度等级',brightness:'亮度',function:'功能',battery:'电池'};
 const operation=q.intent==='operation'||q.intent==='software-function';
 const required=require('./question-requirements.cjs').requirements(q);
 let terms=q.intent==='parameters'?(q.attributes.length?q.attributes.map(a=>parameterWords[a]).filter(Boolean):q.literals||[]):operation?(q.evidencePlan?.terms||q.operation?.terms||[]):q.literals||[];
 if(q.intent==='parameters'&&required.interfaces.length)terms=[...required.interfaces,...required.terms];
 if(operation&&required.terms.length)terms=required.terms;
 if(operation&&required.softwareSelection&&!required.terms.length)terms=required.phone?['手机控屏','APP']:required.objectClass==='receiver'?['接收卡','固件升级']:['应用软件','软件'];
 if(operation&&/U盘|优盘|u盘/i.test(q.original)&&/节目|播放/.test(q.original))terms=['U盘','节目更新'];
 if(!terms.length)terms=(q.concepts||[]).filter(x=>x.length<=16).slice(0,3);
 if(!terms.length)terms=[...q.models,...q.software].map(s=>s.replace(/^HD-/,''));
 if(!terms.length)terms=[q.original.slice(0,32)];
 const objects=[...q.models,...q.software];
 const query=[...objects,...terms].join(' ').trim()||q.query.slice(0,180);
 let manualNames=operation&&q.software.length?documents.filter(d=>/说明书|手册|操作说明|使用说明|manual/i.test(d.name)&&q.software.some(s=>d.name.toLowerCase().includes(s.toLowerCase()))).map(d=>d.name).slice(0,4):[];
 if(operation&&required.softwareSelection&&required.objectClass==='receiver')manualNames=documents.filter(d=>/HDSet|接收卡/i.test(d.name)&&/说明|手册|manual/i.test(d.name)).map(d=>d.name).slice(0,4);
 if(operation&&required.softwareSelection&&required.phone&&!q.models.length)manualNames=documents.filter(d=>/屏掌控/.test(d.name)&&/说明|手册|manual/i.test(d.name)).map(d=>d.name).slice(0,4);
 return {purpose:q.intent,requirements:required,...(q.intent==='parameters'?{scope:'只答当前型号所问参数及原文注明的限制。版本不同分别引用，不添加未记载条件；不要求客户提供配单尺寸，不扩展无关接口或功能。'}:operation?{scope:required.softwareSelection&&required.tasks.length?'客户要执行具体操作所用的软件及入口。直接引用已读手册回答软件名称、用途、版本条件和入口；入口未取到时具体说明缺项，不能先反问所用软件。不要把产品事实放在question里绕开引用。':required.softwareSelection?'客户只问使用哪款软件。只用一条已读证据回答软件名称、用途和适用条件，不给升级步骤，不引入其他示例设备，不要求先提供型号才告知有依据的软件名；若已能回答，question留空。':'只给本次操作所需的前提、步骤和完成标志，按原文顺序保留全部必要步骤。回答客户的后续操作问题，不扩展其他型号、延长线长度或无关联网方式。没有所用设备适用证据时明确说明。'}:{}),search:{action:'search',query:query.slice(0,240),kind:q.intent==='parameters'?'products':q.intent==='resources'?'resources':q.intent==='aftersales'?'cases':'text',
  ...(operation?{role:required.softwareSelection?'text':'operation'}:{}),models:q.models,concepts:terms.slice(0,5),goals:['回答当前问题并保留适用条件'],...(manualNames.length?{documents:manualNames}:{})}};
}
module.exports={answerPlan,uncertainIdentity};
