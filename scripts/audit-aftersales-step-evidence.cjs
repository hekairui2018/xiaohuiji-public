'use strict';
// Classify every unresolved step from phase two, with independent original extracted records.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),old=path.join(root,'tmp/business-evidence-20261013');
const read=f=>JSON.parse(fs.readFileSync(path.join(old,f),'utf8'));
const input=read('frozen-inputs.json'),report=read('after-status-results.json');
const unresolved=new Set(read('evidence-supplement.json').phases['after-status'].details.filter(r=>!r.stepLiteralSupported).map(r=>r.set+'|'+r.caseId));
if(unresolved.size!==95)throw Error('Expected all 95 original unresolved rows, no sample selection');
const output=path.resolve(root,process.argv[2]||'tmp/phase3-evidence-20261013/step-review-before.json');
if(fs.existsSync(output))throw Error('Preserve prior review');
function raw(c){if(!c)return null;const d=input.sources[c.sourceFile];const rows=Array.isArray(d)?d:d?.cases||d?.rows||[];const matches=rows.filter(r=>String(r.id)===String(c.originalId));return matches.find(r=>r.source?.locator===c.source?.locator)||(matches.length===1?matches[0]:null);}
const norm=s=>String(s||'').replace(/[\s，,。；;:：、.!！?？\-—（）()“”"'·]/g,'');
const scans=s=>[...String(s||'').matchAll(/(?:^|[^A-Z0-9])(?:1\s*\/\s*)?(\d{1,3})\s*(?:S\b|扫)/gi)].map(m=>m[1]+'S');
const current=process.argv.includes('--current');
const sp=current?require('../backend/specialist/aftersales-specialist.js'):null;
const rows=report.rows.filter(r=>unresolved.has(r.set+'|'+r.caseId)).map(original=>{
 const r=current?{...original,output:sp.handle(original.query,[])}:original;
 const target=input.dataset.cases.find(c=>c.id===r.caseId),chosen=input.dataset.cases.find(c=>c.id===r.output?.bestId),source=raw(chosen);
 const operation=r.output?.reply?.split('【这样解决】')[1]?.split('【来源】')[0]?.trim()||'';
 const steps=operation.split(/\n|[。]/).map(s=>s.replace(/^\s*\d+[.、]\s*/,'').trim()).filter(Boolean);
 const evidence=source?[source.solution,source.troubleshooting,source.sourceExcerpt].filter(Boolean).join('\n'):'';
 const supported=steps.map(step=>({step,literal: norm(evidence).includes(norm(step)),channelRewrite:norm(evidence.replace(/微盘上?(?:的)?(?:这个|那个|对应)?固件/g,'对应固件')).includes(norm(step))}));
 const sourceScans=[...new Set([...(source?.deviceInfo?.scans||[]).flatMap(scans),...scans(source?.customerWording)])];
 const queryScans=scans(r.query);const scanConflict=queryScans.length&&sourceScans.length&&!queryScans.some(s=>sourceScans.includes(s));
 const lostTemporary=Boolean(source&&/临时固件|临时版本/.test(evidence)&&/固件|版本/.test(operation)&&!/临时/.test(operation));
 const missingScan=Boolean(sourceScans.length&&!queryScans.length&&operation&&!sourceScans.some(s=>operation.includes(s)));
 let category,reason;
 if(!chosen){category='no-selected-case';reason=operation?'输出为通用规则/排查；没有选中案例，不能用原案例验证这些步骤':'没有选中案例或没有输出处理步骤';}
 else if(!source){category='missing-original-source';reason='无法定位选中案例的独立原始提取记录';}
 else if(scanConflict||r.firstExplicitSuffixConflict){category='explicit-wrong-case';reason=scanConflict?'客户扫描方式与来源设备扫描方式明确冲突':'客户型号与来源存在明确后缀冲突';}
 else if(lostTemporary||missingScan){category='missing-key-condition';reason=lostTemporary?'临时固件/版本限定在输出中丢失':'客户未给扫描方式，来源具有扫描条件，输出未保留此条件；适用性尚未确认';}
 else if(steps.length&&supported.every(s=>s.literal||s.channelRewrite)){category='supported-format-rewrite';reason='逐步骤去编号/标点或明确渠道词替换后，均可在独立来源中定位';}
 else if(!operation||!source.solution||/未填写|未明确|未单列|暂无|待验证/.test(source.solution)){category='incomplete-source-or-no-step';reason='原来源缺方案或输出没有可执行步骤，不能按文字相似判定解决成功';}
 else{category='unresolved-semantic-rewrite';reason='严格规范化仍未完成溯源，保持无法判断，不让 AI 自行补工程事实';}
 return {set:r.set,caseId:r.caseId,query:r.query,chosenId:chosen?.id||'',sourceIdentity:chosen?{file:chosen.sourceFile,originalId:chosen.originalId,locator:chosen.source?.locator}:null,
   category,reason,flags:{scanConflict:Boolean(scanConflict),missingScan,lostTemporary},operation,steps:supported,originalSource:source,referenceSource:raw(target)};
});
const counts={};for(const r of rows)counts[r.category]=(counts[r.category]||0)+1;
fs.writeFileSync(output,JSON.stringify({method:'All 95 retained; independent extracted sources, deterministic transformation trace, explicit condition flags; no field-success labels.',count:rows.length,counts,rows},null,2));
console.log(JSON.stringify({count:rows.length,counts,temporaryConditionRows:rows.filter(r=>r.flags.lostTemporary).map(r=>r.caseId)},null,2));
