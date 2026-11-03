'use strict';
const {sharedQuickEvidence}=require('./shared-quick-evidence.cjs');
function createSectionTools({resourceSearch,resourceAnswer,expertMaterials,tenderMaterials,expertSources,customerMessage='',calculateOrdering,onProgress=()=>{},signal=()=>undefined}){
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
