'use strict';
const {officialHeight,sourceSHA256}=require('./official-runtime.cjs');
function officialPorts(columns,rows,module,receiver,controller){
 let raw;try{raw=officialHeight(columns,rows,module,receiver)}catch(e){return {status:'constraint_failure',reason:e.message}};
 if(raw.type!=='onlyHeight'||!Number.isSafeInteger(raw.wn)||raw.wn<1||!raw.heightArr?.length)return {status:'constraint_failure',reason:'official-height-plan-unavailable'};
 const cells=[],ports=[];let id=1,col=0;
 for(const widthUnits of raw.widthArr){
  const width=widthUnits*receiver.width;
  if(!Number.isSafeInteger(width)||width<1)return {status:'constraint_failure',reason:'official-fractional-region-not-adapted'};
  const list=[];let row=0;
  for(const [rowIndex,height] of raw.heightArr.entries()){const stripe=[];for(let x=0;x<width;x+=receiver.width){const w=Math.min(receiver.width,width-x);stripe.push({id:id++,col:col+x,row,columns:w,rows:height,pixelWidth:w*module.resolution[0],pixelHeight:height*module.resolution[1]});}if(list.length&&rowIndex%2===1)stripe.reverse();list.push(...stripe);row+=height;}
  const pixelWidth=width*module.resolution[0],pixelHeight=rows*module.resolution[1],points=pixelWidth*pixelHeight;
  if(points>655360||controller.singleNetworkPorts?.supportive&&(pixelWidth>controller.singleNetworkPorts.width||pixelHeight>controller.singleNetworkPorts.height))return {status:'constraint_failure',reason:'official-layout-exceeds-device-port'};
  cells.push(...list);ports.push({id:ports.length+1,cells:list,pixelWidth,pixelHeight,points});col+=width;
 }
 if(col!==columns||ports.length>controller.cascadePort)return {status:'constraint_failure',reason:'official-layout-coverage-or-port-count'};
 return {status:'planned',cells,ports,calculation:{engine:'official-js-Ex',sha256:sourceSHA256,raw}};
}
module.exports={officialPorts};
