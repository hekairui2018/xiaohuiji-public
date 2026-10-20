'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {layout,render}=require('../frontend/product-card.js');
test('Reference layout separates four confirmed metrics while preserving independent limits and remaining output information',()=>{
 const p={name:'HD-KV410',features:{series:'视频处理器',load:'260万像素',resolution:'最宽 3840；最高 2500（独立上限）',outputs:'网口×4；TRS类型：输出',inputs:'HDMI 1.4×2、USB'}};
 const view=layout(p);assert.deepEqual(view.metrics.map(m=>[m.label,m.value,m.unit]),[['最大带载','260万','像素'],['输出网口','4','个'],['最大宽度','3840','像素'],['最大高度','2500','像素']]);assert.ok(view.details.some(d=>d.value==='TRS类型：输出'));assert.ok(view.details.some(d=>/独立上限/.test(d.value)));assert.match(render(p),/HDMI 1.4×2、USB/);
});
test('Table pixel counts remain exact and discount thresholds remain visible',()=>{
 const view=layout({name:'A5',features:{load:'1280×1024点（1310720像素）',resolution:'最宽 16384；最高 2048（独立上限）；宽打折触发宽度：3840',outputs:'级联网口：2路'}});
 assert.equal(view.metrics[0].value,'131.072万');assert.ok(view.details.some(d=>/1280×1024/.test(d.value)));assert.ok(view.details.some(d=>/宽打折触发宽度：3840/.test(d.value)));
});
test('Conditional or unsupported dimensions never turn into invented metrics or interface quantities',()=>{
 const view=layout({name:'C16L',features:{load:'独立20万，级联65万',resolution:'单独最宽2048；级联8192（打折）',inputs:'USB',outputs:'网口，数量未注明'}});assert.equal(view.metrics.length,0);assert.equal(view.details.length,4);
});
test('Untrusted names and values stay escaped and detailed source addresses do not appear on the card',()=>{
 const html=render({name:'<script>alert(1)</script>',features:{inputs:'<img onerror=x>',sources:[{url:'javascript:alert(1)',name:'bad',row:2},{url:'/v2/offline/preview?id=12',name:'Table',sheet:'Sheet',row:28}]}});
 assert.doesNotMatch(html,/<script|<img|javascript:/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/第28行|href=/);assert.match(html,/基础参数来源：官方产品资料/);
});
test('Unified presentation handles sparse and different product fields without blank metric slots or data mutation',()=>{
 for(const p of [{name:'Unknown',features:{}},{name:'Receiver',features:{load:'常规芯片128×1024；PWM芯片256×1024'}},{name:'InputOnly',features:{inputs:'HDMI 1.4'}},{name:'SingleMetric',features:{load:'1310720像素'}}]){
  const before=structuredClone(p),html=render(p),view=layout(p);assert.deepEqual(p,before);
  assert.equal(html.includes('class="pq-metrics"'),view.metrics.length>0);assert.equal(html.includes('class="pq-more"'),view.details.length>0);assert.doesNotMatch(html,/undefined|null/);
 }
 assert.equal(layout({name:'Scalar',features:{load:'1310720像素'}}).metrics[0].value,'131.072万');
});
test('Long evidence stays available in full while a compact preview provides context before expanding',()=>{
 const text='条件不可省略。'.repeat(40),html=render({name:'Conditions',features:{load:text}});assert.ok(html.includes(text));assert.match(html,/pq-parameter-preview/);assert.match(html,/展开说明/);
});


test('Basic source label stays concise while detailed provenance remains in the input record',()=>{
 const fromTable=render({name:'HD-A5',features:{load:'1310720像素',sources:[{name:'产品特性表.xlsx',sheet:'设备特性',row:28,url:'/v2/offline/preview?id=12'}]}});assert.match(fromTable,/基础参数来源：/);assert.match(fromTable,/基础参数来源：官方产品资料/);assert.doesNotMatch(fromTable,/产品特性表.xlsx|第28行/);assert.doesNotMatch(fromTable,/官方产品选型资料|结构化/);
 const fromDocument=render({name:'HD-A3L',features:{load:'65万像素',evidence:{parameterEvidence:{load:[{name:'规格书 V1.1.pdf',page:2,url:'/v2/resources/original/'+'a'.repeat(64),verificationStatus:'verified'}]}}}});assert.match(fromDocument,/基础参数来源：/);assert.match(fromDocument,/基础参数来源：官方产品资料/);assert.doesNotMatch(fromDocument,/规格书 V1.1.pdf|第2页/);
 const unverified=render({name:'HD-KV410',features:{load:'260万像素',evidence:{structuredProduct:{datasetVersion:'not-a-product-source'}}}});assert.match(unverified,/产品资料索引（原文待核对）/);assert.doesNotMatch(unverified,/官方产品选型资料|结构化/);
});
