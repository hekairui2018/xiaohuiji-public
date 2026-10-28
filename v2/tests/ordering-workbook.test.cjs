'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {conversationDefaults}=require('../domain/ordering/conversation-defaults.cjs');
test('workbook contains selected quantities, sheet relationships and an embedded connection image',async()=>{
 const box={window:{},TextEncoder,Uint8Array,DataView,Blob,Image:class{naturalWidth=800;naturalHeight=400;async decode(){}},document:{createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toBlob:fn=>fn(new Blob([new Uint8Array([137,80,78,71])]))})}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/ordering-workbook.js'),'utf8'),box);
 const plan={module:{dotPitch:{spacing:2},resolution:[160,80],size:[320,160],interface:'HUB75'},screen:{pixelWidth:1600,pixelHeight:800,columns:10,rows:10},ports:[{id:1,points:1280000,cells:[{id:1},{id:2}]}]};
 const result={plan,hdsetSvg:'<svg/>',exportAllowed:false,previewBom:[{kind:'controller',modelId:'EXAMPLE-SELECTED',quantity:1}],defaults:[{label:'室内'}]};
 const bytes=Buffer.from(await(await box.window.OrderingWorkbook.build(result)).arrayBuffer()),parts=new Map();let at=0;
 while(bytes.readUInt32LE(at)===0x04034b50){const size=bytes.readUInt32LE(at+18),nameSize=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),name=bytes.subarray(at+30,at+30+nameSize).toString(),start=at+30+nameSize+extra;parts.set(name,bytes.subarray(start,start+size));at=start+size;}
 const sheet=parts.get('xl/worksheets/sheet1.xml').toString();assert.match(sheet,/EXAMPLE-SELECTED/);assert.match(sheet,/1600×800/);assert.match(sheet,/默认 室内/);assert(parts.has('xl/media/connection.png'));assert.match(parts.get('xl/drawings/drawing1.xml').toString(),/oneCellAnchor/);assert.match(sheet,/<drawing r:id="rId1"/);assert.equal(result.previewBom[0].quantity,1);
});
test('defaults are disclosed independently and explicit supplied values win',()=>{
 const original={environment:'outdoor',module:{interface:'HUB320'}},r=conversationDefaults(original);
 assert.equal(r.demand.environment,'outdoor');assert.equal(r.demand.module.interface,'HUB320');assert.equal(r.demand.controlMode,'sync');assert.equal(original.controlMode,undefined);assert(r.defaults.some(d=>d.path==='/controlMode'));assert(!r.defaults.some(d=>d.path==='/environment'));
});
