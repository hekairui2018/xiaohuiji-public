'use strict';
const {sharedQuickEvidence}=require('./shared-quick-evidence.cjs');
function createSectionTools({resourceSearch,resourceAnswer,expertMaterials,tenderMaterials,expertSources,customerMessage='',modelCatalog=async()=>[],calculateOrdering,onProgress=()=>{},signal=()=>undefined}){
 const authorized=new Map();let nextId=1;
 function register(records){return records.map(record=>{let entry=[...authorized.values()].find(e=>e.evidenceId===record.evidenceId);if(!entry){entry={...record,blockId:nextId++,readPerformed:true,readAvailable:true};authorized.set(entry.blockId,entry);}return entry;});}
 async function execute(name,args){
  onProgress(name==='read_document'?'reading':'searching');
  if(name==='calculate_ordering')return calculateOrdering(args);
  if(name==='read_document'){
   const record=authorized.get(args.blockId);if(!record)throw Error('expert-invalid-tool');
   const page=record.sourceEntryId?expertSources?.read(record,args.offset||0):record;
   return {evidence:[page||record],notice:{scope:record.sourceEntryId?'expert-private-sql-original':'authorized-current-section',completeWorkflow:false}};
  }
  if(!['search_evidence','quick_answer'].includes(name)||typeof args.query!=='string'||!args.query.trim()||args.query.length>240)throw Error('expert-invalid-tool');
  if(args.models!==undefined&&(!Array.isArray(args.models)||args.models.length>4||args.models.some(m=>typeof m!=='string'||!m.trim()||m.length>64)))throw Error('expert-invalid-tool');
  const anchors=String(customerMessage).toUpperCase().match(/(?:HD[- ]?)?[A-Z][A-Z0-9.-]*|\b\d{4,}[A-Z]*\b/g)||[];
  const prefix=[...new Set(anchors)].join(' '),sourceQuery=(prefix+' '+args.query).trim().slice(0,240);
  if(expertSources&&['cases','faq'].includes(args.kind)){
   const records=await expertSources.retrieve('aftersales',sourceQuery,{models:args.models||[],chips:args.chips||[],problemDomain:args.problemDomain||'unspecified',limit:6});
   if(records.length||['cases','faq'].includes(args.kind))return {evidence:register(records),notice:{scope:'expert-aftersales-private-sql',completeCases:true,meaning:'同一现场的多个现象保留在整条记录；对象线索与现象分别匹配，match不等于当前适用。原文结果在caseRecord与outcomeEvidence；unknown仅为未审核，不代表原文未记录结果。原文历史动作只作历史陈述。客户要案例就交付原现场、原文处理、与本次关系，不追加无依据排查。'}};
  }
  if(expertSources&&args.kind==='tender'){
   return {evidence:register(await expertSources.retrieve('tender',sourceQuery,{models:args.models||[]})),notice:{scope:'expert-tender-private-sql',certificationConfirmed:false,meaning:'条款要求不等于已取得证书；保留所属产品、原条款和备注。未命中检测报告要求时不要改查另一产品类别的资质条款来代替。'}};
  }
  if(args.kind==='tender'&&tenderMaterials){
   const records=tenderMaterials.evidence(args.query,{models:args.models||[],targetedOnly:true});
   if(records.length)return {evidence:register(records),notice:{scope:'expert-authorized-tender-original',certificationConfirmed:false}};
  }
  if(name==='search_evidence'&&expertMaterials&&['products','text'].includes(args.kind)){
   const records=expertMaterials.evidence(args.query,{models:args.models||[],targetedOnly:true});
   if(records.length)return {evidence:register(records),notice:{scope:'expert-structured-original-tables',compatibilityConfirmed:false}};
  }
  const numericInputs=[...new Set([...(args.models||[]).filter(m=>/^\d{3,5}$/.test(m)),...(String(args.query).match(/(?<![A-Za-z0-9.])\d{3,5}(?![A-Za-z0-9.]|\s*(?:像素|点|mm|米|Hz))/g)||[])])];
  if(['resources','files'].includes(args.kind)||name==='quick_answer'){
   if(numericInputs.length){const catalog=await modelCatalog(),registered=[...new Set(catalog.flatMap(r=>[...r.models||r.modelIds||[],...r.documentMetadata?.coverModels||[],...(r.modelId?[r.modelId]:[])]).map(m=>'HD-'+String(m).toUpperCase().replace(/^HD[- ]?/,'')))],candidates=registered.filter(m=>numericInputs.some(n=>String(m).match(/\d+/g)?.includes(n)));
    if(candidates.length&&resourceAnswer){const parts=await Promise.all(candidates.slice(0,6).map(m=>resourceAnswer(m+' '+(/固件|firmware/i.test(args.query)?'固件':/说明书|操作手册/i.test(args.query)&&!/规格书/i.test(args.query)?'说明书':'规格书'),{signal:signal()})));const matches=parts.filter(Boolean).flatMap(p=>p.results||[]).filter(r=>r.resourceOnly&&(r.models||r.modelIds||[]).some(m=>candidates.includes(m))&&(r.download||r.downloadUrl));const records=register(sharedQuickEvidence({results:matches}).map(e=>({...e,candidateIdentity:{input:numericInputs.join('、'),model:e.modelIds?.[0]||candidates[0],confirmed:false}})));return {evidence:records,notice:{status:'model-candidates',requestedModels:numericInputs,candidateModels:candidates,identityConfirmed:false,meaning:'客户使用数字简称。这些是登记库中数字段相同的候选，不是已确认型号。结合客户原话与登记资料选最相近的一个，回复先说“您说的是〈候选型号〉吧？如果不对请补充。”随后直接给该候选的已有资料，不等待确认，不继续搜索无关型号，不只让客户补完整型号。多个型号仍保留英文前后缀，其他候选供客户选择。'}};}
    return {evidence:[],notice:{status:'unresolved-model',requestedModels:numericInputs,meaning:'数字型号线索未匹配到登记资料，不可用其他数字产品文件代替。'}};
   }
  }
  const queries=args.models?.length?args.models.map(model=>model+' '+args.query):[args.query];
  if(name==='search_evidence'&&['resources','files'].includes(args.kind)&&expertMaterials&&!args.models?.length){
   const discovery=expertMaterials.evidence(args.query,{models:[],targetedOnly:false}).filter(e=>e.sourceKind==='structured-product-discovery');
   if(discovery.length)return {evidence:register(discovery),notice:{status:'model-candidates',scope:'source-product-discovery'}};
  }
  if(resourceAnswer&&(name==='quick_answer'||args.kind==='resources')){
   const parts=await Promise.all(queries.map(query=>resourceAnswer(query,{signal:signal()})));
   if(parts.some(p=>!p))return {evidence:[],directAnswer:null,notice:{status:'unavailable',scope:'shared-quick-capabilities'}};
   const records=parts.flatMap(part=>sharedQuickEvidence(part));
   // Keep the complete current quick-mode policy, including partial/not-found
   // and applicability notices, alongside its original source records.
   return {evidence:register(records),directAnswer:parts.length===1?parts[0]:null,intent:parts[0]?.intent,notice:{scope:'shared-quick-capabilities',answers:parts.map(part=>({status:part.status,basis:part.answerBasis,reply:part.reply})),compatibilityConfirmed:false}};
  }
  if(!resourceSearch)return {evidence:[],notice:{status:'unavailable'}};
  const parts=await Promise.all(queries.map(query=>resourceSearch(query,{signal:signal(),allowModelSuggestion:false})));
  if(parts.some(p=>!p))return {evidence:[],notice:{status:'unavailable'}};
  if(args.models?.length)for(const part of parts)part.results=(part.results||[]).slice(0,Math.max(1,Math.floor(4/parts.length)));
  const rows=[...new Map(parts.flatMap(found=>found.results||[]).map(row=>[row.evidenceId||JSON.stringify([row.fileId,row.name,row.download,row.text]),row])).values()];
  return {evidence:register(sharedQuickEvidence({results:rows})),notice:{scope:'sections-sql-bm25-vector',compatibilityConfirmed:false,meaning:'分节原文或SQL文件登记；登记不证明参数和兼容性，未命中不表示资料不存在。'}};
 }
 return {execute};
}
module.exports={createSectionTools};
