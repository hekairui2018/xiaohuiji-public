'use strict';
const {modelId}=require('../identity/model-id.cjs');
function receiverLayouts(module,dataset,providedDevices=[]){
 const receiverIds=new Set(dataset.receivers().map(r=>modelId(r.model)));
 const specified=providedDevices.filter(d=>receiverIds.has(modelId(d.modelId)));
 if(specified.length>1)return {status:'conflict',reason:'multiple-receiver-models-specified'};
 const rows=module.receiveCard.filter(r=>receiverIds.has(modelId(r.model))&&(!specified.length||modelId(r.model)===modelId(specified[0].modelId)));
 if(!rows.length)return {status:'conflict',reason:'receiver-not-supported-by-module-record'};
 return {status:'selected',layouts:rows.map(r=>({...r,source:module.source}))};
}
module.exports={receiverLayouts};
