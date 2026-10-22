'use strict';
const {controllerCandidates}=require('./controller-selector.cjs');
// First-stage source filtering only. Never supplies missing customer fields or
// bypasses the module/receiver/port validation needed for a final plan.
function previewControllers(demand,dataset){
 const {pixelWidth:w,pixelHeight:h}=demand.screen||{};
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1||!Number.isSafeInteger(w*h)||demand.architecture==='direct')return [];
 const family=demand.requirements?.controllerFamily;
 if(family&&!['processor','playBox'].includes(family))return [];
 const families=family?[family]:demand.controlMode==='async'?['playBox']:['processor','playBox'];
 return families.flatMap(controllerFamily=>{
  const controlMode=demand.controlMode||(controllerFamily==='processor'?'sync':'async');
  const assumptions=[...(!demand.controlMode?['/controlMode']:[]),...(!demand.architecture?['/architecture']:[])];
  const input={...demand,controlMode,architecture:demand.architecture||'receiver',requirements:{...demand.requirements,controllerFamily}};
  const result=controllerCandidates(input,{pixelWidth:w,pixelHeight:h,points:w*h},dataset);
  if(result.status!=='selected')return [];
  return [{family:controllerFamily,controlMode,assumptions,scope:'source-controller-filter-only-not-final-plan',models:result.controllers.slice(0,2).map(d=>({modelId:require('../identity/model-id.cjs').modelId(d.model),source:d.source}))}];
 });
}
module.exports={previewControllers};
