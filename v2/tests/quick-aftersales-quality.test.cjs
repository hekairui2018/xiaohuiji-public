'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createQuickRetrieval}=require('../adapters/http/quick-retrieval.cjs');
const products=['HD-C16L','HD-R712'].map(modelId=>({modelId,aliases:[modelId.slice(3)]}));
const knowledge={products:()=>products,findProducts:id=>products.filter(p=>p.modelId===id)};
const app={quickResources:()=>({}),chipLookup:()=>null,resourceMedia:{softwareItems:s=>/HDPlayer/i.test(s)?[{name:'HDPlayer'}]:[]},quickSearch:()=>({records:[]}),quickBrowse:()=>[]};
const api=options=>createQuickRetrieval({app,knowledge,search:async()=>({results:[]}),searchCases:async()=>({results:[]}),...options});
const local='C16L换LED模组后右边几排颜色不正常并闪烁，HDPlayer能找到设备且节目已发送成功，如何排查？';
const oldCase={id:'historical-clock',title:'局部颜色异常并闪烁',phenomenon:'更换模组后局部颜色异常并闪烁。',modelIds:[],scope:{chips:['ICN2038S'],firmwareVersions:['1.2.3']},sourceExcerpt:'更换模组后局部颜色异常并闪烁。历史处理：把DCLK设置为18MHz并升级固件。',historicalMeasure:'把DCLK设置为18MHz并升级固件',applicability:{status:'conditional-reference',missingFields:['modelIds','chips','firmwareVersions']},sources:[{name:'历史售后记录.csv',locator:{row:9}}]};

test('Quick fault answer acknowledges known scope/software/success without displaying unsafe unmatched measures or product specifications',async()=>{
 let receivedFacts;
 const client=api({searchCases:async(query,model,facts)=>{receivedFacts=facts;return {results:[oldCase]};},search:async()=>({results:[{name:'C16L规格书.pdf',text:'C16L带载655360像素，四个HUB75接口。'},{name:'C16L显示排查手册.pdf',text:'C16L局部颜色异常并闪烁。把DCLK设置为18MHz并升级固件。',locator:{page:3}}]})});
 const r=await client.answer(local);
 assert.equal(r.intent,'aftersales');assert.equal(r.modelCallCount,0);assert.ok(r.results.length<=3);
 assert.deepEqual(receivedFacts.knownNormal,['设备发现已成功','节目发送已成功']);assert.deepEqual(receivedFacts.faultScope,['局部异常']);
 assert.match(r.reply,/HD-C16L；HDPlayer；局部异常；设备发现已成功；节目发送已成功/);
 assert.doesNotMatch(r.reply,/18MHz|DCLK|655360|四个HUB75|请补充异常范围|软件及固件版本/);
 assert.equal((r.reply.match(/？/g)||[]).length,1);assert.match(r.reply,/异常位置一直固定/);
 assert.equal(r.results.some(row=>row.name==='C16L规格书.pdf'),false);
 const retained=r.results.find(row=>row.id===oldCase.id);assert.equal(retained.historicalMeasure,oldCase.historicalMeasure);assert.equal(retained.sourceExcerpt,oldCase.sourceExcerpt);
 assert.equal(retained.requiresExpertReview,true);assert.equal(retained.applicability.status,'conditional-reference');assert.match(retained.applicabilityNote,/不能直接套用/);assert.doesNotMatch(retained.quickSummary,/DCLK|18MHz/);
});

test('Confirmed observations stay in their task across followups; an explicit later failure removes the former success',async()=>{
 const client=api(),first=await client.answer(local),state={retrievalHistory:[{quickContext:first.quickContext}]};
 const next=await client.answer('还是这样',{state});
 assert.match(next.reply,/设备发现已成功；节目发送已成功/);assert.doesNotMatch(next.reply,/异常发生在整屏|更换模组或修改设置后出现/);
 const changed=await client.answer('现在HDPlayer发送失败了，C16L右边仍然闪烁',{state});
 assert.ok(!changed.quickContext.facts.knownNormal?.includes('节目发送已成功'));
});

test('Negated success never becomes an acknowledged successful operation',async()=>{
 const r=await api().answer('C16L局部闪烁，HDPlayer不能找到设备，也没发送成功');
 assert.ok(!r.quickContext.facts.knownNormal?.includes('设备发现已成功'));assert.ok(!r.quickContext.facts.knownNormal?.includes('节目发送已成功'));
 assert.doesNotMatch(r.reply,/设备发现已成功|节目发送已成功/);
});

test('An exact fault FAQ is still a conditional record, and does not bypass unsafe measure presentation',async()=>{
 const question='C16L局部闪烁如何排查',row={type:'faq',name:'C16L常见问题FAQ.csv',standardQuestion:question,standardAnswer:'把DCLK设为18MHz并升级固件',text:question+'：把DCLK设为18MHz并升级固件',faqExact:true,modelIds:['HD-C16L'],locator:{row:2}};
 const r=await api({faqLookup:async()=>[row]}).answer(question);
 assert.equal(r.results[0].standardAnswer,row.standardAnswer);assert.doesNotMatch(r.reply,/DCLK|18MHz/);assert.equal(r.results[0].requiresExpertReview,true);assert.match(r.results[0].applicabilityNote,/不能直接套用/);
});

test('Even a model match cannot use a setting from a case whose chip and firmware conditions are unknown',async()=>{
 const r=await api({searchCases:async()=>({results:[{...oldCase,modelIds:['HD-C16L']}]})}).answer('C16L局部颜色异常并闪烁');
 assert.equal(r.results[0].applicability.status,'conditional-reference');assert.ok(r.results[0].applicability.missingFields.includes('firmwareVersions'));assert.doesNotMatch(r.reply,/18MHz|DCLK/);
});

test('Parameters from two models are attributed to each individual evidence identity',async()=>{
 const records=products.map((p,i)=>({...p,claims:[{claimId:'claim-'+i,field:'load',text:'带载'+(i?'262144':'655360')+'像素',verificationStatus:'verified',sourceReferences:[{originalName:p.modelId+'规格书.pdf',originalSha256:String(i+1).repeat(64),verificationStatus:'verified'}]}]}));
 const r=await api({knowledge:{products:()=>records,findProducts:id=>records.filter(p=>p.modelId===id)}}).answer('C16L和R712的带载分别多少');
 assert.match(r.reply,/HD-C16L：带载655360像素/);assert.match(r.reply,/HD-R712：带载262144像素/);assert.doesNotMatch(r.reply,/HD-C16L、HD-R712：/);
});

test('Exposed planning uses the same task parser without retrieval or model calls',()=>{
 let calls=0;const client=api({search:()=>{calls++;throw Error('must-not-retrieve');}});
 const planned=client.plan('C16L局部闪烁',{});assert.equal(planned.intent,'aftersales');assert.equal(calls,0);assert.ok(planned.taskPlan);
});

test('A reported recent replacement is retained without inventing its causal relationship to the fault',async()=>{
 for(const operation of ['前两天换过模组','昨天换了模组','刚更换过模组']){
  const client=api(),r=await client.answer('C16L屏幕右边几排颜色不正常，一直闪烁。HDPlayer能找到设备，节目也发送成功，'+operation+'。应该先查哪里？');
  assert.match(r.reply,/近期换过模组/);assert.match(r.reply,/更换前显示正常吗，异常是在更换后立即出现的吗？/);
  assert.doesNotMatch(r.reply,/这是更换模组或修改设置后出现|更换模组导致/);
  assert.ok(r.quickContext.facts.recentOperations.some(s=>s.includes(operation)));assert.ok(!r.quickContext.facts.timeRelations?.length);
  const repeated=await client.answer('还是这样',{state:{retrievalHistory:[{quickContext:r.quickContext}]}});
  assert.match(repeated.reply,/近期换过模组/);assert.doesNotMatch(repeated.reply,/这是更换模组或修改设置后出现/);
 }
});

test('A proposed replacement is not treated as a completed action and an explicit timing is not asked again',async()=>{
 const proposed=await api().answer('C16L右边闪烁，准备换模组');assert.ok(!proposed.quickContext.facts.recentOperations?.length);assert.doesNotMatch(proposed.reply,/近期换过模组/);
 const timed=await api().answer('C16L更换模组后立即出现右边颜色异常并闪烁');assert.ok(timed.quickContext.facts.timeRelations?.length);assert.doesNotMatch(timed.reply,/更换前显示正常吗，异常是在更换后立即出现的吗？/);assert.match(timed.reply,/异常位置一直固定/);
});

test('Resolution questions accept pixel/load facts, retain same-document notes as conditions, and exclude physical board dimensions',async()=>{
 const ref={originalName:'R712规格书.pdf',originalSha256:'a'.repeat(64),verificationStatus:'verified',page:2};
 const record={modelId:'HD-R712',claims:[{claimId:'limit',field:'load',text:'最大单卡带载512×512像素',verificationStatus:'verified',sourceReferences:[ref]},{claimId:'note',field:'note',text:'注：实际带载与接口数、模组分辨率有关',verificationStatus:'verified',sourceReferences:[ref]},{claimId:'board',field:'size',text:'板卡尺寸160×100mm',verificationStatus:'verified',sourceReferences:[ref]}]};
 const client=api({knowledge:{products:()=>[record],findProducts:id=>id===record.modelId?[record]:[]}});
 const r=await client.answer('R712分辩率最大多少');
 assert.equal(r.answerType,'parameter-answer');assert.match(r.reply,/最大单卡带载512×512像素/);assert.match(r.reply,/条件：注：实际带载/);assert.doesNotMatch(r.reply,/160×100mm/);
 const dimensions=await client.answer('R712板卡尺寸多大');assert.match(dimensions.reply,/板卡尺寸160×100mm/);assert.doesNotMatch(dimensions.reply,/512×512像素/);
});

test('A verified note alone does not block original numeric evidence or become a quantitative answer',async()=>{
 const sha='b'.repeat(64),note='注：实际带载与接口数、模组分辨率有关';
 const record={modelId:'HD-R712',claims:[{claimId:'note-only',field:'note',text:note,verificationStatus:'verified',sourceReferences:[{originalName:'R712规格书.pdf',originalSha256:sha,verificationStatus:'verified'}]}]};
 const options={knowledge:{products:()=>[record],findProducts:id=>id===record.modelId?[record]:[]}};
 const r=await api({...options,originalDocuments:[{document:{name:'R712规格书.pdf',sha256:sha,pages:[{page:2,text:'最大单卡带载512×512像 素\n'+note+'\n板卡尺寸160×100mm'}]}}],resolveDocuments:async rows=>rows.map(()=>({available:true,url:'/original'}))}).answer('R712分辨率最大多少');
 assert.match(r.reply,/最大单卡带载512×512像 素/);assert.doesNotMatch(r.reply,/160×100mm/);assert.ok(r.results.some(row=>row.field==='original-parameter-excerpt'));
 const only=await api(options).answer('R712分辨率最大多少');assert.equal(only.answerType,'insufficient-evidence');assert.doesNotMatch(only.reply,/HD-R712：注/);assert.match(only.reply,/未找到/);
});

test('Resolution retrieval with broken numeric spacing requires the original rather than deriving a value',async()=>{
 const original='单卡最大带载为5 12×512像素，需核对原始PDF。';
 const r=await api({search:async()=>({results:[{name:'R712规格书.pdf',text:original,locator:{page:2}}]})}).answer('R712分辨率最大多少');
 assert.equal(r.answerType,'insufficient-evidence');assert.match(r.reply,/数字存在断空格/);assert.doesNotMatch(r.reply,/5 12×512|为512×512/);assert.equal(r.results[0].text,original);assert.equal(r.results[0].requiresOriginalNumberCheck,true);
});

test('A clear maximum remains answerable while broken recommendation numbers remain only in source details',async()=>{
 const ref={originalName:'R712规格书.pdf',originalSha256:'c'.repeat(64),verificationStatus:'verified',conditions:['原始推荐数字为1 28*1024，请核对']},record={modelId:'HD-R712',claims:[{claimId:'max',field:'load',text:'最大带载26万点',verificationStatus:'verified',sourceReferences:[ref]},{claimId:'recommend',field:'load',text:'推荐带载：常规芯片 1 28*1024，PWM芯片 2 56*1024',verificationStatus:'verified',sourceReferences:[ref]}]};
 const r=await api({knowledge:{products:()=>[record],findProducts:id=>id===record.modelId?[record]:[]}}).answer('R712分辨率最大多少');
 assert.equal(r.answerType,'parameter-answer');assert.match(r.reply,/最大带载26万点/);assert.match(r.reply,/数字存在断空格/);assert.doesNotMatch(r.reply,/1 28|2 56|128\*1024|256\*1024/);assert.ok(r.results.some(row=>row.text.includes('1 28*1024')));
});
