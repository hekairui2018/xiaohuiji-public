'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {augmentProducts,latestFirmware}=require('../domain/knowledge/local-resource-catalog.cjs');
test('New local documents preserve exact suffix identity and never overwrite parameters',()=>{
 const products=[{modelId:'HD-A3',parameters:{load:'original'},documents:[],firmware:[]},{modelId:'HD-A3L',parameters:{},documents:[],firmware:[]}];
 const result=augmentProducts(products,[{name:'A3L规格书 V2.0.pdf',locationId:1,sha256:'a'.repeat(64)},{name:'A3L说明书.pdf',locationId:2},{name:'X9规格书 V1.0.pdf',locationId:3}]);
 assert.equal(result.find(p=>p.modelId==='HD-A3').documents.length,0);assert.equal(result.find(p=>p.modelId==='HD-A3L').documents.length,2);assert.equal(result.find(p=>p.modelId==='HD-X9').identityStatus,'filename-only-resource-association');assert.equal(result[0].parameters.load,'original');assert.equal(products[1].documents.length,0);
});
test('Firmware latest selection retains hardware, chip tags and MCU conditions',()=>{
 const files=['R7_FPGA_V24.01.01.30.bin','R7_FPGA_V25.01.01.30.bin','R7_FPGA_V24.01.01.31.bin','R7_FPGA_V24.01.01.30_E1.bin','R7_FPGA_V24.01.01.30_MCU_V1.0.bin'];
 const result=latestFirmware(files.map(file=>({file}))).map(f=>f.file);assert.equal(result.length,4);assert.ok(!result.includes(files[0]));assert.ok(result.includes(files[2]));assert.ok(result.includes(files[3]));assert.ok(result.includes(files[4]));
});

test('Known named accessories retain exact source documents without inventing numeric model IDs',()=>{
 const products=[{modelId:null,displayName:'HD-IR-SENSOR',documents:[]},{modelId:null,displayName:'USB无线设备',documents:[]}];
 const rows=augmentProducts(products,[{name:'HD-IR-SENSOR规格书V1.0.pdf',locationId:1},{name:'HD-IR-SENSORPLUS规格书V1.0.pdf',locationId:2},{name:'USB无线设备说明书.pdf',locationId:3},{name:'HD-IR-SENSOR规格书V2.0.pdf',locationId:4,folders:['签章规格书']}]);
 assert.equal(rows[0].modelId,null);assert.equal(rows[0].documents.length,1);assert.equal(rows[0].documents[0].name,'HD-IR-SENSOR规格书V1.0.pdf');assert.equal(rows[1].documents.length,1);
});
test('Legacy underscore version notation is comparable; unresolved new binaries stay in raw search',()=>{
 const result=latestFirmware([{file:'C16L_FPGA_9_16_85_65.bin',status:'local-indexed'},{file:'C16L_FPGA_9_17_85_65.bin',status:'local-indexed'},{file:'R7_fpga_CHIP9_V19.03.01.17.bin',status:'local-indexed'},{file:'R7_fpga_CHIP9_V19.04.01.17.bin',status:'local-indexed'},{file:'opaque.bin',status:'local-indexed'}]);
 assert.deepEqual(result.map(r=>r.file),['C16L_FPGA_9_17_85_65.bin','R7_fpga_CHIP9_V19.04.01.17.bin']);
});
test('Plus suffix never joins the base model, and unknown firmware names stay unassigned',()=>{
 const result=augmentProducts([{modelId:'HD-R5S',documents:[],firmware:[]},{modelId:'HD-R5SPLUS',documents:[],firmware:[]}],[{name:'R5s_Plus_FPGA_V25.01.01.37.bin',locationId:1,resourceType:'firmware'},{name:'Unknown9_FPGA_V1.0.0.1.bin',locationId:2,resourceType:'firmware'},{name:'EF_30_3840x2160.bin',locationId:3,resourceType:'file'}]);
 assert.equal(result[0].firmware.length,0);assert.equal(result[1].firmware.length,1);assert.equal(result[2].modelId,null);assert.equal(result[2].firmware.length,1);
});
test('New local videos reach both frontend grouping shapes and respect search',async()=>{
 const http=require('node:http'),{createOfflineKnowledge}=require('../adapters/http/offline-knowledge.cjs');
 const upstream=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/catalog')return res.end(JSON.stringify({resources:[{name:'新增复位.mp4',locationId:10,sizeBytes:100},{name:'新增联网.mp4',locationId:11,sizeBytes:200}]}));let b='';for await(const c of req)b+=c;res.end(JSON.stringify({results:JSON.parse(b).items.map((x,i)=>({available:true,locationId:i+10,sizeBytes:100}))}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));try{const k=createOfflineKnowledge({resourceBase:'http://127.0.0.1:'+upstream.address().port});const body=await k.localizeMedia({query:'复位',video:{total:0,groups:[],topicGroups:[]}});assert.equal(body.video.total,1);assert.equal(body.video.groups[0].videos[0].sourceMode,'local');assert.equal(body.video.topicGroups[0].videos[0].name,'新增复位.mp4');}finally{await new Promise(r=>upstream.close(r));}
});
test('Public catalog never invokes local additions or binary rewriting',async()=>{
 const {createServer}=require('../adapters/http/server.cjs');const server=createServer(undefined,{accessGuard:req=>{req.v2Public=true;return true;},publicCatalog:{transform:x=>x},offlineKnowledge:{handle:async()=>false,localCatalog:async()=>{throw Error('internal catalog must not run');},localizeMedia:async()=>{throw Error('internal media must not run');}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/api/videos')).status,200);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
