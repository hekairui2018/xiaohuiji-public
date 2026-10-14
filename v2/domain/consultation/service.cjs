'use strict';
const {queryProducts}=require('../knowledge/query-products.cjs');
const {queryResources}=require('../knowledge/query-resources.cjs');
// Shared read-only knowledge. Never invokes /quick, quickLookup, or its response adapter.
function createConsultationService(dataset,knowledgeIndex,resourcesService){
 return demand=>{
  const resources=resourcesService?.query(demand.topic,{providedDevices:demand.providedDevices})||queryResources(demand.topic,knowledgeIndex);if(resources)return {status:['needs_input','conflict'].includes(resources.status)?resources.status:'ready',resources};
  if(demand.providedDevices?.length===1){
   const documentVersion=!/硬件|固件|FPGA/i.test(demand.topic||'')?/\bV\d+(?:\.\d+)+\b/i.exec(demand.topic||'')?.[0].toUpperCase():undefined;
   const knowledge=queryProducts({...demand.providedDevices[0],documentVersion},dataset,knowledgeIndex);
   return knowledge.status==='found'&&!knowledge.needsDocumentVersion?{status:'ready',knowledge}:{status:'needs_input',knowledge,missing_parameters:[{path:'/topic',reason:'请确认规格书版次；不同资料版本参数有差异，不能当作同一硬件条件'}]};
  }
  if(!demand.topic)return {status:'needs_input',missing_parameters:[{path:'/topic',reason:'请提供咨询问题'}]};
  return {status:'unsupported',reason:'general-consultation-not-implemented'};
 };
}
module.exports={createConsultationService};
