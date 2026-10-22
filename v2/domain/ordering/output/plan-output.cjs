'use strict';
function outputPlan(plan){
 const bom=[{kind:'module',modelId:'module-'+plan.module.id,quantity:plan.screen.columns*plan.screen.rows},
  {kind:'receiver',modelId:'HD-'+plan.receiver.model,quantity:plan.cells.length},{kind:'controller',modelId:'HD-'+plan.controller.model,quantity:1}];
 const topology={screen:{width:plan.screen.pixelWidth,height:plan.screen.pixelHeight},ports:plan.ports.map(p=>({id:p.id,receiverIds:p.cells.map(c=>c.id)})),receivers:plan.cells.map(c=>({...c}))};
 if(plan.builtInRegions)topology.builtInRegions=structuredClone(plan.builtInRegions);
 topology.connections=plan.ports.flatMap(port=>port.cells.map((cell,index)=>({portId:port.id,from:index?{kind:'receiver',id:port.cells[index-1].id}:{kind:'controller',modelId:'HD-'+plan.controller.model,portId:port.id},to:{kind:'receiver',id:cell.id}})));
 const colors=['#2563eb','#059669','#d97706','#9333ea'];const shapes=[];
 for(const p of plan.ports)for(const c of p.cells){const x=c.col*plan.module.resolution[0],y=c.row*plan.module.resolution[1];shapes.push(`<rect x="${x}" y="${y}" width="${c.pixelWidth}" height="${c.pixelHeight}" fill="${colors[(p.id-1)%colors.length]}" stroke="white"/><text x="${x+3}" y="${y+16}" font-size="12" fill="white">R${c.id}/P${p.id}</text>`);}
 for(const c of plan.builtInRegions||[]){const x=c.col*plan.module.resolution[0],y=c.row*plan.module.resolution[1];shapes.push(`<rect x="${x}" y="${y}" width="${c.pixelWidth}" height="${c.pixelHeight}" fill="#475569" stroke="white"/><text x="${x+3}" y="${y+16}" font-size="12" fill="white">${plan.controller.model}/HUB</text>`);}
 const topologySvg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plan.screen.pixelWidth} ${plan.screen.pixelHeight}">${shapes.join('')}</svg>`;
 return {bom,topology,topologySvg,hdsetSvg:plan.ports.length?require('./hdset-preview.cjs').hdsetPreview(plan).svg:null};
}
module.exports={outputPlan};
