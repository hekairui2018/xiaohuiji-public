'use strict';
const {PORT_POINTS}=require('./port-planner.cjs');
const {c16CanDrive}=require('./c16-sharing.cjs');
function validatePlan(plan){
 const errors=[],{module,receiver,controller,screen,cells,ports}=plan;
 const area=screen.columns*screen.rows;
 if(screen.pixelWidth!==screen.columns*module.resolution[0]||screen.pixelHeight!==screen.rows*module.resolution[1])errors.push('screen-geometry');
 if(screen.points!==screen.pixelWidth*screen.pixelHeight)errors.push('screen-area');
 if(screen.points>controller.totalPoints||screen.pixelWidth>controller.maxWidth||screen.pixelHeight>controller.maxHeight)errors.push('controller-capacity');
 if(!module.receiveCard.some(r=>r.model===receiver.model&&r.width===receiver.width&&r.height===receiver.height))errors.push('receiver-source-layout');
 const covered=new Set();
 const allRegions=[...cells,...(plan.builtInRegions||[])];
 if(plan.builtInRegions){const b=plan.cabinet,regions=plan.builtInRegions;
  if(!b||regions.length!==1||!c16CanDrive(controller,module,b.moduleColumns,b.moduleRows)||regions.some(c=>c.cabinetId!==b.columns*b.rows))errors.push('c16-sharing-conditions');
 }
 for(const c of allRegions){if(c.columns>receiver.width||c.rows>receiver.height||c.columns<=0||c.rows<=0)errors.push('receiver-layout');
  if(c.pixelWidth!==c.columns*module.resolution[0]||c.pixelHeight!==c.rows*module.resolution[1])errors.push('cell-pixels');
  for(let y=c.row;y<c.row+c.rows;y++)for(let x=c.col;x<c.col+c.columns;x++){const key=x+':'+y;if(x<0||y<0||x>=screen.columns||y>=screen.rows||covered.has(key))errors.push('cell-coverage');covered.add(key);}
 }
 if(covered.size!==area)errors.push('screen-coverage');
 if(plan.cabinet){const b=plan.cabinet;if(screen.columns!==b.columns*b.moduleColumns||screen.rows!==b.rows*b.moduleRows)errors.push('cabinet-grid');
  for(const c of allRegions){const boxCol=Math.floor(c.col/b.moduleColumns),boxRow=Math.floor(c.row/b.moduleRows);if(c.cabinetId!==boxRow*b.columns+boxCol+1||c.col+c.columns>(boxCol+1)*b.moduleColumns||c.row+c.rows>(boxRow+1)*b.moduleRows)errors.push('cabinet-receiver-crosses-boundary');}
 }
 const assigned=ports.flatMap(p=>p.cells.map(c=>c.id));if(assigned.length!==cells.length||new Set(assigned).size!==cells.length||cells.some(c=>!assigned.includes(c.id)))errors.push('port-assignment');
 if(ports.length>controller.cascadePort)errors.push('controller-ports');
 for(const p of ports){const width=(Math.max(...p.cells.map(c=>c.col+c.columns))-Math.min(...p.cells.map(c=>c.col)))*module.resolution[0];
  if(p.cells.some(c=>!cells.some(original=>JSON.stringify(original)===JSON.stringify(c))))errors.push('port-cell-consistency');
  const height=(Math.max(...p.cells.map(c=>c.row+c.rows))-Math.min(...p.cells.map(c=>c.row)))*module.resolution[1];
  if(p.points!==width*height||p.pixelWidth!==width||p.pixelHeight!==height)errors.push('port-bounding-geometry');
  if(width*height>PORT_POINTS)errors.push('port-points');const limit=controller.singleNetworkPorts;
  if(limit?.supportive&&(width>limit.width||height>limit.height))errors.push('port-dimensions');
 }
 return {passed:errors.length===0,errors:[...new Set(errors)],checks:['source-layout','exact-coverage','cell-geometry','port-area','device-capacity']};
}
module.exports={validatePlan};
