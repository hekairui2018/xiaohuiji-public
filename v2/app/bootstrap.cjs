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
const {buildCaseActivation}=require('../domain/aftersales/activation-policy.cjs'),{createRestrictedAftersales}=require('../domain/aftersales/restricted-service.cjs');
function createApp({dataset=loadDataset(),knowledge=loadKnowledge(),handlers={}}={}){
 const resources=createResourceService(knowledge,loadResourceEvidence());
 const router=createRouter({ordering:createOrderingService(dataset,knowledge),aftersales:createAftersalesService(knowledge),consultation:createConsultationService(dataset,knowledge,resources),...handlers});
 const pipeline=createPipeline({dataset,router,knowledge});
 const activation=buildCaseActivation(knowledge),customerRouter=createRouter({ordering:createOrderingService(dataset,knowledge),consultation:createConsultationService(dataset,knowledge,resources),...handlers,aftersales:createRestrictedAftersales(knowledge,activation)});
 const customer=createPipeline({dataset,router:customerRouter,knowledge});
 // Internal read-only ordering references. These never establish customer conditions.
 const orderingReferences=demand=>({datasetVersion:dataset.version,modules:require('../domain/ordering/module-selector.cjs').moduleCandidates(demand,dataset),devices:(demand.providedDevices||[]).flatMap(d=>dataset.findProducts(d.modelId)),receivers:dataset.receivers()});
 return Object.freeze({...pipeline,orderingReferences,customerDialogue:customer.dialogue,caseActivation:()=>structuredClone(activation),originalDocuments:knowledge?.evidenceDocuments||(()=>[]),resourceLookup:resources.query,chipLookup:resources.chipLookup,resourceMedia:resources.media,async exportSsm(input){const result=await pipeline.dialogue(input);if(result.operation!=='ordering'||result.status!=='ready')return {status:result.status==='ready'?'invalid_request':result.status,reason:'requires-complete-ordering-demand',result};
  try{const shell=loadSsmShell(),exported=exportSsm(result,shell),acceptance=auditSsm(exported,result,shell);if(!acceptance.automaticPassed)throw Error('SSM automatic acceptance failed');return {status:'ready',...exported,acceptance};}catch(error){return {status:'unsupported',reason:error.message};}
 },health:()=>({ok:true,generation:2,aiEnabled:false,datasetVersion:dataset.version,counts:dataset.counts,knowledgeVersion:knowledge?.version||null,knowledgeCounts:knowledge?.counts||null,aftersalesActivation:activation.counts})});
}
module.exports={createApp};
