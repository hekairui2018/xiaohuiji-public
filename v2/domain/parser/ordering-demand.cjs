'use strict';
// Shared semantic field merge. No catalogue lookup, selection or calculation.
function mergeOrderingDemand(previous,delta){
 const demand=structuredClone(previous||{schemaVersion:'2.0',operation:'ordering'});
 if(delta.module?.pitchMm!==undefined&&demand.module?.pitchMm!==undefined&&delta.module.pitchMm!==demand.module.pitchMm){
  demand.module={};for(const p of Object.keys(demand.provenance||{}))if(p.startsWith('/module/'))delete demand.provenance[p];
 }
 const geometry=delta.screen||{},modes=[['moduleColumns','moduleRows'],['pixelWidth','pixelHeight'],['physicalWidthMm','physicalHeightMm']];
 const changed=modes.find(keys=>keys.some(k=>geometry[k]!==undefined));
 if(changed&&demand.screen)for(const keys of modes)if(keys!==changed)for(const k of keys){delete demand.screen[k];if(demand.provenance)delete demand.provenance['/screen/'+k];}
 for(const f of ['module','screen','cabinet','environment','controlMode','architecture','providedDevices','requirements','topic'])if(delta[f]!==undefined)demand[f]=['module','screen','cabinet','requirements'].includes(f)?{...demand[f],...delta[f]}:structuredClone(delta[f]);
 for(const p of ['/module/color','/module/driverFamily'])if(delta.provenance?.[p]?.kind==='user-negated'&&demand.module)delete demand.module[p.split('/')[2]];
 for(const f of ['environment','controlMode','architecture'])if(delta.provenance?.['/'+f]?.kind==='user-negated')delete demand[f];
 demand.provenance={...demand.provenance,...delta.provenance};return demand;
}
module.exports={mergeOrderingDemand};
