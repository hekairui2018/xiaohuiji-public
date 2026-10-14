'use strict';
// Named fields mirror official dL filters; unsupported branches are never ignored.
const BOOLS=['hdmiOut','posterScreen','meetingScreen','dockingCentralControl','ktvRecommended','c16Sharing'];
const LISTS=['peripherals','inputSource'];
function validateRequirements(requirements={}){
 const unknown=Object.keys(requirements).filter(k=>!['controllerFamily','cascadeSplicing',...BOOLS,...LISTS].includes(k));
 if(unknown.length)return {status:'unsupported',reason:'special-requirements-not-yet-implemented',requirements:unknown};
 if(requirements.controllerFamily!==undefined&&!['processor','playBox','asyncCard'].includes(requirements.controllerFamily))return {status:'unsupported',reason:'controller-family-not-yet-implemented'};
 if(requirements.cascadeSplicing!==undefined){const c=requirements.cascadeSplicing;if(!c||c.supportive!==true)return {status:'unsupported',reason:'cascade-requires-explicit-supported-mode'};
  if(!Number.isSafeInteger(c.count)||c.count<2)return {status:'needs_input',missing_parameters:[{path:'/requirements/cascadeSplicing/count',reason:'请明确至少两台设备的级联数量'}]};
  if(Object.keys(c).some(k=>!['supportive','count'].includes(k)))return {status:'unsupported',reason:'unverified-cascade-layout-or-feature'};
 }
 const invalid=[...BOOLS.filter(k=>requirements[k]!==undefined&&typeof requirements[k]!=='boolean'),...LISTS.filter(k=>requirements[k]!==undefined&&(!Array.isArray(requirements[k])||requirements[k].some(v=>typeof v!=='string'||!v.trim())))];
 return invalid.length?{status:'needs_input',missing_parameters:invalid.map(k=>({path:'/requirements/'+k,reason:'功能要求必须使用布尔值或明确的来源标识字符串数组'}))}:null;
}
function satisfiesFeatures(device,requirements,family){
 if(!(requirements.peripherals||[]).every(key=>device.peripherals?.includes(key)))return false;
 if(requirements.cascadeSplicing&&!(family==='playBox'&&device.cascadeSplicing?.supportive===true&&requirements.cascadeSplicing.count<=device.cascadeSplicing.count))return false;
 if(requirements.c16Sharing&&!(family==='asyncCard'&&['C16L','C16H'].includes(device.model)))return false;
 if(family==='asyncCard')return !requirements.inputSource?.length&&!['hdmiOut','posterScreen','meetingScreen','dockingCentralControl','ktvRecommended'].some(k=>requirements[k]);
 if(family==='playBox')return !requirements.inputSource?.length&&!requirements.dockingCentralControl&&!requirements.ktvRecommended&&
  (!requirements.hdmiOut||device.hdmiOut===true)&&(!requirements.posterScreen||['B6L','A6L','B8L'].includes(device.model))&&(!requirements.meetingScreen||['H6','H8'].includes(device.model));
 return !requirements.hdmiOut&&!requirements.posterScreen&&!requirements.meetingScreen&&
  (requirements.inputSource||[]).every(type=>device.inputSource?.some(s=>s.type===type&&s.supportive===true))&&
  (!requirements.dockingCentralControl||device.dockingCentralControl===true)&&(!requirements.ktvRecommended||device.ktvRecommended===true);
}
function orderPlayboxes(rows){
 if(!rows.length)return rows;
 const smallest=Math.min(...rows.map(r=>r.totalPoints)),height=Math.max(...rows.filter(r=>r.totalPoints===smallest).map(r=>r.recommendedResolution?.[1]||0));
 // Preserve the official first-choice group and source order, without repeating candidates.
 return [...rows.filter(r=>r.recommendedResolution?.[1]===height),...rows.filter(r=>r.recommendedResolution?.[1]!==height)];
}
module.exports={validateRequirements,satisfiesFeatures,orderPlayboxes};
