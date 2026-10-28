'use strict';
// User-authorized estimating defaults. Kept separate from customer assertions.
function conversationDefaults(confirmed){
 const demand=structuredClone(confirmed),defaults=[];demand.module??={};
 for(const [path,value,label]of [['environment','indoor','室内'],['controlMode','sync','同步'],['architecture','receiver','主控＋接收卡'],['module.color',{r:1,g:1,b:1},'全彩'],['module.interface','HUB75','HUB75']]){
  const parts=path.split('.'),key=parts.at(-1),owner=parts.length>1?demand.module:demand;
  const provenance='/'+parts.join('/');
  if(owner[key]!=null||demand.provenance?.[provenance]?.kind==='user-negated')continue;
  owner[key]=structuredClone(value);defaults.push({path:provenance,value,label});
 }
 return {demand,defaults};
}
module.exports={conversationDefaults};
