'use strict';
const crypto=require('node:crypto');
const {parseOrderingFields}=require('../../domain/parser/ordering-fields.cjs');
function createExpertOrdering({app,userMessages}){
 return async args=>{
  if(!Array.isArray(args.userQuotes)||!args.userQuotes.length||args.userQuotes.length>12||args.userQuotes.some(q=>typeof q!=='string'||!q.trim()||q.length>1000||!userMessages.some(m=>m.includes(q))))throw Error('expert-invalid-tool');
  const text=args.userQuotes.join('\n'),screenMentions=[...text.matchAll(/(\d+|[一二两三四五六七八九十])(?:块|面|个)(?:独立|LED|显示|大)?屏/gi)],screen=screenMentions[0];
  const count=screen?(Number(screen[1])||({一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10})[screen[1]]):null;
  const demand={schemaVersion:'2.0',operation:'ordering'};
  for(const quote of args.userQuotes){const parsed=parseOrderingFields(quote);for(const [key,value]of Object.entries(parsed))demand[key]=['module','screen','requirements','provenance'].includes(key)?{...demand[key],...value}:value;}
  // Preserve explicitly stated interface constraints that the existing lexical parser omits.
  let unsupportedInterface=null;
  for(const m of text.matchAll(/\b(HDMI|DVI|DP|SDI|VGA|USB)\s*(输入|输出)/gi)){
   if(/(?:不要|不需要|无需)\s*$/.test(text.slice(Math.max(0,m.index-8),m.index)))continue;
   demand.requirements||={};
   if(m[2]==='输入')demand.requirements.inputSource=[...new Set([...(demand.requirements.inputSource||[]),m[1].toUpperCase()])];
   else if(m[1].toUpperCase()==='HDMI')demand.requirements.hdmiOut=true;
   else unsupportedInterface=m[0];
  }
  const described=app.understandInput?.(text,'ordering')?.demand;if(described?.providedDevices)demand.providedDevices=described.providedDevices;
  const result=unsupportedInterface?{status:'unsupported',reason:'explicit-output-interface-not-supported',interface:unsupportedInterface}:screenMentions.length>1?{status:'needs_input',missing_parameters:[{path:'/screenCount',reason:'引用中有多处屏幕数量，请明确是否为同一块屏；不只取第一次数量'}]}:!count?{status:'needs_input',missing_parameters:[{path:'/screenCount',reason:'请确认屏幕数量；不把未明确的多屏按单屏计算'}]}:count!==1?{status:'unsupported',reason:'multiple-independent-screens-not-supported-by-current-ordering-contract',screenCount:count}:await app.dialogue(demand);
  if(result.status==='ready'&&result.validation?.passed!==true)throw Error('expert-invalid-ordering-result');
  const normalized=structuredClone(result.normalizedDemand||demand);delete normalized.provenance;
  const summary={status:result.status,reason:result.reason,missing_parameters:result.missing_parameters,screenCount:count,normalizedDemand:normalized,
   ...(result.status==='ready'?{screen:result.plan.screen,controller:{model:result.plan.controller.model,totalPoints:result.plan.controller.totalPoints,maxWidth:result.plan.controller.maxWidth,maxHeight:result.plan.controller.maxHeight,hdmiOut:result.plan.controller.hdmiOut},bom:result.bom,ports:result.plan.ports.length,validation:result.validation,sourceReferences:result.sourceReferences,datasetVersion:result.datasetVersion}:{}),
   scope:'existing-static-rule-calculation; not hardware, chip, firmware compatibility or global optimality confirmation'};
  const id='calculation-'+crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0,20);
  return {intent:'ordering',notice:{status:result.status,missing_parameters:result.missing_parameters,reason:result.reason,screenCount:count},evidence:[{evidenceId:id,name:'现有配单计算器：已引用的客户条件与官方静态数据',text:JSON.stringify(summary),sourceKind:'validated-ordering-calculation',verificationStatus:result.status==='ready'?'geometry-and-static-rule-checked':'not-a-plan',compatibilityConfirmed:false,referenceOnly:true}]};
 };
}
module.exports={createExpertOrdering};
