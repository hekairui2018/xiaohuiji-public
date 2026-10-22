'use strict';
// Extract explicit parameters only. No device selection, guesses or model calls.
const {extractKnownModels}=require('../identity/extract-models.cjs');
const {parseOrderingFields}=require('./ordering-fields.cjs');
function parseInput(input,dataset,{operation:forcedOperation,decision:suppliedDecision}={}){
 if(input&&typeof input==='object'&&!Array.isArray(input))return {demand:input};
 if(typeof input!=='string'||!input.trim())return {status:'needs_input',missing_parameters:[{path:'/topic',reason:'请提供问题或标准需求JSON'}]};
 const text=input.trim();if(text.length>4096)return {status:'invalid_request',errors:[{path:'/topic',code:'too_long'}]};
 const decision=suppliedDecision||require('./chat-intent.cjs').decideAction(text,{models:extractKnownModels(text,dataset),software:(dataset.softwareItems?.(text)||[]).map(x=>x.name)});
 const orderFields=parseOrderingFields(text);
 const operation=decision.intent==='aftersales'?'aftersales':forcedOperation||(decision.intent==='ordering'?'ordering':'consultation');
 const demand={schemaVersion:'2.0',operation,topic:text,provenance:{}};
 const models=extractKnownModels(text,dataset);
 if(models.length){demand.providedDevices=models.map(modelId=>({modelId,revisionId:null}));demand.provenance['/providedDevices']={kind:'user-stated',text};}
 if(operation==='aftersales')demand.symptoms=[text];
 if(operation==='ordering'){
  const provenance=demand.provenance;Object.assign(demand,orderFields);demand.provenance={...provenance,...orderFields.provenance};
 }
 return {demand};
}
module.exports={parseInput};
