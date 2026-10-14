'use strict';
// mL.P width branch. A candidate is not an approved configuration or formal plan.
function analyzeSpecialCanvas(module,screen,controller){
 const discount=controller.discount;if(!discount?.supportive)return {status:'not_applicable'};
 if(discount.minWidth===1024)return {status:'pending',reason:'fixed-canvas-branch-not-yet-verified'};
 if(!Number.isFinite(discount.minWidth)||discount.minWidth<=0)return {status:'pending',reason:'missing-source-canvas-threshold'};
 const moduleWidth=module.resolution[0],height=screen.pixelHeight,initial=Math.ceil(screen.pixelWidth/discount.minWidth),stop=Math.min(32,screen.columns);
 for(let count=initial;count<stop;count++){
  const width=Math.ceil(Math.ceil(screen.pixelWidth/count)/moduleWidth)*moduleWidth,canvasPoints=width*height*count;
  if(canvasPoints>(discount.canvasPoint||controller.totalPoints))break;
  if(controller.cascadePort<count)return {status:'pending',reason:'height-packing-branch-not-yet-verified'};
  const portsForArea=Math.ceil(width*height/655360),modulesPerPort=Math.floor(Math.floor(655360/height)/moduleWidth);
  if(modulesPerPort<1)continue;
  const portsPerSegment=Math.ceil((width/moduleWidth)/modulesPerPort);
  if(portsForArea*count>controller.cascadePort||portsPerSegment*count>controller.cascadePort)continue;
  const segments=[];let x=0;
  for(let i=0;i<count;i++){const actualWidth=i===count-1?(screen.pixelWidth%width||width):width,columns=actualWidth/moduleWidth;
   if(!Number.isSafeInteger(columns)||columns<portsPerSegment)return {status:'pending',reason:'zero-width-or-fractional-source-port-region'};
   const large=Math.ceil(columns/portsPerSegment),small=Math.floor(columns/portsPerSegment),extra=columns%portsPerSegment;
   const portColumns=Array.from({length:portsPerSegment},(_,p)=>p<extra?large:small);
   if(portColumns.some(c=>c*moduleWidth*height>655360))return {status:'pending',reason:'source-region-port-overload'};
   const limit=controller.singleNetworkPorts;if(limit?.supportive&&portColumns.some(c=>c*moduleWidth>limit.width||height>limit.height))return {status:'pending',reason:'source-port-dimensions-exceeded'};
   segments.push({id:i+1,physicalX:x,pixelWidth:actualWidth,pixelHeight:height,moduleColumns:columns,portColumns});x+=actualWidth;
  }
  if(x!==screen.pixelWidth)return {status:'pending',reason:'source-remainder-does-not-cover-screen'};
  return {status:'candidate',type:'width',nominalWidth:width,count,portsPerSegment,ports:portsPerSegment*count,canvasPoints,segments,source:'mL.P/mL.C',formalPlan:false,pendingEvidence:['receiver-layout-and-chip-conditions','configuration-coordinate-map','corresponding-hardware-import']};
 }
 return {status:'pending',reason:'official-width-branch-found-no-candidate'};
}
module.exports={analyzeSpecialCanvas};
