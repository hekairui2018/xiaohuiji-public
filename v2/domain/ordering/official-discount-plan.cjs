'use strict';
// Coordinates adapt the website discount renderer (moduleWidth/cardWidthNum,
// remainder first; discountWidthModules for multi-port segments). No selection.
function discountPlan(module,screen,controller,source){
 if(source.failed||!Array.isArray(source.segments)||!source.segments.length)return null;
 const cells=[],ports=[];let start=0,id=1,portBase=0;
 for(const segment of source.segments){
  if(segment.type!=='width'||!Number.isSafeInteger(segment.cardWidthNum)||segment.cardWidthNum<1)return null;
  const n=segment.cardWidthNum,large=Math.ceil(segment.moduleWidth/n),remainder=segment.moduleWidth%n;
  let col=start;
  for(let index=0;index<n;index++){
   const columns=segment.networkPortNumber>1?segment.discountWidthModules[index]:index<remainder||remainder===0?large:large-1;
   if(!Number.isSafeInteger(columns)||columns<1)return null;
   const portId=portBase+Math.ceil((index+1)/segment.widthInterval);
   let port=ports.find(p=>p.id===portId);if(!port){port={id:portId,cells:[]};ports.push(port);}
   const cell={id:id++,col,row:0,columns,rows:segment.moduleHeight,pixelWidth:columns*module.resolution[0],pixelHeight:segment.moduleHeight*module.resolution[1]};cells.push(cell);port.cells.push(cell);col+=columns;
  }
  if(col-start!==segment.moduleWidth)return null;start=col;portBase+=segment.networkPortNumber;
 }
 if(start!==screen.columns||cells.length!==source.receiver.cardNum||ports.length>controller.cascadePort)return null;
 for(const p of ports){p.pixelWidth=p.cells.reduce((sum,c)=>sum+c.pixelWidth,0);p.pixelHeight=screen.pixelHeight;p.points=p.pixelWidth*p.pixelHeight;if(p.points>655360)return null;}
 return {module,screen,controller,receiver:{model:source.receiver.model},cells,ports,specialCanvas:{type:'official-discount',raw:source,configurationMapVerified:false}};
}
module.exports={discountPlan};
