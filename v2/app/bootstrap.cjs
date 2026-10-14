'use strict';
const {loadDataset}=require('../adapters/data/load-dataset.cjs');
const {createRouter}=require('./router.cjs');
const {createPipeline}=require('./request-pipeline.cjs');
const {createConsultationService}=require('../domain/consultation/service.cjs');
const {createOrderingService}=require('../domain/ordering/service.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs');
const {createAftersalesService}=require('../domain/aftersales/service.cjs');
const {exportSsm}=require('../domain/ordering/output/ssm-export.cjs');
const {loadSsmShell}=require('../adapters/data/load-ssm-shell.cjs');
const {auditSsm}=require('../acceptance/ssm.cjs');
const {loadResourceEvidence}=require('../adapters/data/load-resource-evidence.cjs');
const {createResourceService}=require('../domain/knowledge/resource-service.cjs');
function createApp({dataset=loadDataset(),knowledge=loadKnowledge(),handlers={}}={}){
 const resources=createResourceService(knowledge,loadResourceEvidence());
 const router=createRouter({ordering:createOrderingService(dataset,knowledge),aftersales:createAftersalesService(knowledge),consultation:createConsultationService(dataset,knowledge,resources),...handlers});
 const pipeline=createPipeline({dataset,router,knowledge});
 return Object.freeze({...pipeline,originalDocuments:knowledge?.evidenceDocuments||(()=>[]),resourceLookup:resources.query,chipLookup:resources.chipLookup,resourceMedia:resources.media,async exportSsm(input){const result=await pipeline.dialogue(input);if(result.operation!=='ordering'||result.status!=='ready')return {status:result.status==='ready'?'invalid_request':result.status,reason:'requires-complete-ordering-demand',result};
  try{const shell=loadSsmShell(),exported=exportSsm(result,shell),acceptance=auditSsm(exported,result,shell);if(!acceptance.automaticPassed)throw Error('SSM automatic acceptance failed');return {status:'ready',...exported,acceptance};}catch(error){return {status:'unsupported',reason:error.message};}
 },health:()=>({ok:true,generation:2,aiEnabled:false,datasetVersion:dataset.version,counts:dataset.counts,knowledgeVersion:knowledge?.version||null,knowledgeCounts:knowledge?.counts||null})});
}
module.exports={createApp};
