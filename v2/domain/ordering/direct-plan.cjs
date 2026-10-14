'use strict';
const {asyncCardFits}=require('./async-card-rules.cjs');
const {modelId}=require('../identity/model-id.cjs');
const {c16CanDrive}=require('./c16-sharing.cjs');
function validateDirectPlan(plan){
 const {module,controller,screen,directOutputs}=plan,hub=controller.hub?.find(h=>h.name==='75');const errors=[];
 if(!['D16','C08L','C16L','C16H'].includes(controller.model)||module.interface!=='HUB75'||!hub)errors.push('unsupported-direct-interface');
 if(['C16L','C16H'].includes(controller.model)&&!c16CanDrive(controller,module,screen.columns,screen.rows))errors.push('c16-built-in-conditions');
 if(!asyncCardFits(controller,module,screen)||screen.points>controller.totalPoints||screen.pixelWidth>controller.maxWidth||screen.pixelHeight>controller.maxHeight)errors.push('direct-capacity');
 if(screen.pixelWidth!==screen.columns*module.resolution[0]||screen.pixelHeight!==screen.rows*module.resolution[1]||screen.points!==screen.pixelWidth*screen.pixelHeight)errors.push('direct-geometry');
 const covered=new Set();for(const output of directOutputs){const key=output.col+':'+output.row;if(covered.has(key)||output.hubId!==covered.size+1||output.hubId>hub?.count||output.col<0||output.col>=screen.columns||output.row<0||output.row>=screen.rows||output.pixelWidth!==module.resolution[0]||output.pixelHeight!==module.resolution[1])errors.push('direct-mapping');covered.add(key);}
 if(covered.size!==screen.columns*screen.rows)errors.push('direct-coverage');
 return {passed:errors.length===0,errors:[...new Set(errors)],scope:'official-direct-conditions-and-logical-hub-slots-not-ribbon-wiring-verification'};
}
function directPlan(demand,module,screen,candidates){
 if(demand.cabinet)return {status:'unsupported',reason:'direct-cabinet-wiring-not-established'};
 const specifiedReceiver=(demand.providedDevices||[]).some(d=>/^HD-R\d/.test(modelId(d.modelId)||''));if(specifiedReceiver)return {status:'conflict',reason:'direct-architecture-cannot-use-specified-receiver'};
 for(const controller of candidates.controllers){const hub=controller.hub?.find(h=>h.name==='75');
  const c16=['C16L','C16H'].includes(controller.model)&&demand.requirements?.c16Sharing;
  if((!['D16','C08L'].includes(controller.model)&&!c16)||module.interface!=='HUB75'||!hub||screen.columns*screen.rows>hub.count)continue;
  const directOutputs=[];for(let row=0;row<screen.rows;row++)for(let col=0;col<screen.columns;col++)directOutputs.push({hubId:directOutputs.length+1,col,row,pixelWidth:module.resolution[0],pixelHeight:module.resolution[1]});
  const plan={architecture:'direct',module,controller,screen,directOutputs,cells:[],ports:[]},validation=validateDirectPlan(plan);if(!validation.passed)continue;
  const bom=[{kind:'module',modelId:'module-'+module.id,quantity:screen.columns*screen.rows},{kind:'controller',modelId:'HD-'+controller.model,quantity:1}];
  const topology={architecture:'direct',screen:{width:screen.pixelWidth,height:screen.pixelHeight},ports:[],receivers:[],directOutputs:structuredClone(directOutputs)};
  return {status:'ready',plan,bom,topology,validation,sourceReferences:[module.source,controller.source],ruleTrace:[{ruleId:'official-async-direct-conditions',source:'dL.ComputeAsyncCardFilterRules/C'}],ssm:{supported:false,reason:'direct-hub-configuration-is-not-a-receiver-grid'}};
 }
 return {status:'unsupported',reason:'no-source-established-direct-hub-assignment-for-this-layout'};
}
module.exports={directPlan,validateDirectPlan};
