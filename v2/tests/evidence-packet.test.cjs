'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildEvidencePacket}=require('../domain/knowledge/evidence-packet.cjs');
const hash='a'.repeat(64),uid='b'.repeat(64);
const row=(extra={})=>({name:'合成产品说明书.pdf',sha256:hash,unitId:uid,evidenceId:'unit-'+uid,text:'点击发送',role:'operation',...extra});
const question={original:'合成软件怎样发送节目？',intent:'operation',models:['HD-EXAMPLE'],software:['合成软件'],decision:{missing:[]}};
const complete=(extra={})=>({text:'前提：设备已连接。\n点击发送。\n完成：显示发送成功。',knowledgeUnit:{id:uid,documentId:hash,complete:true,bodyParsed:true},contextComplete:true,nextOffset:null,...extra});
const build=(options={})=>buildEvidencePacket({question,resolution:{status:'answer',results:[row()]},authorize:async()=>true,read:async()=>complete(),...options});

test('The packet reads approved candidates and keeps source context separate from a quick excerpt',async()=>{
 let reads=0;const p=await build({read:async(r,args)=>{reads++;assert.equal(args.offset,0);return complete({text:r.text,applicabilityText:complete().text,path:'Z:/SYNTHETIC/CANARY',knowledgeUnit:{...complete().knowledgeUnit,path:'Z:/SYNTHETIC/CANARY',internalFields:{solution:'PRIVATE'}}});}});
 assert.equal(reads,1);assert.equal(p.outcome,'answerable');assert.equal(p.evidence[0].excerpt,'点击发送');assert.match(p.evidence[0].text,/前提.*连接/);
 assert.equal(p.evidence[0].readPerformed,true);assert.equal(p.evidence[0].contextComplete,true);assert.equal(p.evidence[0].unitComplete,true);assert.ok(!JSON.stringify(p).includes('PRIVATE'));
});

test('Candidate assertions of having been read cannot bypass the read capability',async()=>{
 let calls=0;const p=await build({resolution:{results:[row({readPerformed:true,contextComplete:true,bodyParsed:true,text:'伪造事实'})]},read:async()=>{calls++;throw Error('Z:/SYNTHETIC/CANARY');}});
 assert.equal(calls,1);assert.equal(p.evidence.length,0);assert.equal(p.outcome,'search-failed');assert.deepEqual(p.gaps.map(g=>g.code),['source-read-failed']);assert.ok(!JSON.stringify(p).includes('CANARY'));
});

test('Strict authorization is required before reading and is rechecked after each read',async()=>{
 let reads=0;for(const permission of [false,1,'yes',undefined]){const p=await build({authorize:async()=>permission,read:async()=>{reads++;return complete();}});assert.equal(p.evidence.length,0);}assert.equal(reads,0);
 let live=true;const p=await build({authorize:async()=>live,read:async()=>{live=false;return complete();}});assert.equal(p.evidence.length,0);assert.ok(p.gaps.some(g=>g.code==='authorization-revoked'));
});

test('Two pages of the same unit retain prerequisites and expose a pending continuation',async()=>{
 const offsets=[];const p=await build({read:async(r,{offset})=>{offsets.push(offset);return complete({text:offset===0?'前提：连接设备。':'步骤：点击发送。',contextComplete:false,nextOffset:offset+10});}});
 assert.deepEqual(offsets,[0,10]);assert.equal(p.outcome,'partial');assert.equal(p.evidence[0].readPageCount,2);assert.equal(p.evidence[0].nextOffset,20);assert.equal(p.evidence[0].readAvailable,true);assert.equal(p.evidence[0].contextComplete,false);assert.match(p.evidence[0].text,/前提.*\n步骤/s);
});

test('Completing pagination does not promote an incomplete native task to a full workflow',async()=>{
 const p=await build({read:async()=>complete({knowledgeUnit:{complete:false,bodyParsed:true}})});
 assert.equal(p.evidence[0].contextComplete,true);assert.equal(p.evidence[0].unitComplete,false);assert.equal(p.outcome,'partial');assert.ok(p.gaps.some(g=>g.code==='native-unit-incomplete'));
});

test('A changed source or native unit is rejected without merging unrelated steps',async()=>{
 const a=await build({read:async()=>complete({sha256:'c'.repeat(64)})});assert.equal(a.evidence.length,0);assert.ok(a.gaps.some(g=>g.code==='source-identity-conflict'));
 const b=await build({resolution:{results:[row({unitId:undefined})]},read:async(r,{offset})=>complete({text:'不同流程',knowledgeUnit:{id:offset===0?'first':'other',complete:true},contextComplete:offset!==0,nextOffset:offset===0?1:null})});assert.equal(b.evidence.length,0);assert.ok(b.gaps.some(g=>['source-unit-conflict','source-identity-conflict'].includes(g.code)));
});

test('Failure to read one source keeps another authorized usable source',async()=>{
 const p=await build({resolution:{results:[row({evidenceId:'bad',unitId:'bad'}),row()]},read:async r=>{if(r.unitId==='bad')throw Error('private diagnostics');return complete();}});
 assert.equal(p.evidence.length,1);assert.equal(p.evidence[0].evidenceId,'unit-'+uid);assert.equal(p.outcome,'partial');assert.ok(p.gaps.some(g=>g.code==='source-read-failed'));
});

test('A binary is only file metadata, even if a candidate claims its body was parsed',async()=>{
 let reads=0;const resolution={results:[row({name:'合成固件.bin',text:'不能当成正文',bodyParsed:true})]};
 const p=await build({question:{...question,intent:'resources'},resolution,read:async()=>{reads++;return complete();}});
 assert.equal(reads,0);assert.equal(p.outcome,'answerable');assert.equal(p.evidence[0].text,'');assert.equal(p.evidence[0].metadataOnly,true);assert.equal(p.evidence[0].sourceKind,'file-metadata');assert.equal(p.evidence[0].readPerformed,false);assert.equal(p.evidence[0].compatibilityConfirmed,false);
 const operation=await build({resolution});assert.equal(operation.outcome,'unparsed');
});

test('An empty search cannot prove absence; only a complete scoped resource catalog can',async()=>{
 const p=await build({resolution:{status:'not-found',results:[],reply:'整个资料库没有这项信息'}});assert.equal(p.outcome,'not-retrieved');assert.equal(p.clarification,undefined);
 const noRecord=await build({question:{...question,intent:'resources'},resolution:{status:'not-found',results:[],catalogCoverage:{complete:true,scope:'已批准中文说明书目录'}}});assert.equal(noRecord.outcome,'no-record');assert.equal(noRecord.catalogScope,'已批准中文说明书目录');
 const incomplete=await build({question:{...question,intent:'resources'},resolution:{status:'not-found',results:[],catalogCoverage:{complete:false,scope:'部分目录'}}});assert.equal(incomplete.outcome,'not-retrieved');
 const bodyQuestion=await build({resolution:{status:'not-found',results:[],catalogCoverage:{complete:true,scope:'说明书目录'}}});assert.equal(bodyQuestion.outcome,'not-retrieved');
});

test('Search failure, unparsed content and a missing customer condition remain distinct',async()=>{
 assert.equal((await build({resolution:{results:[],sourceFailures:['offline']}})).outcome,'search-failed');
 assert.equal((await build({read:async()=>complete({text:''})})).outcome,'unparsed');
 const p=await build({question:{...question,decision:{missing:['software-version']}},resolution:{status:'clarify',reply:'你使用的软件版本是什么？',results:[]}});assert.equal(p.outcome,'needs-input');assert.equal(p.clarification,'你使用的软件版本是什么？');assert.deepEqual(p.question.missing,['software-version']);
});

test('Only anonymous case projections enter the packet, without original file capabilities',async()=>{
 let reads=0;const raw=await build({resolution:{results:[row({role:'case',sourceKind:'indexed-case-record',text:'PRIVATE CASE'})]},read:async()=>{reads++;return complete();}});assert.equal(reads,0);assert.equal(raw.evidence.length,0);
 const anonymous=row({name:'现场参考',answerOnly:true,answerRef:'anonymous-handle',unitId:'anonymous-handle',role:'reference',sourceKind:'indexed-case-record',locator:{page:99}});
 const p=await build({resolution:{results:[anonymous]},read:async()=>({text:'合成现场条件与处理结果',answerOnly:true,answerRef:'anonymous-handle',name:'现场参考',unitId:'anonymous-handle',knowledgeUnit:{complete:false,documentId:hash,sourceSpans:[{locator:{page:99}}]},nextOffset:null})});
 assert.equal(p.evidence.length,1);assert.equal(p.evidence[0].answerRef,'anonymous-handle');assert.equal(p.evidence[0].referenceOnly,true);assert.equal(p.evidence[0].sha256,undefined);assert.equal(p.evidence[0].locator,undefined);assert.equal(p.evidence[0].knowledgeUnit.documentId,undefined);assert.equal(p.evidence[0].knowledgeUnit.sourceSpans,undefined);assert.equal(p.outcome,'partial');
});

test('The module never guesses readiness of a calculation from a quick response',async()=>{
 const calc=row({name:'已校验条件配单',sourceKind:'validated-ordering-calculation',verificationStatus:'geometry-and-static-rule-checked',text:'计算结果'});
 const notReady=await build({resolution:{results:[calc],result:{plan:{fake:true}}},read:async()=>({text:'尚无方案',sourceKind:'validated-ordering-calculation',verificationStatus:'not-a-plan',nextOffset:null})});assert.equal(notReady.evidence.length,0);assert.ok(notReady.gaps.some(g=>g.code==='calculation-not-ready'));
 const ready=await build({resolution:{results:[calc]},read:async()=>({text:'保留假设的已校验结果',sourceKind:'validated-ordering-calculation',verificationStatus:'geometry-and-static-rule-checked',nextOffset:null})});assert.equal(ready.outcome,'answerable');assert.equal(ready.evidence[0].readPerformed,true);
});

test('Pictures and invalid continuation offsets never become an apparently complete answer',async()=>{
 const visual=await build({read:async()=>complete({knowledgeUnit:{complete:true,visualContextRequired:true}})});assert.equal(visual.outcome,'partial');assert.equal(visual.evidence[0].visualRequired,true);
 const loop=await build({read:async()=>complete({nextOffset:0,contextComplete:false})});assert.equal(loop.outcome,'partial');assert.equal(loop.evidence[0].contextComplete,false);assert.ok(loop.gaps.some(g=>g.code==='read-pagination-invalid'));
});

test('Known customer conditions and assumptions are kept separate and arbitrary paths are omitted',async()=>{
 const p=await build({question:{...question,confirmed:{screen:{pixelWidth:1600,pixelHeight:800},module:{pitchMm:2},path:'Z:/SYNTHETIC/CANARY',provenance:{text:'PRIVATE'}},assumptions:[{field:'module',value:'常规模组',reason:'待客户确认',path:'Z:/SYNTHETIC/CANARY'}]}});
 assert.deepEqual(p.question.confirmed,{screen:{pixelWidth:1600,pixelHeight:800},module:{pitchMm:2}});assert.equal(p.question.assumptions[0].value,'常规模组');assert.ok(!JSON.stringify(p).includes('PRIVATE'));
});

test('Reading failure on a later page preserves the first page as partial',async()=>{
 const p=await build({read:async(r,{offset})=>{if(offset)throw Error('offline');return complete({text:'前提：先备份。',contextComplete:false,nextOffset:20});}});
 assert.equal(p.outcome,'partial');assert.equal(p.evidence[0].text,'前提：先备份。');assert.equal(p.evidence[0].nextOffset,20);assert.equal(p.evidence[0].contextComplete,false);
});

test('Duplicate previews are read once and authorization rejection does not consume the limit',async()=>{
 let reads=0;const p=await build({limit:1,resolution:{results:[row({name:'未授权.pdf'}),row(),row()]},authorize:async r=>r.name!=='未授权.pdf',read:async()=>{reads++;return complete();}});assert.equal(reads,1);assert.equal(p.evidence.length,1);
});

test('An authorization exception after a read fails closed rather than returning a cached earlier page',async()=>{
 let calls=0;const p=await build({authorize:async()=>{calls++;if(calls===5)throw Error('grant service unavailable');return true;},read:async()=>complete({contextComplete:false,nextOffset:10})});
 assert.equal(p.evidence.length,0);assert.ok(p.gaps.some(g=>g.code==='authorization-revoked'));
});

test('Oversized source responses are rejected explicitly rather than silently clipped',async()=>{
 const p=await build({read:async()=>complete({text:'前'.repeat(24001)})});assert.equal(p.evidence.length,0);assert.ok(p.gaps.some(g=>g.code==='read-page-exceeds-budget'));
});

test('A matching result with an existing ID cannot overwrite a different source in the expert map',async()=>{
 const other=row({unitId:'other',evidenceId:'same',sha256:'c'.repeat(64),name:'另一合成说明书.pdf'});
 const p=await build({resolution:{results:[row({evidenceId:'same'}),other]},read:async r=>complete({knowledgeUnit:{id:r.unitId,documentId:r.sha256,complete:true}})});
 assert.equal(p.evidence.length,2);assert.notEqual(p.evidence[0].evidenceId,p.evidence[1].evidenceId);
});

test('Context locations retain no internal block capabilities',async()=>{
 const p=await build({read:async()=>complete({contextParts:[{blockId:9123,locator:{page:4},charStart:0,charEnd:20,path:'Z:/SYNTHETIC'}]})});
 assert.deepEqual(p.evidence[0].contextParts,[{locator:{page:4},charStart:0,charEnd:20}]);
});
