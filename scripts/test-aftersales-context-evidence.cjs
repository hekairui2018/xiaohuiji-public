'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sp=require('../backend/specialist/aftersales-specialist.js');
for(const q of ['VP630处理器 信号源黑色部分显示不够纯黑','VP630 黑色显示不够纯黑，应该怎么设置？','请问 VP630 黑色发灰怎么处理'])test('Black level is not Apple-PC corruption: '+q,()=>{
 const r=sp.handle(q,[]);assert.equal(r.meta.domain,'display');
 const candidates=[r.bestId,...(r.candidates||[]).map(c=>c.id)];assert.ok(candidates.slice(0,3).includes('AS-1325'));
 assert.notEqual(r.bestId,'AS-0114');assert.match(r.reply,/量化范围|范围改为全/);
});
test('Boot black-screen domain remains distinct',()=>assert.equal(sp.detectDomain('VP630 整屏黑屏，开不了机'),'power_boot'));
test('Temporary firmware qualifier retained from original case',()=>{
 const r=sp.handle('[CASE_DETAIL:AS-0114]',[]);assert.match(r.reply,/临时固件/);assert.match(r.reply,/如果苹果电脑/);
});
test('Temporary FPGA qualifier retained',()=>assert.match(sp.handle('[CASE_DETAIL:AS-0735]',[]).reply,/FPGA临时固件/));
test('Explicit conflicting scan cannot become first case',()=>{
 const c=(id,scan)=>({id,products:['R712'],chips:['FM6363'],scans:[scan],domain:'display',subCategory:'鬼影拖影',title:'R712鬼影'});
 const r=sp.pickBest([{c:c('wrong','16S'),s:100},{c:c('right','32S'),s:30}],{domain:'display',subs:['鬼影拖影'],products:['R712'],chips:['FM6363'],scans:['32S']});
 assert.equal(r.id,'right');
});
test('All conflicting scans do not create a supported first answer',()=>{
 const r=sp.pickBest([{c:{id:'wrong',products:['R712'],scans:['16S'],title:'鬼影',subCategory:'鬼影拖影'},s:100}],{domain:'display',subs:['鬼影拖影'],products:['R712'],scans:['32S']});assert.equal(r,null);
});
