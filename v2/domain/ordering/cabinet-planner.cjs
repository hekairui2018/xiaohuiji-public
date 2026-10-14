'use strict';
function cabinetGeometry(cabinet,grid){
 const keys=['moduleColumns','moduleRows','columns','rows'],missing=keys.filter(k=>!Number.isSafeInteger(cabinet[k])||cabinet[k]<1);
 if(missing.length)return {status:'needs_input',missing_parameters:missing.map(k=>({path:'/cabinet/'+k,reason:'请明确每箱模组数和屏体箱体阵列'}))};
 const columns=cabinet.moduleColumns*cabinet.columns,rows=cabinet.moduleRows*cabinet.rows;
 if((grid.moduleColumns!==undefined&&grid.moduleColumns!==columns)||(grid.moduleRows!==undefined&&grid.moduleRows!==rows))return {status:'conflict',reason:'cabinet-array-conflicts-with-screen-module-grid'};
 return {status:'selected',grid:{...grid,moduleColumns:columns,moduleRows:rows}};
}
function cabinetCells(cabinet,module,receiver){
 const width=cabinet.moduleColumns,height=cabinet.moduleRows,count=Math.ceil(width*height/(receiver.width*receiver.height));
 let widths=[width],heights=[height];
 if(count===2){if(width>=height)widths=[Math.ceil(width/2),Math.floor(width/2)];else heights=[Math.ceil(height/2),Math.floor(height/2)];}
 else if(count!==1)return {status:'constraint_failure',reason:'cabinet-more-than-two-receivers-not-yet-established'};
 if(widths.some(w=>w<1||w>receiver.width)||heights.some(h=>h<1||h>receiver.height))return {status:'constraint_failure',reason:'official-cabinet-split-exceeds-source-receiver-dimensions'};
 const cells=[];
 for(let boxRow=0;boxRow<cabinet.rows;boxRow++)for(let boxCol=0;boxCol<cabinet.columns;boxCol++){
  let dy=0;for(const rows of heights){let dx=0;for(const columns of widths){cells.push({id:cells.length+1,cabinetId:boxRow*cabinet.columns+boxCol+1,col:boxCol*width+dx,row:boxRow*height+dy,columns,rows,pixelWidth:columns*module.resolution[0],pixelHeight:rows*module.resolution[1]});dx+=columns;}dy+=rows;}
 }
 return {status:'planned',cells,receiversPerCabinet:count};
}
module.exports={cabinetGeometry,cabinetCells};
