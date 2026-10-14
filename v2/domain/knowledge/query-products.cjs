'use strict';
const {consumeProduct}=require('./consume-product.cjs');
function queryProducts(query,dataset,knowledge){
 const official=dataset.findProducts(query.modelId),internal=knowledge?.findProducts(query.modelId)||[];
 const records=internal.length?internal.map(p=>({...((official.length===1)?official[0]:{}),...consumeProduct(p,knowledge,query),selectionRecords:official})):official;
 if(!records.length)return {status:'not_found',records:[],datasetVersion:dataset.version};
 // A missing revision is not evidence that this static catalog knows a hardware revision.
 if(query.revisionId)return {status:'needs_input',records:[],reason:'revision-not-established-in-source',datasetVersion:dataset.version};
 return {status:records.length===1?'found':'ambiguous',records,needsDocumentVersion:records.some(p=>['document-version-conflict','document-version-not-supported'].includes(p.parameterStatus)),datasetVersion:dataset.version,knowledgeVersion:knowledge?.version||null};
}
module.exports={queryProducts};
