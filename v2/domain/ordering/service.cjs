'use strict';
const {selectModule}=require('./module-selector.cjs');
const {receiverLayouts}=require('./receiver-selector.cjs');
const {controllerCandidates}=require('./controller-selector.cjs');
const {planPorts}=require('./port-planner.cjs');
const {validatePlan}=require('./validator.cjs');
const {outputPlan}=require('./output/plan-output.cjs');
const {validateRequirements}=require('./controller-requirements.cjs');
const {directPlan}=require('./direct-plan.cjs');
const {cabinetGeometry,cabinetCells}=require('./cabinet-planner.cjs');
const {sharedCabinet}=require('./c16-sharing.cjs');
const {analyzeSpecialCanvas}=require('./special-canvas.cjs');
function createOrderingService(dataset,knowledge){return demand=>{
 if(!demand.module&&!demand.screen)return {status:'unsupported',reason:'no-engineering-input',plan:null};
 const selected=selectModule(demand,dataset);if(selected.status!=='selected')return selected;
 const module=selected.module;let grid=demand.screen||{};
 if(demand.cabinet){const geometry=cabinetGeometry(demand.cabinet,grid);if(geometry.status!=='selected')return geometry;grid=geometry.grid;}
 if(!grid.moduleColumns||!grid.moduleRows)return {status:'needs_input',missing_parameters:[{path:'/screen',reason:'当前常规求解需要明确模组列数和行数，不自动取整尺寸'}]};
 const screen={columns:grid.moduleColumns,rows:grid.moduleRows,pixelWidth:grid.moduleColumns*module.resolution[0],pixelHeight:grid.moduleRows*module.resolution[1]};screen.points=screen.pixelWidth*screen.pixelHeight;
 if(!Number.isSafeInteger(screen.points)||grid.moduleColumns*grid.moduleRows>100000)return {status:'unsupported',reason:'geometry-exceeds-this-stage-computation-budget'};
 if((grid.pixelWidth!==undefined&&grid.pixelWidth!==screen.pixelWidth)||(grid.pixelHeight!==undefined&&grid.pixelHeight!==screen.pixelHeight))return {status:'conflict',reason:'explicit-screen-pixels-conflict-with-module-grid'};
 if((grid.physicalWidthMm!==undefined&&Math.abs(grid.physicalWidthMm-screen.columns*module.size[0])>0.001)||(grid.physicalHeightMm!==undefined&&Math.abs(grid.physicalHeightMm-screen.rows*module.size[1])>0.001))return {status:'conflict',reason:'explicit-physical-size-conflicts-with-module-grid'};
 const unsupported=validateRequirements(demand.requirements);if(unsupported)return unsupported;
 const candidates=controllerCandidates(demand,screen,dataset,module);if(candidates.status!=='selected')return candidates;
 if(demand.requirements?.cascadeSplicing)return {status:'unsupported',reason:'cascade-control-protocol-and-multi-device-configuration-not-established',plan:null,sourceAnalysis:{eligibleModels:candidates.controllers.map(c=>({modelId:c.model,source:c.source,totalPoints:c.totalPoints,cascadeSplicing:c.cascadeSplicing})),screenPoints:screen.points,count:demand.requirements.cascadeSplicing.count,source:'dL.ComputePlayBoxFilterRules',formalPlan:false}};
 if(demand.architecture==='direct')return directPlan(demand,module,screen,candidates);
 if(demand.requirements?.c16Sharing&&!demand.cabinet)return {status:'needs_input',missing_parameters:[{path:'/cabinet',reason:'C16接收卡共享需明确每箱模组及箱体阵列；不直接减卡'}]};
 const receivers=receiverLayouts(module,dataset,demand.providedDevices);if(receivers.status!=='selected')return receivers;
 const failures=[],conflicts=knowledge?.audit().parameterConflicts||[];
 for(const controller of candidates.controllers){
  if(['playBox','asyncCard'].includes(candidates.family)&&controller.discount?.supportive&&screen.pixelWidth>=controller.discount.minWidth){
   const sourceCalculation=require('./official-runtime.cjs').officialDiscount(module,screen,controller,dataset.receivers());
   const preview=require('./official-discount-plan.cjs').discountPlan(module,screen,controller,sourceCalculation);
   if(preview)return {status:'needs_input',plan:preview,exportAllowed:false,configurationBlockReason:'special-canvas-logical-coordinate-map-not-verified',validation:{passed:true,scope:'official-segment-physical-preview-only-not-hardware-configuration'},...outputPlan(preview),method:'official-js-mL-and-discount-renderer'};
   failures.push({controller:controller.model,reason:sourceCalculation.failed?'official-special-canvas-rejected':'official-special-canvas-coordinate-export-pending',sourceCalculation,sourceAnalysis:analyzeSpecialCanvas(module,screen,controller)});continue;
  }
  const quantity=r=>demand.cabinet?Math.ceil(demand.cabinet.moduleColumns*demand.cabinet.moduleRows/(r.width*r.height)):Math.ceil(screen.columns/r.width)*Math.ceil(screen.rows/r.height);
  const layouts=[...receivers.layouts].sort((a,b)=>quantity(a)-quantity(b));
  for(const receiver of layouts){const boxes=demand.cabinet?cabinetCells(demand.cabinet,module,receiver):null;if(boxes&&boxes.status!=='planned'){failures.push({controller:controller.model,receiver:receiver.model,reason:boxes.reason});continue;}
   const conflict=conflicts.find(c=>c.modelId==='HD-'+receiver.model);
   if(conflict){const maxWidth=(boxes?Math.max(...boxes.cells.map(c=>c.columns)):Math.min(screen.columns,receiver.width))*module.resolution[0];const maxHeight=(boxes?Math.max(...boxes.cells.map(c=>c.rows)):Math.min(screen.rows,receiver.height))*module.resolution[1];
    const limits=conflict.claims.map(c=>c.text.match(/PWM(?: chip)?[:≤\s]+(\d+)(?:\s*\*\s*(\d+))?/i)).filter(Boolean);
    const commonWidth=Math.min(...limits.map(m=>Number(m[1]))),knownHeights=limits.filter(m=>m[2]).map(m=>Number(m[2]));
    if(!Number.isFinite(commonWidth)||!knownHeights.length||maxWidth>commonWidth||maxHeight>Math.min(...knownHeights)){failures.push({controller:controller.model,receiver:receiver.model,reason:'unresolved-receiver-source-conflict',conflict});continue;}
    if(receiver.model==='R708'){const conventional=knowledge.audit().receiverEvidence.verifiedClaims.generalConventional;
     if(maxWidth>conventional[0]||maxHeight>conventional[1]){
      if(demand.module.driverFamily!=='pwm'){failures.push({controller:controller.model,receiver:receiver.model,reason:demand.module.driverFamily==='conventional'?'receiver-conventional-profile-exceeded':'receiver-driver-family-not-confirmed'});continue;}
     }
    }
   }
   const shared=demand.requirements?.c16Sharing?sharedCabinet(boxes.cells,demand.cabinet,module,controller):null;if(shared&&shared.status!=='planned'){failures.push({controller:controller.model,receiver:receiver.model,reason:shared.reason});continue;}
   const packing=planPorts(screen.columns,screen.rows,module,receiver,controller,shared?.cells||boxes?.cells);if(packing.status!=='planned'){failures.push({controller:controller.model,receiver:receiver.model,reason:packing.reason});continue;}
   const plan={module,receiver,controller,screen,cells:packing.cells,ports:packing.ports,...(demand.cabinet?{cabinet:structuredClone(demand.cabinet)}:{}),...(shared?{builtInRegions:shared.builtInRegions,sharing:shared.source}:{})};const validation=validatePlan(plan);if(!validation.passed){failures.push({controller:controller.model,receiver:receiver.model,errors:validation.errors});continue;}
   return {status:'ready',plan,validation:{...validation,scope:'official-static-layout-and-geometry-not-complete-chip-firmware-verification'},...outputPlan(plan),sourceReferences:[module.source,controller.source,receiver.source],ruleTrace:[{ruleId:'official-static-controller-filter',source:'dL.PublicFilterSendingCard/MatchWidthAndHeightWithPoints'},{ruleId:'official-controller-features',source:candidates.family==='asyncCard'?'dL.ComputeAsyncCardFilterRules':candidates.family==='playBox'?'dL.ComputePlayBoxFilterRules':'dL.ComputeProcessFilterRules',requirements:demand.requirements||{}},{ruleId:'module-receiver-layout',source:module.source},...(demand.cabinet?[{ruleId:'official-cabinet-one-two-card-split',source:'hL.filterCabinetReceivingCard',scope:'receiver-dimensions-enforced-no-unverified-C16-sharing-or-splicer-output-groups'}]:[])],method:'local-rectangular-solver-not-website-runtime-parity'};
  }
 }
 if(failures.some(f=>f.reason==='receiver-driver-family-not-confirmed'))return {status:'needs_input',missing_parameters:[{path:'/module/driverFamily',reason:'当前R708带载超出常规芯片档位，请确认驱动芯片类别；不自动假定PWM'}],failures};
 return {status:'unsupported',reason:'current-packing-search-found-no-verified-plan-not-proof-of-global-infeasibility',failures};
};}
module.exports={createOrderingService};
