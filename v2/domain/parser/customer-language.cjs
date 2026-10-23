'use strict';
// Interpret a small, auditable vocabulary. Never fuzzy-correct identifiers,
// numbers, versions, filenames or quoted text into confirmed business facts.
const variants=new Map([
 ['分辩率','分辨率'],['分辨绿','分辨率'],['代载','带载'],['代栽','带载'],['带栽','带载'],
 ['接受卡','接收卡'],['接手卡','接收卡'],['灰接','灰阶'],['固健','固件'],['固见','固件'],
 ['频幕','屏幕'],['模阻','模组'],['摸组','模组']
]);
function interpretCustomerText(value){
 const original=String(value),corrections=[];
 const protectedRanges=[...original.matchAll(/https?:\/\/\S+|[^\s，。；：:,;!?！？"'“”‘’「」『』]+\.[a-z][a-z0-9]{0,9}\b|["'“‘「『][^"'”’」』]*["'”’」』]/gi)].map(m=>[m.index,m.index+m[0].length]);
 const query=original.replace(new RegExp([...variants.keys()].join('|'),'g'),(from,index)=>{
  if(protectedRanges.some(([start,end])=>index>=start&&index<end))return from;
  const to=variants.get(from);corrections.push({from,to,start:index,end:index+from.length,basis:'controlled-vocabulary'});return to;
 });
 return {original,query,corrections};
}
function expertTaskContext(state){
 const store=state.taskState||state.retrievalHistory?.findLast(r=>r.quickContext?.taskState)?.quickContext.taskState;
 if(!store)return null;
 const task=store.tasks?.find(t=>t.id===store.activeId);
 if(!task)return {activeId:null};
 // Candidate BOMs, topology, raw tool traces and suspended tasks are not facts.
 return {activeId:store.activeId,type:task.type,query:task.context?.query||null,
  models:task.context?.models||[],chips:task.context?.chips||[],
  confirmed:task.ordering?.confirmed||null,
  pending:(task.ordering?.pending||[]).map(p=>({path:p.path,question:p.question})),
  provenance:'task-record; only customer-confirmed fields, not a source for product claims'};
}
function diagnosticContext(message,state,route){
 const task=expertTaskContext(state),hint=route?.hintIntent||route?.intent;
 const faultWords=/黑屏|花屏|闪烁|闪屏|还闪|发绿|发红|颜色不正常|局部异常|异常位置|不亮/;
 const followup=/下一步|接下来|继续|先.{0,8}(?:查|核对)|排线|互换|重插|直连|直接接|异常位置|试过|更换|替换|跟着|跟随|移动|恢复|还是/;
 const previous=(state.messages||[]).filter(m=>m.role==='user').map(m=>m.content);if(previous.at(-1)===message)previous.pop();
 // A diagnostic task survives a short technical follow-up. Independent product,
 // download and ordering requests do not inherit its topology or tests.
 const related=followup.test(message)&&!['parameters','resources','product','ordering','chip','software-function','compatibility','service'].includes(hint);
 const prior=[...(state.diagnosticState?.customerQuotes||((related&&faultWords.test(previous.at(-1)||''))?previous.slice(-1):[]))];if(prior.at(-1)===message)prior.pop();
 const fault=hint==='aftersales'||related&&(task?.type==='aftersales'||prior.length>0);
 if(!fault)return null;
 const currentModels=route?.models||[],priorModels=state.diagnosticState?.models||[];
 const changedObject=currentModels.length&&priorModels.length&&!currentModels.some(m=>priorModels.includes(m));
 const quotes=[...(!changedObject&&related||!changedObject&&hint==='aftersales'?prior:[]),message].slice(-6);
 const text=quotes.join('；');
 let symptomDomain=null;for(const quote of quotes){if(faultWords.test(quote)||/(?:屏|模组).{0,8}不亮/.test(quote))symptomDomain='screen-display';if(/(?:连不上|找不到|搜不到|搜索不到).{0,8}(?:设备|控制卡)|(?:节目|发送).{0,8}(?:失败|不成功)/.test(quote))symptomDomain='software-or-delivery';}
 let topology=null;
 for(const clause of text.split(/[，。；;！!?？]/)){
  if(/^(?:不是|没有|未|还没|不接)/.test(clause.trim())){if(/(?:外接|独立).{0,12}接收卡/.test(clause)&&topology==='independent-receiver')topology=null;continue;}
  if(/如果|假如|假设|要是|若|是不是|是否|会不会|可能|或许|也许/.test(clause)||/[吗么]\s*$/.test(clause))continue;
  if(/(?:外接|独立|级联|串接).{0,12}接收卡|(?:用|接|带).{0,8}R\d{3}[A-Z]?/i.test(clause))topology='independent-receiver';
  if(/(?:直连|直接带|直接接|板载).{0,12}模组/.test(clause))topology='controller-direct-to-module';
 }
 const confirmedTopology=topology!==null;
 const completed=text.split(/但是|不过|但|[，。；;！!?？]/).filter(c=>!/(?:还没|没有|尚未|未曾|不曾|没试|准备|打算).{0,12}(?:互换|对调|交换|替换|重插|重新插)/.test(c)).join('；');
 const reseated=/(?:排线|网线).{0,12}(?:重新插|重插|插过|重接)|(?:重新插|重插).{0,12}(?:排线|网线)/.test(completed);
 const completedTests={ribbon:false,module:false,receiver:false};
 for(const clause of completed.split('；'))for(const action of clause.matchAll(/互换|对调|交换|替换|更换/g)){
  if(!/(?:已经|已|试过|做过)|(?:过|后|了|无效|一样|正常|异常)/.test(clause))continue;
  if(/替换|更换/.test(action[0])&&!/同规格|已知正常|备用|备件|对照|测试/.test(clause))continue;
  const forward=clause.slice(action.index+action[0].length,action.index+action[0].length+20).match(/接收卡|排线|模组/),backward=[...clause.slice(Math.max(0,action.index-12),action.index).matchAll(/接收卡|排线|模组/g)].at(-1),part=forward?.[0]||backward?.[0];
  if(part)completedTests[{'排线':'ribbon','模组':'module','接收卡':'receiver'}[part]]=true;
 }
 const exchanged=Object.values(completedTests).some(Boolean);
 const requiresTopology=!confirmedTopology&&/屏|模组|接收卡|排线|颜色|黑屏|花屏|闪烁/.test(text);
 return {customerQuotes:quotes.slice(-6),models:currentModels.length?currentModels:!changedObject?priorModels:[],symptomDomain,confirmedTopology,topology,requiresTopology,reseated,exchanged,completedTests,
  constraints:['仅使用客户确实报告的观察。重插不等于互换/替换，没有对照结果不能推断故障是否跟随信号或硬件移动。','现场连接结构未确认时，只能给不依赖结构的检查方向，并先问控制卡直连模组还是外接独立接收卡；不能直接要求交换接收卡。','互换测试须说明断电、相同规格、一次只改变一个变量、保持其他连接/配置不变；结果只支持排查方向，不直接确诊。']};
}
module.exports={interpretCustomerText,expertTaskContext,diagnosticContext};
