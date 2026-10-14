'use strict';
const {validate}=require('../contracts/validate.cjs');
const demandSchema=require('../contracts/demand.schema.json');
const quickSchema=require('../contracts/quick-query.schema.json');
const {parseInput}=require('../domain/parser/deterministic-parser.cjs');
const {queryProducts}=require('../domain/knowledge/query-products.cjs');
const {consumeProduct}=require('../domain/knowledge/consume-product.cjs');
const {createAcceptance}=require('../acceptance/index.cjs');
const {extractKnownModels}=require('../domain/identity/extract-models.cjs');
function createPipeline({dataset,router,knowledge}){
 const acceptance=createAcceptance({dataset,knowledge});
 const lookup={findProducts:id=>[...dataset.findProducts(id),...(knowledge?.findProducts(id)||[])]};
 return Object.freeze({
  understandInput(input,operation){return parseInput(input,lookup,{operation});},
  quickLookup(query){const check=validate(quickSchema,query);return check.valid?queryProducts(query,dataset,knowledge):{status:'invalid_request',errors:check.errors};},
  quickSearch(text){const ids=extractKnownModels(text,lookup),raw=ids.length?ids.flatMap(id=>knowledge?.findProducts(id).length?knowledge.findProducts(id):dataset.findProducts(id)):knowledge?knowledge.search(text):dataset.findProducts(text);const records=raw.map(p=>knowledge&&p.claims?consumeProduct(p,knowledge):p);return {status:'found',records,knowledgeVersion:knowledge?.version||null};},
  quickResources(){return knowledge?.assets()||{};},
  quickBrowse(){return knowledge?knowledge.products().map(p=>consumeProduct(p,knowledge)):dataset.devices();},
  async dialogue(input){
   const understood=parseInput(input,lookup);if(!understood.demand)return understood;
   const check=validate(demandSchema,understood.demand);if(!check.valid)return {status:'invalid_request',errors:check.errors};
   const demand=JSON.parse(JSON.stringify(understood.demand));
   const result=await router(demand);
   if(!result||!['ready','needs_input','conflict','no_feasible_plan','unsupported'].includes(result.status))throw Error('Invalid domain response');
   if(demand.operation==='ordering'&&result.status==='ready'&&(!result.plan||result.validation?.passed!==true))throw Error('Unvalidated ordering plan');
   if(demand.operation==='ordering'&&result.status==='ready'){const check=acceptance.ordering({...result,normalizedDemand:demand});if(!check.automaticPassed)throw Error('Automatic ordering acceptance failed: '+check.checks.filter(c=>c.status==='failed').map(c=>c.id).join(','));}
   return {...result,schemaVersion:'2.0',operation:demand.operation,requestId:demand.requestId||null,datasetVersion:dataset.version,normalizedDemand:demand};
  }
 });
}
module.exports={createPipeline};
