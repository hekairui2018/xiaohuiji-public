'use strict';
const fieldMap={pitchMm:m=>m.dotPitch.spacing,pixelWidth:m=>m.resolution[0],pixelHeight:m=>m.resolution[1],physicalWidthMm:m=>m.size[0],physicalHeightMm:m=>m.size[1],interface:m=>m.interface};
function moduleCandidates(demand,dataset){
 const input=demand.module||{};
 let rows=dataset.modules().filter(m=>Object.entries(fieldMap).every(([key,get])=>input[key]===undefined||get(m)===input[key]));
 if(input.scan)rows=rows.filter(m=>m.scanningMethod===input.scan.denominator+'S'&&input.scan.numerator===1);
 if(input.color)rows=rows.filter(m=>['r','g','b'].every(k=>input.color[k]===m.color[k.toUpperCase()]));
 if(demand.environment)rows=rows.filter(m=>m.indoor===(demand.environment==='indoor'));
 return rows;
}
function selectModule(demand,dataset){
 const input=demand.module||{},rows=moduleCandidates(demand,dataset);
 if(!rows.length)return {status:'conflict',reason:'no-module-satisfies-explicit-conditions'};
 if(rows.length!==1)return {status:'needs_input',candidates:rows.map(m=>({moduleId:m.id,pitchMm:m.dotPitch.spacing,pixels:m.resolution,scan:m.scanningMethod,interface:m.interface,color:m.color})),missing_parameters:[{path:'/module',reason:'请补充模组像素、扫描方式、接口或颜色，以区分候选'}]};
 const missing=['pitchMm','pixelWidth','pixelHeight','scan','interface','color'].filter(k=>input[k]===undefined);
 if(!demand.environment)return {status:'needs_input',missing_parameters:[{path:'/environment',reason:'请明确室内或户外，不以候选库记录代替现场条件'}]};
 if(missing.length)return {status:'needs_input',missing_parameters:missing.map(k=>({path:'/module/'+k,reason:'唯一库记录不能替代客户确认的适用条件'}))};
 return {status:'selected',module:rows[0]};
}
module.exports={selectModule,moduleCandidates};
