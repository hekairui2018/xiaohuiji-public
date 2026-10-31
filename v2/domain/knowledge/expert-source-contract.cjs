'use strict';
const crypto=require('node:crypto');
const norm=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/^HD[-_ ]?/,'').replace(/\s/g,'');
const dimensions=s=>String(s).match(/\d+\s*[x×*]\s*\d+/i)?.[0].replace(/\s/g,'').replace(/[x*]/i,'×');
// Source conditions stay attached to quantities. This is not a compatibility
// engine: only literal dimensions and labels from the same source row are used.
function capacityConditions(row){
 const result=[];
 for(const line of String(row.text||'').split('\n')){
  if(!/带载|芯片/i.test(line))continue;
  for(const clause of line.split(/[；;]/)){
   const m=clause.match(/([^：:]{1,100})[：:]\s*(\d+\s*[x×*]\s*\d+)/i);
   if(m&&/芯片/i.test(m[1]))result.push({condition:m[1].replace(/^.*?带载范围\s*/,''),dimensions:dimensions(m[2]),source:row.name,models:row.modelIds||[]});
  }
 }
 return result;
}
function requestedVersion(message){
 const text=String(message).normalize('NFKC'),out=[];
 for(const m of text.matchAll(/(20\d{2})\s*(?:年版|年度版|版)|(?:硬件|软件|固件)?版本\s*[:：]?\s*(V?\d+(?:\.\d+)+)|\b(V\d+(?:\.\d+)+)\s*(?:版|的)/gi))out.push(m[1]||m[2]||m[3]);
 return [...new Set(out)];
}
function prepareExpertSources(message,route={},input=[]){
 let evidence=structuredClone(input);const contract={capacityConditions:[],conflicts:[],sourceAnomalies:[],scopeGaps:[]};
 const unavailableRelease=/尚未(?:发布|公开|公布)|未(?:发布|公开|公布)|下一代|未来版本/.test(message);
 if(unavailableRelease&&!evidence.some(e=>e.sourceKind==='verified-product-roadmap'&&e.contextComplete===true))contract.scopeGaps.push({kind:'unreleased-target-not-verified',meaning:'客户问的是未发布的产品或版本。现有代际、已发布软件菜单不能代替目标；明确当前没有该目标的可核验资料，不先报现有代际参数。'});
 const liveKind=/库存|现货数量/.test(message)&&!/功能|支持|怎么|如何/.test(message)?'inventory':/成交价|最低价|报价|售价/.test(message)&&!/功能|支持|怎么|如何/.test(message)?'price':/(?:现场|实际|当前使用|自己设置).{0,18}(?:IP地址|IP\b)/i.test(message)?'site-address':null;
 if(liveKind&&!evidence.some(e=>e.sourceKind==='verified-live-record'&&e.factType===liveKind&&e.observedAt))contract.scopeGaps.push({kind:'live-fact-not-available',factType:liveKind,meaning:'静态产品资料不能获知当前库存、成交价格或客户现场实际地址。说明未连接对应实时系统或未取得现场读数；不能用默认值替代，也不改问带载等无关参数。'});
 if(/客户|私人|私有|自己改过|当前实际/.test(message)&&/密码|口令|密钥/.test(message)&&/多少|提供|告诉|给我|读取|查出/.test(message)&&!/怎么(?:修改|重置|找回)|如何(?:修改|重置|找回)/.test(message))contract.scopeGaps.push({kind:'private-credential-not-in-document-corpus',meaning:'资料库不能获知客户设置的私人凭据；默认密码不能当作客户实际密码。可说明无法提供，并询问是否需要找回/修改方法。'});
 if(/未发布|未公开|未公布/.test(message)&&/名单|清单|完整型号|所有型号/.test(message)&&!evidence.some(e=>e.category==='product-roadmap'&&e.contextComplete===true))contract.scopeGaps.push({kind:'unreleased-inventory-not-verified',meaning:'当前没有可核验的完整未发布产品清单，不能用已发布型号或询问年份代替缺失事实。'});
 if(route.hintIntent==='aftersales'){
  const matches=e=>(e.modelIds||[]).some(m=>(route.models||[]).some(q=>norm(q)===norm(m)));
  evidence=evidence.filter(e=>!(/case/.test(e.sourceKind||'')||e.category==='case')||!e.modelIds?.length||matches(e));
  const {componentPairs,coversComponentPair}=require('../parser/component-pair.cjs'),pairs=componentPairs(message);
  if(pairs.length){
   // Every prepared source must support the customer's whole component
   // combination. A shared pitch or one chip number cannot establish scope.
   evidence=evidence.filter(e=>coversComponentPair(e.text,pairs));
   contract.componentScopes=evidence.map(e=>{
    const sourcePairs=componentPairs(e.text),suffix=x=>x.replace(/^[a-z]+/i,'').toUpperCase();
    const exact=pairs.every(p=>sourcePairs.some(s=>p.components.every((c,i)=>suffix(c.raw)===suffix(s.components[i].raw))));
    return {evidenceId:e.evidenceId,requested:pairs.map(p=>p.text),sourcePairs:sourcePairs.map(p=>p.text),exactIdentityConfirmed:exact,meaning:exact?'仅确认原文记载了相同组合，不等于现场诊断成立':'仅数字系列相近，前后缀或完整身份未核实；历史调参值不能转为当前执行步骤'};
   });
   if(!evidence.length)contract.scopeGaps.push({kind:'component-combination-not-verified',requested:pairs.map(p=>p.text),meaning:'未找到覆盖客户整套芯片组合的可核验案例。不得用只匹配间距、单个芯片或其他译码组合的案例作处理依据；可提供只读核查方向并说明资料缺口。'});
  }
 }
 const factual=!['aftersales','ordering','operation'].includes(route.hintIntent||route.intent);
 const versions=requestedVersion(message);
 if(factual)for(const version of versions){
  const literal=version.replace(/^V/i,''),re=new RegExp('(?<![0-9.])V?'+literal.replace(/\./g,'\\.')+'(?![0-9]|\\.[0-9])','i');
  // Filename/locator/scope establish document version; body text mentioning
  // another release does not establish this document's identity.
  const hardware=new RegExp('硬件(?:版本)?\\s*[:：]?\\s*V?'+literal.replace(/\./g,'\\.')+'(?![0-9]|\\.[0-9])','i');
  const matching=hardware.test(message)?evidence.filter(e=>re.test(JSON.stringify(e.scope?.hardwareVersions||[]))||hardware.test(e.text)):
   evidence.filter(e=>re.test([e.name,JSON.stringify(e.locator||{}),JSON.stringify(e.scope||{})].join(' ')));
  if(matching.length)evidence=matching;
  else contract.scopeGaps.push({kind:'requested-version-not-verified',requested:version,available:evidence.map(e=>e.name)});
 }
 const unresolved=(route.unknownModels||[]).filter(m=>!(route.chips||[]).some(c=>norm(c)===norm(m)));
 if(unresolved.length&&!route.software?.length){
  const documented=new Set(evidence.flatMap(e=>e.modelIds||[]).map(norm));
  const absent=unresolved.filter(m=>!documented.has(norm(m)));
  if(absent.length)contract.scopeGaps.push({kind:'requested-model-not-verified',requested:absent});
 }
 if(contract.scopeGaps.length){
  const text='检索范围核对：'+JSON.stringify(contract.scopeGaps)+'。按上述缺口说明当前能否确认；不能用其他对象、默认值或旧版本事实代替客户所问的事实。资料缺口不等于客户问题不清楚，无需重问已经明确的意图。';
  return {evidence:[{evidenceId:'scope-'+crypto.createHash('sha256').update(text).digest('hex').slice(0,24),name:'本轮资料范围核对',text,sourceKind:'source-scope-gap',verificationStatus:'retrieval-scope-only',readPerformed:true,readAvailable:false,modelIds:[]}],contract};
 }
 for(const row of evidence){
  contract.capacityConditions.push(...capacityConditions(row));
  if(row.sourceKind==='structured-tender-original'){
   for(const label of ['最大宽度','最大高度']){
    const values=[...new Set([...row.text.matchAll(new RegExp(label+'\\s*[：:]?\\s*(\\d+)','g'))].map(m=>m[1]))];
    if(values.length>1)contract.sourceAnomalies.push({source:row.name,label,values,meaning:'原文同一字段有不同数值，须提示待核对，不能改写成另一字段或直接作为确定参数'});
   }
  }
 }
 for(const row of evidence.filter(e=>e.sourceKind==='structured-comparison-original')){
  let table;try{table=JSON.parse(row.text);}catch{continue;}
  for(const field of table.rows||[])for(const value of field.values||[]){
   const sameModel=e=>e.sourceKind!=='structured-comparison-original'&&(e.modelIds||[]).some(m=>norm(m)===norm(value.model));
   if(/带载/.test(field.parameter)&&dimensions(value.value)){
    const conditions=contract.capacityConditions.filter(c=>c.models.some(m=>norm(m)===norm(value.model))&&c.dimensions===dimensions(value.value));
    if(conditions.length){value.conditions=[...new Set(conditions.map(c=>c.condition))];value.value+='（'+value.conditions.join(' / ')+'）';}
   }
   if(!/输出|网口/.test(field.parameter))continue;
   const fromTable=value.value.match(/(\d+)\s*(?:路)?(?:千兆)?网口/);if(!fromTable)continue;
   const originals=[];
   for(const source of evidence.filter(sameModel))for(const m of source.text.matchAll(/标配\s*(\d+)\s*路千兆(?:输出)?网口/g))originals.push({count:Number(m[1]),source:source.name});
   const differing=originals.filter(x=>x.count!==Number(fromTable[1]));
   if(differing.length){
    const detail={model:value.model,parameter:field.parameter,tableValue:value.value,otherValues:differing};contract.conflicts.push(detail);
    value.conflict=true;value.value='资料不一致：对比表 '+value.value+'；'+[...new Map(differing.map(x=>[x.count,x])).values()].map(x=>'规格书 '+x.count+'网口').join(' / ');
   }
  }
  for(const field of table.rows||[])field.different=new Set(field.values.map(v=>String(v.value).normalize('NFKC').replace(/\s/g,''))).size>1;
  row.text=JSON.stringify(table);
 }
 return {evidence,contract};
}
// Describe source ownership without selecting answers, filtering candidates,
// or turning a retrieved product into the customer's actual equipment.
function describeExpertSources(route={},evidence=[]){
 const customerModelMentions=[...new Set([...(route.models||[]),...(route.contextModels||[])].filter(x=>typeof x==='string'&&x.trim()))];
 const customerKeys=new Set(customerModelMentions.map(norm)),groups=new Map();
 for(const row of evidence){
  const declaredModels=[...new Set([...(row.modelIds||[]),...(row.scope?.mentionedModels||[])].filter(x=>typeof x==='string'&&x.trim()))];
  const matches=declaredModels.filter(model=>customerKeys.has(norm(model)));
  const relation=!declaredModels.length?'source-model-unspecified':!customerModelMentions.length?'no-customer-model':matches.length?'overlap':'different-declared-models';
  const item={source:row.name||'原文资料',declaredModels,matchedCustomerModels:matches,relation};
  groups.set(JSON.stringify(item),item);
 }
 return {customerModelMentions,sourceSubjects:[...groups.values()],capacityConditions:evidence.flatMap(capacityConditions),
  sourceOwnershipOnly:true,meaning:'这些字段只核对资料归属，不替客户确认现场设备，也不限制专家查其他型号。来源中的型号不能填补客户未提供的型号；通用原理与对照分析仍可回答。若结论取决于缺少的现场条件，向客户核实关键条件，不从候选资料猜出现场。'};
}
module.exports={prepareExpertSources,capacityConditions,requestedVersion,describeExpertSources};
