'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createApp}=require('../app/bootstrap.cjs');
const {loadSsmShell}=require('../adapters/data/load-ssm-shell.cjs');
const {gridEnvelope,parseGrid,packetAudit,crc32}=require('../domain/ordering/output/ssm-codec.cjs');
const {verifyGrid,exportSsm}=require('../domain/ordering/output/ssm-export.cjs');
// Independent legacy decoder is an oracle in tests only; production v2 never imports it.
const {parseSsm}=require('../../backend/ordering/ssm-codec.cjs');
const app=createApp(),shell=loadSsmShell();
const demand={schemaVersion:'2.0',operation:'ordering',controlMode:'sync',architecture:'receiver',environment:'indoor',module:{pitchMm:2,pixelWidth:160,pixelHeight:80,scan:{numerator:1,denominator:40},interface:'HUB75',color:{r:1,g:1,b:1}},screen:{moduleColumns:10,moduleRows:8},providedDevices:[{modelId:'R716'}]};
test('Independent V2 export reproduces actual HDSet standard P2 engineering grid byte for byte',async()=>{
 const result=await app.dialogue(demand),exported=exportSsm(result,shell);
 const original=fs.readFileSync('backend/ordering/ssm-fixtures/standard-2port-p2-160x640.ssm','utf8');
 assert.equal(exported.gridXml.trim(),gridEnvelope(original).gridXml.trim());
 assert.equal(parseSsm(exported.xml).packetCount,25);assert.ok(parseSsm(exported.xml).packets.every(p=>p.crcOk));
 assert.deepEqual(packetAudit(exported.xml),packetAudit(original));assert.equal(exported.metadata.hardwareDownloadVerified,false);
});
test('Actual standard two-card source is decoded with its original route rather than rewritten',()=>{
 const xml=fs.readFileSync('backend/ordering/ssm-fixtures/standard-2card-416x624.ssm','utf8');const grid=parseGrid(gridEnvelope(xml).gridXml);
 assert.equal(grid.ports[0].cells.length,2);assert.deepEqual(grid.ports[0].cells.map(c=>[c.row,c.width,c.height,c.y]),[[1,416,312,312],[0,416,312,0]]);assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
});
test('Nonuniform edge cards and receiver-grid indices retain correct physical coordinates',async()=>{
 const input=structuredClone(demand);input.module={pitchMm:2,pixelWidth:128,pixelHeight:64,scan:{numerator:1,denominator:32},interface:'HUB75',color:{r:1,g:1,b:1}};input.screen={moduleColumns:13,moduleRows:23};
 const result=await app.dialogue(input);assert.equal(result.status,'ready');const out=exportSsm(result,shell),grid=parseGrid(out.gridXml);
 assert.ok(new Set(grid.ports.flatMap(p=>p.cells.map(c=>c.height))).size>1);assert.equal(grid.ports.reduce((n,p)=>n+p.cells.reduce((s,c)=>s+c.width*c.height,0),0),result.plan.screen.points);
 assert.throws(()=>verifyGrid(out.gridXml.replace('column="0"','column="99"'),result.plan),/geometry/);
});
test('Invalid plans, duplicate envelope and corrupt packet data fail closed',async()=>{
 const result=await app.dialogue(demand),bad=structuredClone(result);bad.plan.ports[0].points=1;assert.throws(()=>exportSsm(bad,shell),/invalid plan/);
 assert.throws(()=>gridEnvelope(shell.xml.replace('<BoxHwConfig>','<BoxHwConfig><SendCardPage Value="AAAA"/>')),/one SendCardPage/);
 const packet=packetAudit(shell.xml)[0],bytes=Buffer.from(packet,'base64');bytes[9]^=1;assert.throws(()=>packetAudit(shell.xml.replace(packet,bytes.toString('base64'))),/integrity/);
 assert.throws(()=>gridEnvelope('<!DOCTYPE a>'+shell.xml),/Unsafe/);
});
test('SSM download validates the standard demand and exports real XML instead of accepting an injected plan',async()=>{
 const {createServer}=require('../adapters/http/server.cjs');const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const post=data=>fetch('http://127.0.0.1:'+server.address().port+'/v2/ordering/ssm',{method:'POST',body:JSON.stringify(data)});
  const response=await post(demand);assert.equal(response.status,200);assert.ok(response.headers.get('content-disposition').includes('.ssm'));assert.equal(parseSsm(await response.text()).packetCount,25);
  assert.equal((await post({...demand,plan:{}})).status,400);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
