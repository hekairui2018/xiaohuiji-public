'use strict';
const {report}=require('./report.cjs');
const {gridEnvelope,parseGrid,packetAudit}=require('../domain/ordering/output/ssm-codec.cjs');
function auditSsm(exported,result,shell){const r=report('ssm');try{
 const actual=gridEnvelope(exported.xml),original=gridEnvelope(shell.xml),grid=parseGrid(actual.gridXml),plan=result.plan;
 r.check('standard-file-structure',/^\s*<\?xml/.test(exported.xml)&&exported.xml.includes('<BoxHwConfig>')&&exported.xml.includes('</BoxHwConfig>'));
 r.check('crc-and-packet-invariance',JSON.stringify(packetAudit(exported.xml))===JSON.stringify(packetAudit(shell.xml)));
 r.check('outside-page-unchanged',exported.xml.replace(actual.page,'GRID_PAGE')===shell.xml.replace(original.page,'GRID_PAGE'));
 r.check('device-bin-unchanged',actual.outer.replace(actual.gridValue,'GRID')===original.outer.replace(original.gridValue,'GRID'));
 r.check('grid-roundtrip',actual.gridXml===exported.gridXml);
 const cols=[...new Set(plan.cells.map(c=>c.col))].sort((a,b)=>a-b),rows=[...new Set(plan.cells.map(c=>c.row))].sort((a,b)=>a-b);
 r.check('grid-dimensions',grid.columns===cols.length&&grid.rows===rows.length&&grid.ports.length===plan.ports.length);
 let geometry=true;const seen=new Set();for(let i=0;i<grid.ports.length;i++){const p=grid.ports[i],expected=plan.ports[i];if(p.port!==expected.id||p.cells.length!==expected.cells.length)geometry=false;
  for(let j=0;j<p.cells.length;j++){const c=p.cells[j],target=expected.cells[j];if(!target){geometry=false;continue;}
   const key=c.column+':'+c.row;if(seen.has(key))geometry=false;seen.add(key);
   if(c.column!==cols.indexOf(target.col)||c.row!==rows.indexOf(target.row)||c.x+p.x!==target.col*plan.module.resolution[0]||c.y+p.y!==target.row*plan.module.resolution[1]||c.width!==target.pixelWidth||c.height!==target.pixelHeight)geometry=false;
  }
 }r.check('physical-grid-coordinates',geometry&&seen.size===plan.cells.length);
 r.check('grid-area',grid.ports.reduce((sum,p)=>sum+p.cells.reduce((n,c)=>n+c.width*c.height,0),0)===plan.screen.points);
 r.check('no-hardware-verification-claim',exported.metadata.hardwareDownloadVerified===false);
 r.pending('actual-hdset-import-and-download','实际设备型号、固件、导入画布和下发效果待人工/真机验证；不阻塞离线开发',{ports:plan.ports.length,source:shell.manifest});
 }catch(error){r.check('ssm-output-structure',false,error.message);}return r.finish();}
module.exports={auditSsm};
