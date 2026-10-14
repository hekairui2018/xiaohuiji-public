'use strict';
const {modelId}=require('../identity/model-id.cjs');
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function createDataset(raw,version){
 if(raw?.schemaVersion!==2||!Array.isArray(raw.devices)||!Array.isArray(raw.modules)||!Array.isArray(raw.receivers))throw Error('Invalid dataset shape');
 const snapshot=freeze(JSON.parse(JSON.stringify(raw)));
 if(!/^[a-f0-9]{64}$/.test(snapshot.source?.sha256||''))throw Error('Dataset lacks original source checksum');
 const products=new Map();const recordIds=new Set();
 for(const device of snapshot.devices){
  if(!device.model||device.source?.sha256!==snapshot.source.sha256||!device.source?.symbol||!Number.isSafeInteger(device.source.index)||device.source.index<0)throw Error('Device lacks provenance');
  for(const key of ['totalPoints','maxWidth','maxHeight'])if(!Number.isSafeInteger(device[key])||device[key]<=0)throw Error('Invalid device capacity: '+device.model);
  const recordId=device.source.symbol+':'+device.source.index;if(recordIds.has(recordId))throw Error('Duplicate source identity');recordIds.add(recordId);
  const id=modelId(device.model);if(!id)continue;const records=products.get(id)||[];records.push(device);products.set(id,records);
 }
 const moduleIds=new Set();
 for(const row of snapshot.modules){
  if(!Number.isSafeInteger(row.id)||moduleIds.has(row.id))throw Error('Duplicate/invalid module ID');moduleIds.add(row.id);
  if(row.source?.sha256!==snapshot.source.sha256||row.source?.symbol!=='Ay'||!Number.isSafeInteger(row.source.index)||row.source.index<0)throw Error('Module lacks provenance');
  for(const field of ['resolution','size'])if(!Array.isArray(row[field])||row[field].length!==2||row[field].some(n=>!Number.isFinite(n)||n<=0))throw Error('Invalid module geometry');
  if(!Array.isArray(row.receiveCard)||row.receiveCard.some(c=>!modelId(c.model)||!Number.isSafeInteger(c.width)||c.width<=0||!Number.isSafeInteger(c.height)||c.height<=0))throw Error('Invalid receiver layout');
 }
 const receiverModels=new Set();
 for(const receiver of snapshot.receivers){const id=modelId(receiver.model);if(!id||receiverModels.has(id)||!receiver.interface?.type||!Number.isSafeInteger(receiver.interface.count)||receiver.interface.count<=0||!Number.isSafeInteger(receiver.interface.width)||receiver.interface.width<=0)throw Error('Invalid receiver interface');receiverModels.add(id);}
 return Object.freeze({version,source:snapshot.source,
  counts:Object.freeze({products:snapshot.devices.length,modules:snapshot.modules.length,receivers:snapshot.receivers.length}),
  findProducts(value){return [...(products.get(modelId(value))||[])];},
  devices(){return [...snapshot.devices];},modules(){return [...snapshot.modules];},receivers(){return snapshot.receivers.map((r,index)=>freeze({...r,source:{symbol:'My',index,sha256:snapshot.source.sha256}}));},
  unresolvedLabels(){return snapshot.devices.filter(d=>!modelId(d.model));}});
}
module.exports={createDataset};
