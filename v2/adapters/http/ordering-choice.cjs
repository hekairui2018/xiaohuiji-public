'use strict';
const crypto=require('node:crypto');
const identity=s=>[s.moduleId,s.controller,s.receiver?.modelId,s.inputs,s.selection?.metrics];
function token(simulations){return crypto.createHash('sha256').update(JSON.stringify(simulations.map(identity))).digest('hex').slice(0,24);}
function choices(simulations){return simulations.map((s,i)=>({id:i+1,moduleId:s.moduleId,controller:s.controller,receiver:s.receiver,controlMode:s.inputs.controlMode,goals:s.goals,metrics:s.selection?.metrics}));}
function selectOrderingChoice(previous,id,expectedToken){
 if(!Number.isSafeInteger(id)||id<1||!previous?.simulations?.[id-1]||expectedToken&&expectedToken!==token(previous.simulations))return null;
 const state=structuredClone(previous),s=state.simulations[id-1];if(!s.validation?.passed||!s.preview?.plan)return null;
 const p=s.preview.plan,result=structuredClone(s.formalResult||s.preview);
 result.options=choices(state.simulations);result.selectedOptionId=id;result.selectionToken=token(state.simulations);
 result.normalizedDemand=structuredClone(s.inputs);result.assumptions=s.assumptions;result.orderingAssumptions=state.defaults;
 if(!s.formalResult){result.status='needs_input';result.exportAllowed=false;result.previewBom=s.preview.previewBom;}
 if(!p.specialCanvas||p.specialCanvas.configurationMapVerified)if(!p.builtInRegions?.length&&p.architecture!=='direct')result.provisionalExportDemand=structuredClone(s.inputs);
 state.selectedOptionId=id;
 state.confirmed={...state.confirmed,controlMode:s.inputs.controlMode,provenance:{...state.confirmed?.provenance,'/controlMode':{kind:'user-selected-option',text:'配单方案：'+id}}};
 const reply=(s.formalResult?'推荐方案：':'暂定方案：')+p.controller.model+'，'+p.receiver.model+' '+p.cells.length+'张，使用'+p.ports.length+'个网口。\n整屏：'+p.screen.pixelWidth+'×'+p.screen.pixelHeight+'像素。\n'+(state.defaults?.length?'未确认条件仍按原默认值计算，切换不改变已确认条件。':'')+'清单、连接图及下载已切换到本方案。';
 return {status:'answer',actualMode:'expert',intent:'ordering',reply,result,orderingState:state,modelCallCount:0,toolCallCount:1,answerBasis:'validated-existing-ordering-choice',results:[]};
}
module.exports={selectOrderingChoice,choices,token};
