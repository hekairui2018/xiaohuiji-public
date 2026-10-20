'use strict';
const {consumeProduct}=require('./consume-product.cjs');
function queryProducts(query,dataset,knowledge){
 // With document knowledge installed, product facts must come from those sources.
 // The selection dataset remains available to the ordering engine, not as a facts fallback.
 const records=knowledge?(knowledge.findProducts(query.modelId)||[]).map(p=>consumeProduct(p,knowledge,query)):dataset.findProducts(query.modelId);
 if(!records.length)return {status:'not_found',records:[],datasetVersion:dataset.version};
 // A missing revision is not evidence that this static catalog knows a hardware revision.
 if(query.revisionId)return {status:'needs_input',records:[],reason:'revision-not-established-in-source',datasetVersion:dataset.version};
 return {status:records.length===1?'found':'ambiguous',records,needsDocumentVersion:records.some(p=>['document-version-conflict','document-version-not-supported'].includes(p.parameterStatus)),datasetVersion:dataset.version,knowledgeVersion:knowledge?.version||null};
}
module.exports={queryProducts};
