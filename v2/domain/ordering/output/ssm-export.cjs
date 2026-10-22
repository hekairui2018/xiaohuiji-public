'use strict';
const {validatePlan}=require('../validator.cjs');
const {gridEnvelope,parseGrid,packetAudit}=require('./ssm-codec.cjs');
const encode=text=>Buffer.from(text,'utf8').toString('base64');
function planGrid(plan){
 const check=validatePlan(plan);if(!check.passed)throw Error('Cannot export invalid plan: '+check.errors.join(','));
 const cols=[...new Set(plan.cells.map(c=>c.col))].sort((a,b)=>a-b),rows=[...new Set(plan.cells.map(c=>c.row))].sort((a,b)=>a-b);
 const lines=['<?xml version="1.0" encoding="UTF-8"?>','<root>',` <rowCount value="${rows.length}"/>`,` <columnCount value="${cols.length}"/>`];
 for(const port of plan.ports){const x=Math.min(...port.cells.map(c=>c.col))*plan.module.resolution[0],y=Math.min(...port.cells.map(c=>c.row))*plan.module.resolution[1];
  lines.push(` <port port="${port.id}" x="${x}" y="${y}">`);
  for(const c of port.cells)lines.push(`  <cell column="${cols.indexOf(c.col)}" height="${c.pixelHeight}" row="${rows.indexOf(c.row)}" width="${c.pixelWidth}" x="${c.col*plan.module.resolution[0]-x}" y="${c.row*plan.module.resolution[1]-y}"/>`);
  lines.push(' </port>');
 }lines.push('</root>');return lines.join('\n');
}
function verifyGrid(gridXml,plan){
 const parsed=parseGrid(gridXml);if(parsed.ports.length!==plan.ports.length)throw Error('Port count differs');
 const cols=[...new Set(plan.cells.map(c=>c.col))].sort((a,b)=>a-b),rows=[...new Set(plan.cells.map(c=>c.row))].sort((a,b)=>a-b);
 if(parsed.rows!==rows.length||parsed.columns!==cols.length)throw Error('Receiver grid dimensions differ');
 for(let i=0;i<plan.ports.length;i++){const a=parsed.ports[i],b=plan.ports[i];if(a.port!==b.id||a.cells.length!==b.cells.length)throw Error('Port mapping differs');
  for(let j=0;j<b.cells.length;j++){const cell=b.cells[j],actual=a.cells[j];if(actual.column!==cols.indexOf(cell.col)||actual.row!==rows.indexOf(cell.row)||actual.width!==cell.pixelWidth||actual.height!==cell.pixelHeight||actual.x+a.x!==cell.col*plan.module.resolution[0]||actual.y+a.y!==cell.row*plan.module.resolution[1])throw Error('Physical receiver geometry differs');}
 }return parsed;
}
function exportSsm(result,shell){
 if(result.exportAllowed===false||result?.plan?.specialCanvas)throw Error('Special canvas is a physical preview; logical configuration mapping has not been verified');
 if(result?.plan?.architecture==='direct')throw Error('Direct HUB configuration is not a receiver-grid SSM; no verified direct export format');
 if(result?.plan?.builtInRegions?.length)throw Error('Mixed built-in HUB and receiver regions require a verified C16 configuration format; SSM export withheld');
 if(result?.operation!=='ordering'||result.status!=='ready'||result.validation?.passed!==true)throw Error('SSM requires a verified ordering result');
 const originalPackets=packetAudit(shell.xml),envelope=gridEnvelope(shell.xml),gridXml=planGrid(result.plan);verifyGrid(gridXml,result.plan);
 const outer=envelope.outer.replace('<SdandarModeBase64>'+envelope.gridValue+'</SdandarModeBase64>','<SdandarModeBase64>'+encode(gridXml)+'</SdandarModeBase64>');
 const xml=shell.xml.replace('Value="'+envelope.page+'"','Value="'+encode(outer)+'"');
 if(JSON.stringify(packetAudit(xml))!==JSON.stringify(originalPackets))throw Error('Export changed device packets');
 if(gridEnvelope(xml).gridXml!==gridXml)throw Error('SSM round trip differs');
 return {xml,gridXml,metadata:{format:'HDSet-standard-grid',packetCount:originalPackets.length,ports:result.plan.ports.length,receivers:result.plan.cells.length,source:shell.manifest,devicePacketModified:false,hardwareDownloadVerified:false,verificationScope:result.plan.ports.length<=16?'historical-standard-grid-import-evidence':'requires-corresponding-hardware-import-validation'}};
}
module.exports={planGrid,verifyGrid,exportSsm};
