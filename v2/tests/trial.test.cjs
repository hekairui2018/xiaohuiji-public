'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {createOriginalResource}=require('../adapters/http/original-resource.cjs'),{createApp}=require('../app/bootstrap.cjs'),{startTrial}=require('../tools/start-trial.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{createDialogueService}=require('../adapters/http/dialogue-service.cjs');
test('Original resource is a registered hash with integrity checks, not an arbitrary path downloader',async()=>{
 const dir=path.resolve(__dirname,'../../tmp/v2-stage17/resource-test');fs.mkdirSync(dir,{recursive:true});const originalPath=path.join(dir,'original.pdf'),bytes=Buffer.from('%PDF-1.4\nregistered trial fixture\n');fs.writeFileSync(originalPath,bytes);const sha=crypto.createHash('sha256').update(bytes).digest('hex');
 const serve=createOriginalResource({evidenceDocuments:()=>[{document:{name:'original.pdf',originalPath,sha256:sha}}]}),server=http.createServer((req,res)=>serve(req.url.slice(1),res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{let r=await fetch(base+'/'+sha);assert.equal(r.status,200);assert.equal(r.headers.get('x-original-sha256'),sha);assert.equal(await r.text(),bytes.toString());assert.equal((await fetch(base+'/'+('a'.repeat(64)))).status,404);fs.writeFileSync(originalPath,'%PDF-changed');assert.equal((await fetch(base+'/'+sha)).status,409);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('Actual C16L matched record lacking checks asks its own conditions instead of borrowing another case solution',async()=>{
 const k=loadKnowledge(path.resolve(__dirname,'../data/knowledge-next'),{manifestFile:'candidate-manifest.json'}),app=createApp({knowledge:k}),chat=createDialogueService(app),sessionId='stage17-c16l';
 const receiver=app.quickLookup({modelId:'R712'}).records[0];assert.match(receiver.parameters.productSeries,/接收卡|Receiving Card/i);assert.ok(receiver.parameterEvidence.productSeries[0].originalSha256);
 let r=await chat({sessionId,message:'C16L 换LED模组后右边几排颜色不正常闪烁，HDPlayer能找到设备且发送成功，如何排查？'});assert.equal(r.result.diagnosis.candidates[0].legacyId,'AS-0132');assert.equal(r.result.diagnosis.activeCaseId,r.result.diagnosis.candidates[0].caseId);assert.match(r.reply,/2宽6高/);
 r=await chat({sessionId,message:'不知道芯片型号'});assert.equal(r.result.diagnosis.state,'confirm-scope');assert.equal(r.result.status,'needs_input');
 r=await chat({sessionId,message:'条件一致'});assert.equal(r.result.diagnosis.state,'insufficient-executable-evidence');assert.equal(r.result.diagnosis.historicalSolution,null);assert.equal(r.result.diagnosis.conclusion,null);assert.match(r.reply,/缺少可执行排查步骤/);
});
test('Trial rejects production/development ports and cannot pretend a reserved model is online',()=>{
 const file=path.resolve(__dirname,'../../tmp/v2-stage17/invalid-trial-config.json');
 fs.writeFileSync(file,JSON.stringify({host:'127.0.0.1',port:3789}));assert.throws(()=>startTrial(file),/cannot be reused/);
 fs.writeFileSync(file,JSON.stringify({host:'127.0.0.1',port:4499,model:{enabled:true}}));assert.throws(()=>startTrial(file),/not yet connected/);
});
test('Existing independent log wording reaches deterministic fault and incomplete ordering routes',async()=>{
 const app=createApp();for(const q of ['P3 1920×1080 同步','客户要做一块P10全彩LED显示屏，选控制卡时需要确认哪些关键参数？']){const r=await app.dialogue(q);assert.equal(r.operation,'ordering');assert.equal(r.status,'needs_input');assert.ok(r.missing_parameters.length);assert.ok(!r.plan);if(q.startsWith('P3')){assert.equal(r.normalizedDemand.screen.pixelWidth,1920);assert.equal(r.normalizedDemand.screen.pixelHeight,1080);}}
 for(const q of ['A4 控制卡之前能连WiFi，现在手机搜不到WiFi名称，如何排查？','请检索与“A4 控制卡手机搜索不到 WiFi 名称/SSID”直接相关的售后案例。排除WiFi连接失败案例']){const r=await app.dialogue(q);assert.equal(r.operation,'aftersales');assert.equal(r.status,'needs_input');assert.equal(r.diagnosis.conclusion,null);for(const c of r.diagnosis.candidates)assert.match(app.quickLookup({modelId:'A4'}).status,/found/);}
});
