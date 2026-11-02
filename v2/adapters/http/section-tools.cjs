'use strict';
const {sharedQuickEvidence}=require('./shared-quick-evidence.cjs');
function createSectionTools({resourceSearch,expertMaterials,calculateOrdering,onProgress=()=>{},signal=()=>undefined}){
 const authorized=new Map();let nextId=1;
 function register(records){return records.map(record=>{let entry=[...authorized.values()].find(e=>e.evidenceId===record.evidenceId);if(!entry){entry={...record,blockId:nextId++,readPerformed:true,readAvailable:true};authorized.set(entry.blockId,entry);}return entry;});}
 async function execute(name,args){
  onProgress(name==='read_document'?'reading':'searching');
  if(name==='calculate_ordering')return calculateOrdering(args);
  if(name==='read_document'){
   const record=authorized.get(args.blockId);if(!record)throw Error('expert-invalid-tool');
   return {evidence:[record],notice:{scope:'authorized-current-section',completeWorkflow:false}};
  }
  if(!['search_evidence','quick_answer'].includes(name)||typeof args.query!=='string'||!args.query.trim()||args.query.length>240)throw Error('expert-invalid-tool');
  if(args.models!==undefined&&(!Array.isArray(args.models)||args.models.length>4||args.models.some(m=>typeof m!=='string'||!m.trim()||m.length>64)))throw Error('expert-invalid-tool');
  if(name==='search_evidence'&&expertMaterials&&['products','text'].includes(args.kind)){
   const records=expertMaterials.evidence(args.query,{models:args.models||[],targetedOnly:true});
   if(records.length)return {evidence:register(records),notice:{scope:'expert-structured-original-tables',compatibilityConfirmed:false}};
  }
  const queries=args.models?.length?args.models.map(model=>model+' '+args.query):[args.query];
  const parts=await Promise.all(queries.map(query=>resourceSearch(query,{signal:signal()})));
  const rows=[...new Map(parts.flatMap(found=>found.results||[]).map(row=>[row.evidenceId||row.fileId+'|'+row.text,row])).values()];
  return {evidence:register(sharedQuickEvidence({results:rows})),notice:{scope:'sections-sql-bm25-vector',compatibilityConfirmed:false,meaning:'分节原文或SQL文件登记；登记不证明参数和兼容性，未命中不表示资料不存在。'}};
 }
 return {execute};
}
module.exports={createSectionTools};
