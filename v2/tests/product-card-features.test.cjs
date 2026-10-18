'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {productView}=require('../adapters/http/quick-service.cjs');
const {productCardFeatures:features}=require('../domain/knowledge/product-card-features.cjs');
test('Dated new editions replace old members of the same family; suffix/hardware/signed identities stay separate',()=>{
 const {selectDocumentVersions}=require('../domain/knowledge/document-versions.cjs');
 const rows=['LED播放器控标点V2.3.docx','LED播放器控标点20260730V2.7.docx','LED播放器控标点 HW2 V2.3.docx','LED播放器控标点V2.7已签章.docx'].map(name=>({name}));
 const result=selectDocumentVersions(rows);assert.equal(result.withheld.length,1);assert.equal(result.withheld[0].name,rows[0].name);assert.ok(result.selected.some(d=>d.name===rows[1].name));assert.ok(result.selected.some(d=>d.name===rows[2].name));
});
test('Default product facts use current verified original; explicit old edition stays exact and source-bound',()=>{
 const {consumeProduct}=require('../domain/knowledge/consume-product.cjs');
 const product={modelId:'HD-A3L',displayName:'A3L',parameters:{load:'旧汇总',resolution:'旧汇总'},documents:[],claims:[]};
 const rows=[['V1.0',3840],['V1.1',4096]].map(([version,height],i)=>({source:{file:'synthetic-source',sha256:'a'.repeat(64)},document:{name:`HD-A3L规格书 ${version}.pdf`,sha256:String(i+1).repeat(64),sourceType:'official',verificationStatus:'verified',pages:[{page:1,text:`HD-A3L ${version}`},{page:2,text:`最大控制范围 65 万像素，水平最大（打折）支持 8192 像素，垂直最大支持 ${height} 像素；`}]}}));
 const knowledge={products:()=>[product],evidenceDocuments:()=>rows};
 const current=consumeProduct(product,knowledge);assert.equal(current.selectedDocumentVersion,'V1.1');assert.equal(current.parameters.resolution,'8192 / 4096');assert.match(current.parameters.load,/65 万/);assert.ok(current.parameterEvidence.load.every(r=>r.documentVersion==='V1.1'));
 const old=consumeProduct(product,knowledge,{documentVersion:'V1.0'});assert.equal(old.parameters.resolution,'8192 / 3840');assert.ok(old.parameterEvidence.load.every(r=>r.documentVersion==='V1.0'));assert.equal(product.parameters.load,'旧汇总');
});
test('Quick card restores distinct input/output rows and cleans indexed prefixes without inventing interface speed or counts',()=>{
 const p={modelId:'HD-KV410',parameters:{productSeries:'HD-KV410 产品系列：视频处理器',load:'HD-KV410 最大控制：260万像素',resolution:'HD-KV410 宽/高：3840 / 2500',interfaces:'HD-KV410 输出：4网口?HD-KV410 信号输入接口：HDMI 1.4×2、USB'},documents:[{kind:'spec',name:'KV410.pdf',url:'/original'}]};
 const before=structuredClone(p),card=productView(p),f=card.features;
 assert.equal(f.series,'视频处理器');assert.equal(f.load,'260万像素');assert.equal(f.inputs,'HDMI 1.4×2、USB');assert.equal(f.outputs,'网口×4');assert.equal(f.resolutionLabel,'宽高上限');assert.match(f.resolution,/独立上限/);
 assert.doesNotMatch(JSON.stringify(f),/3840×2500|千兆|USB×1/);assert.deepEqual(p,before);assert.equal(card.specGroups[0].items[0].url,'/original');
});
test('Missing type recovers from accepted explicit series claim, color/capabilities require evidence',()=>{
 const f=features({parameters:{productSeries:'HD-W62 外接传感器：温度、湿度'},claims:[{text:'HD-W62 产品系列：Wi-Fi控制卡'},{text:'W62 is a single /Dual color Wi-Fi control card'},{text:'HD-W62 内存：4M'}]});
 assert.equal(f.series,'Wi-Fi控制卡');assert.equal(f.color,'单色 / 双色');assert.match(f.highlights,/内存：4M/);
 const empty=features({modelId:'HD-W62',identityStatus:'filename-only-resource-association',parameters:{}});for(const k of ['series','color','load','inputs','outputs','highlights'])assert.equal(empty[k],'');
 assert.equal(features({parameters:{support:'支持全彩播放盒、单色发送卡'}}).color,'');
});
test('Explicit HDMI count is retained; USB standards do not become invented counts or input direction',()=>{
 const f=features({parameters:{interfaces:'Two HDMI 1.4 inputs, supporting cascade splicing.?Two USB ports (USB2.0/USB3.0) for program playback'}});
 assert.equal(f.inputs,'HDMI 1.4×2');assert.match(f.interfaces,/Two USB ports/);assert.doesNotMatch(f.interfaces,/USB2.0×2|USB3.0×2/);
});
test('Version-withheld load is never revived by selection summary; selected version provenance is sanitized',()=>{
 const f=features({parameterStatus:'document-version-conflict',parameters:{load:'',resolution:'',syncSupport:'HD-A3L 选型速查：控制范围：65万；宽/高：8192 / 3840'},claims:[],parameterEvidence:{load:[{originalName:'A3L V1.pdf',page:2,url:'/original',originalPath:'PRIVATE',file:'PRIVATE',verificationStatus:'verified'}]}});
 assert.equal(f.load,'');assert.equal(f.resolution,'');assert.match(f.notice,/版本/);assert.doesNotMatch(JSON.stringify(f.evidence),/PRIVATE/);assert.equal(f.evidence.parameterEvidence.load[0].page,2);
});
test('Conditional load and contradictory connector evidence remain literal, not a chosen maximum',()=>{
 const f=features({parameters:{load:'独立带载20万；级联接收卡65万（宽度>2048打折）',interfaces:'eight groups of HUB75E interfaces?HD-K12 接口数量：HUB75E×12'}});
 assert.match(f.load,/独立带载20万/);assert.match(f.load,/宽度>2048打折/);assert.match(f.interfaces,/eight groups/);assert.match(f.interfaces,/HUB75E×12/);
});
test('Unconfirmed placeholders and truncated unrelated excerpts never become card parameters',()=>{
 const f=features({parameters:{productSeries:'未从规格书索引中确认',load:'未从规格书索引中确认',resolution:'Dual Wi-Fi supports high-resolution wireless Internet...'},claims:[{field:'ports',text:'Support Digital Clock'}]});
 assert.equal(f.load,'');assert.equal(f.resolution,'');assert.equal(f.interfaces,'');assert.equal(f.series,'');
});
