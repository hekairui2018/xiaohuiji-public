'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createApp}=require('../app/bootstrap.cjs'),{createServer}=require('../adapters/http/server.cjs');
const {loadKnowledge}=require('../adapters/data/load-knowledge.cjs'),{loadResourceEvidence}=require('../adapters/data/load-resource-evidence.cjs');
const {createDialogueService}=require('../adapters/http/dialogue-service.cjs');
const app=createApp(),knowledge=loadKnowledge(),chips=loadResourceEvidence().chips.data.rows,normalize=s=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,'');
test('Chip lookup returns original rows for full models and preserves similar suffixes, numeric aliases and absent evidence',()=>{
 let checked=0;for(const row of chips)for(const model of row.models){if(!/[0-9]/.test(model))continue;const r=app.chipLookup(model);assert.ok(r,model);
  const expected=chips.filter(c=>[...c.models,...(c.numericAliases||[])].some(m=>normalize(m)===normalize(model)));
  assert.deepEqual(r.items.map(i=>[i.models,i.smartSelection,i.firmwareType,i.page]),expected.map(i=>[i.models,i.smartSelection,i.firmwareType,i.page]));assert.ok(r.items.every(i=>i.sourceReference.sha256));checked++;
 }assert.ok(checked>249);
 assert.equal(app.chipLookup('2053').family,app.chipLookup('ICN2053').family);assert.equal(app.chipLookup('SM16169S').family,'common');assert.equal(app.chipLookup('SM16169SH').family,'65');assert.equal(app.chipLookup('SM16169SHA'),null);assert.equal(app.chipLookup('ICND2055').family,null);assert.equal(app.chipLookup('ICND2055').files.length,0);
});
test('Every chip firmware link is an actual manifest file of the exact card and preserves conditions without claiming compatibility',()=>{
 const r=app.chipLookup('SM16169SH',[{modelId:'R712'}]),original=knowledge.findProducts('R712')[0].firmware;assert.ok(r.files.length);
 for(const f of r.files){assert.equal(f.modelId,'HD-R712');assert.equal(f.series,'65');assert.equal(f.compatibilityConfirmed,false);assert.ok(original.some(o=>o.file===f.file&&o.publicUrl===f.publicUrl&&o.hwFromFile===f.hwFromFile));}
 const unknown=app.resourceLookup('R712 SM16169SH固件',{providedDevices:[{modelId:'R712',revisionId:'E99'}]});assert.equal(unknown.status,'needs_input');assert.equal(unknown.items.length,0);
 const c16h=app.chipLookup('SM16169SH',[{modelId:'C16H'}]);assert.ok(c16h.view.primary.facts.some(f=>f.text.includes('尚未确认交付原文件')));assert.equal(c16h.files.length,0);
});
test('Firmware reverse query keeps exact model, file variant and source version; a conflicting model cannot acquire its download',async()=>{
 const source=knowledge.findProducts('R712')[0].firmware.find(f=>f.status==='uploaded'&&f.variant==='E1');assert.ok(source);
 const exact=app.resourceLookup(source.file);assert.equal(exact.kind,'firmware');assert.equal(exact.items.length,1);assert.equal(exact.items[0].variant,'E1');assert.equal(exact.items[0].publicUrl,source.publicUrl);
 const conflict=await app.dialogue({schemaVersion:'2.0',operation:'consultation',topic:source.file,providedDevices:[{modelId:'R716'}]});assert.equal(conflict.status,'conflict');assert.equal(conflict.resources.items.length,0);
 const r=await app.dialogue('R712固件');assert.equal(r.resources.kind,'firmware');assert.ok(r.resources.items.every(f=>f.modelId==='HD-R712'));
 const docs=await app.dialogue('A3L规格书');assert.ok(docs.resources.items.every(d=>d.modelId==='HD-A3L'&&!/^A3(?!L)/i.test(d.name)));
});
test('Software download, original manual versions and actual videos are linked without losing existing media',()=>{
 const sw=app.resourceMedia.softwareItems('hd set')[0];assert.equal(sw.id,'HDSet');assert.equal(sw.version,knowledge.assets().softwareCatalog.find(s=>s.id==='HDSet').version);assert.ok(sw.downloadUrl);assert.ok(sw.manuals.length);assert.ok(sw.videos.primary);
 const original=knowledge.assets().videos.filter(v=>v.status==='uploaded'&&v.publicUrl),video=app.resourceMedia.videoCategory('');assert.deepEqual(video.groups.flatMap(g=>g.videos.map(v=>v.url)),original.map(v=>v.publicUrl));assert.equal(video.topicGroups.reduce((s,g)=>s+g.count,0),original.length);
 assert.ok(app.resourceMedia.videoCategory('重置').total);assert.ok(app.resourceMedia.videoCategory('优盘').total);assert.equal(app.resourceMedia.softwareItems('不存在的软件ZXYZ').length,0);
 const mutated=app.resourceLookup('ICN2053');mutated.items[0].firmwareType='伪造';assert.notEqual(app.resourceLookup('ICN2053').items[0].firmwareType,'伪造');
});
test('Quick chip/software/video/product routes never invoke dialogue handlers, including both current page addresses',async()=>{
 let calls=0;const fail=()=>{calls++;throw Error('Dialogue must stay separate');};const server=createServer(createApp({handlers:{ordering:fail,aftersales:fail,consultation:fail}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const route of ['/quick','/huiai'])assert.equal((await fetch(base+route)).status,200);
  const chip=await fetch(base+'/api/search?q=2053').then(r=>r.json());assert.ok(chip.chipFirmware.primary.facts.length);assert.ok(chip.chipFirmware.firmwareItems.length);
  const model=await fetch(base+'/api/search?q='+encodeURIComponent('R712固件')).then(r=>r.json());assert.equal(model.results[0].name,'HD-R712');assert.ok(model.relatedChips.length);
  const software=await fetch(base+'/api/software?q=HDSet').then(r=>r.json());assert.ok(software.software.items[0].videos.primary);
  const video=await fetch(base+'/api/videos?q='+encodeURIComponent('复位')).then(r=>r.json());assert.ok(video.video.topicGroups.some(g=>g.key==='reset'));assert.equal(calls,0);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Dialogue consults shared firmware/chip/media knowledge without traversing quick or invoking a model',async()=>{
 const isolated={...app,quickLookup(){throw Error('No quick route');},quickSearch(){throw Error('No quick route');}},chat=createDialogueService(isolated);
 for(const text of ['ICN2053固件','R712固件','HDSet软件','复位视频','A3L规格书']){const r=await chat({message:text});assert.equal(r.result.operation,'consultation');assert.equal(r.status,'answer');assert.ok(r.reply.length>10);assert.ok(!r.reply.includes('undefined'));}
 const missingVideo=await chat({message:'SM16169S视频'});assert.equal(missingVideo.status,'clarify');assert.equal(missingVideo.result.resources.kind,'videos');assert.equal(missingVideo.result.resources.items.length,0);
 const softwareVideo=await chat({message:'HDSet教程'});assert.equal(softwareVideo.status,'answer');assert.equal(softwareVideo.result.resources.kind,'videos');assert.ok(softwareVideo.result.resources.items.every(v=>v.ossKey.includes('/hdset/')||v.name.toLowerCase().includes('hdset')));
});
test('Huiai renders inline media and clickable original files rather than losing them in plain text or calling quick',()=>{
 class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};this.scrollTop=0;}appendChild(n){this.children.push(n);}append(...nodes){this.children.push(...nodes);}getBoundingClientRect(){return {top:0};}}
 const calls=[],ctx={document:{createElement:tag=>new Element(tag)},aiMessages:new Element('messages'),lastNumericOptions:null,renderSoftware:s=>{calls.push(['software',s]);return new Element('software');},renderVideoAnswer:v=>{calls.push(['videos',v]);return new Element('video');},renderChipFirmwareCard:v=>{calls.push(['chips',v]);return 'safe-card';},renderNearbyChips:()=>new Element('nearby')};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('frontend/v2-components.js','utf8'),ctx);
 const source=fs.readFileSync('frontend/app.js','utf8'),start=source.indexOf('function addAssistantMessage(data)'),end=source.indexOf('function renderSoftware(sw)',start);vm.runInContext(source.slice(start,end),ctx);
 for(const query of ['HDSet软件','复位视频','ICN2053固件','R712固件','A3L规格书'])ctx.addAssistantMessage({model:'v2-rules',status:'answer',result:{resources:app.resourceLookup(query)},reply:'source reply'});
 assert.ok(calls.find(([kind,sw])=>kind==='software'&&sw.items[0].videos.primary.url));assert.ok(calls.find(([kind,vs])=>kind==='videos'&&vs.every(v=>v.url)));assert.ok(calls.some(([kind])=>kind==='chips'));assert.ok(ctx.lastNumericOptions===null);
 const files=ctx.aiMessages.children.slice(-2).flatMap(m=>m.children[0].children[0].children).flatMap(p=>p.children).filter(e=>e.tag==='a');assert.ok(files.some(a=>a.href.includes('.bin')));assert.ok(files.some(a=>a.href.includes('.pdf')));
 const malicious=ctx.renderV2ResourceLinks({kind:'documents',items:[{name:'unsafe',url:'javascript:alert(1)'}]});assert.equal(malicious.children[0].children.length,0);
});
