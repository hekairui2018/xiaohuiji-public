'use strict';
// Reuse V1's presentation-only renderer. Geometry and chain order are supplied
// by the V2 plan; importing the V1 ordering engine is deliberately unnecessary.
const {render}=require('../../../../backend/ordering/render-hdset.cjs');
function hdsetPreview(plan){
 const cards=[],ports=[],wires=[];
 for(const port of plan.ports){const indices=[];
  for(const cell of port.cells){const idx=cards.length;indices.push(idx);cards.push({idx,gridId:cell.id-1,port:port.id,seqInPort:indices.length-1,role:indices.length===1?'S':'M',col:cell.col,row:cell.row,x:cell.col*plan.module.resolution[0],y:cell.row*plan.module.resolution[1],w:cell.pixelWidth,h:cell.pixelHeight});}
  if(indices.length>1)cards[indices.at(-1)].role='E';
  for(let i=1;i<indices.length;i++){const a=cards[indices[i-1]],b=cards[indices[i]];wires.push({port:port.id,from:a.idx,to:b.idx,dir:b.y>a.y?'down':b.y<a.y?'up':b.x>a.x?'right':'left'});}
  ports.push({id:port.id,c0:Math.min(...port.cells.map(c=>c.col)),c1:Math.max(...port.cells.map(c=>c.col+c.columns)),cardCount:indices.length,cardIdx:indices,pxW:port.pixelWidth,pxH:port.pixelHeight,points:port.points,loadPct:port.points/655360*100,sCard:indices[0],eCard:indices.at(-1)});
 }
 const topology={schema:'xhj-topo/1',screen:{w:plan.screen.pixelWidth,h:plan.screen.pixelHeight},grid:{cols:new Set(plan.cells.map(c=>c.col)).size,rows:new Set(plan.cells.map(c=>c.row)).size,cardCount:cards.length},route:{id:'h-TL',major:'h',corner:'TL'},portCapacity:655360,cards,ports,wires};
 const label=String(plan.controller.model).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const svg=render(topology,{proc:plan.controller.model}).replace(/(<svg\b[^>]*>)/,'$1<title>'+label+' · '+plan.screen.pixelWidth+'×'+plan.screen.pixelHeight+'</title>');
 return {topology,svg};
}
module.exports={hdsetPreview};
