'use strict';
const {modelId}=require('../identity/model-id.cjs');
const {validateRequirements,satisfiesFeatures,orderPlayboxes}=require('./controller-requirements.cjs');
const {asyncCardFits}=require('./async-card-rules.cjs');
const {selectModule}=require('./module-selector.cjs');
function controllerCandidates(demand,screen,dataset,selectedModule){
 const missing=['controlMode','architecture'].filter(k=>!demand[k]);if(missing.length)return {status:'needs_input',missing_parameters:missing.map(k=>({path:'/'+k,reason:k==='controlMode'?'请明确同步或异步':'请明确接收卡架构或直控'}))};
 const requirements=demand.requirements||{},invalid=validateRequirements(requirements);if(invalid)return invalid;
 const family=requirements.controllerFamily||'processor';
 if((demand.architecture!=='receiver'&&family!=='asyncCard')||(family==='processor'&&demand.controlMode!=='sync')||(family==='asyncCard'&&demand.controlMode!=='async'))return {status:'unsupported',reason:'requested-control-mode-or-architecture-not-implemented-for-family'};
 const receiverIds=new Set(dataset.receivers().map(r=>modelId(r.model)));
 const unknown=(demand.providedDevices||[]).filter(d=>!receiverIds.has(modelId(d.modelId))&&!dataset.findProducts(d.modelId).length);
 if(unknown.length)return {status:'needs_input',reason:'provided-device-not-established-in-source',devices:unknown};
 if((demand.providedDevices||[]).some(d=>d.revisionId))return {status:'needs_input',reason:'hardware-revision-not-established-in-selection-source'};
 const specified=(demand.providedDevices||[]).filter(d=>dataset.findProducts(d.modelId).length);
 if(specified.length>1)return {status:'conflict',reason:'multiple-controller-models-specified'};
 const category=family==='asyncCard'?'异步控制卡':family==='playBox'?'同步异步播放盒':'二合一视频处理器';
 const module=family==='asyncCard'?(selectedModule||selectModule(demand,dataset).module):null;
 if(family==='asyncCard'&&!module)return {status:'needs_input',missing_parameters:[{path:'/module',reason:'异步卡规则需要已明确的完整模组条件'}]};
 const rows=dataset.devices().filter(d=>d.category===category&&![3,4,5].includes(d.status)&&modelId(d.model)&&
   (!specified.length||modelId(d.model)===modelId(specified[0].modelId))&&d.totalPoints>=screen.points*(requirements.cascadeSplicing?.count||1)&&d.maxWidth>=screen.pixelWidth&&d.maxHeight>=screen.pixelHeight&&satisfiesFeatures(d,requirements,family)&&
   (family!=='asyncCard'||(demand.architecture==='direct'?d.singleCardMode===true:d.singleCardMode===false||requirements.c16Sharing&&['C16L','C16H'].includes(d.model))&&asyncCardFits(d,module,screen,(demand.providedDevices||[]).find(d=>receiverIds.has(modelId(d.modelId)))?.modelId?.replace(/^HD-/i,''))));
 const candidates=[...new Map(require('./official-runtime.cjs').publicFilter(rows,screen,family==='processor'?4:family==='playBox'?3:2).map(d=>[d.model,d])).values()];
 return candidates.length?{status:'selected',controllers:candidates,family}:{status:'no_feasible_plan',reason:'no-source-supported-controller-candidate'};
}
module.exports={controllerCandidates};
