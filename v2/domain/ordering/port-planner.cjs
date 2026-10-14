'use strict';
// Rectangular module/cell planning; geometric data only, no device or AI decisions.
const PORT_POINTS=655360;
function planPorts(columns,rows,module,receiver,controller,providedCells){
 const cells=providedCells||[];let id=1;
 if(!providedCells)for(let row=0;row<rows;row+=receiver.height)for(let col=0;col<columns;col+=receiver.width){
  const w=Math.min(receiver.width,columns-col),h=Math.min(receiver.height,rows-row);
  cells.push({id:id++,col,row,columns:w,rows:h,pixelWidth:w*module.resolution[0],pixelHeight:h*module.resolution[1]});
 }
 if(!cells.length)return {status:'planned',cells,ports:[]};
 const ports=[];let current=[];
 const geometry=list=>{const x=Math.min(...list.map(c=>c.col)),y=Math.min(...list.map(c=>c.row));
  const right=Math.max(...list.map(c=>c.col+c.columns)),bottom=Math.max(...list.map(c=>c.row+c.rows));
  return {pixelWidth:(right-x)*module.resolution[0],pixelHeight:(bottom-y)*module.resolution[1],points:(right-x)*(bottom-y)*module.resolution[0]*module.resolution[1]};};
 const fits=list=>{const g=geometry(list),limit=controller.singleNetworkPorts;
  return g.points<=PORT_POINTS&&(!limit?.supportive||(g.pixelWidth<=limit.width&&g.pixelHeight<=limit.height));};
 for(const cell of cells){if(!fits([cell]))return {status:'constraint_failure',reason:'one-receiver-region-exceeds-port-geometry'};
  if(current.length&&!fits([...current,cell])){ports.push({id:ports.length+1,cells:current,...geometry(current)});current=[];}current.push(cell);
 }
 if(current.length)ports.push({id:ports.length+1,cells:current,...geometry(current)});
 if(ports.length>controller.cascadePort)return {status:'constraint_failure',reason:'insufficient-controller-ports'};
 return {status:'planned',cells,ports};
}
module.exports={planPorts,PORT_POINTS};
