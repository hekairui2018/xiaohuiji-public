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
test('Untrusted names and values are escaped, and source links accept only recognized local read-only URLs',()=>{
 const html=render({name:'<script>alert(1)</script>',features:{inputs:'<img onerror=x>',sources:[{url:'javascript:alert(1)',name:'bad',row:2},{url:'/v2/offline/preview?id=12',name:'Table',sheet:'Sheet',row:28}]}});
 assert.doesNotMatch(html,/<script|<img|javascript:/);assert.match(html,/&lt;script&gt;/);assert.match(html,/第28行/);
});
