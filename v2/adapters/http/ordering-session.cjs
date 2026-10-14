'use strict';
function createOrderingSessions(app,{ttlMs=1800000,maxSessions=200,now=Date.now}={}){
 const cache=new Map(),key=id=>typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(id)?id:null;
 return {
  continue(id,text){const k=key(id),old=cache.get(k);if(!old||now()-old.at>ttlMs){cache.delete(k);return null;}
   if(/参数|规格书|固件|说明书|软件|视频|是什么|怎么用/.test(text))return null;
   if(/重新配单|另一块屏|另外.{0,5}配/.test(text)){cache.delete(k);return null;}
   const parsed=app.understandInput(text,'ordering').demand;if(!parsed||parsed.operation!=='ordering')return null;
   const fields=['module','screen','cabinet','environment','controlMode','architecture','providedDevices','requirements'];if(!fields.some(f=>parsed[f]!==undefined)&&!Object.values(parsed.provenance||{}).some(p=>p.kind==='user-negated'))return null;
   const demand=structuredClone(old.demand);for(const f of fields)if(parsed[f]!==undefined)demand[f]=['module','screen','cabinet','requirements'].includes(f)?{...demand[f],...parsed[f]}:parsed[f];
   for(const path of ['/module/color','/module/driverFamily'])if(parsed.provenance?.[path]?.kind==='user-negated'&&demand.module)delete demand.module[path.split('/')[2]];
   demand.provenance={...demand.provenance,...parsed.provenance};return demand;
  },
  save(id,result){const k=key(id);if(!k)return;if(result.operation!=='ordering'||result.status!=='needs_input'){cache.delete(k);return;}
   for(const [id,row]of cache)if(now()-row.at>ttlMs)cache.delete(id);if(cache.size>=maxSessions&&!cache.has(k))cache.delete(cache.keys().next().value);
   cache.set(k,{at:now(),demand:structuredClone(result.normalizedDemand)});
  }
 };
}
module.exports={createOrderingSessions};
