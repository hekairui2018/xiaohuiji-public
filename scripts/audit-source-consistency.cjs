'use strict';
// Evidence supplement: conservative exact-source matches, raw source conditions, PDF/firmware and BOM checks.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.resolve(root,process.argv[2]||'tmp/business-evidence-20261013');
const read=file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
const input=read('frozen-inputs.json'),pdf=read('local-specifications.json');
const out=path.join(dir,'evidence-supplement.json');if(fs.existsSync(out))throw Error('Preserve existing supplement');
const norm=s=>String(s||'').toUpperCase().replace(/^HD[-_\s]?/,'').replace(/[^A-Z0-9]/g,'');
const text=s=>String(s||'').replace(/\s/g,'');
function raw(c){if(!c)return null;const d=input.sources[c.sourceFile];const rows=Array.isArray(d)?d:d?.cases||d?.rows||[];const matches=rows.filter(x=>String(x.id)===String(c.originalId));return matches.find(x=>x.source?.locator===c.source?.locator)||(matches.length===1?matches[0]:null);}
const phases={};
for(const phase of ['before','after','after-status']){
 const report=read(phase+'-results.json');const summaries={fixed:{count:0,firstRelatedLowerBound:0,top3RelatedLowerBound:0,unsupportedSolvedClaim:0,explicitPendingClaim:0,stepLiteralSupported:0,stepUnknown:0,conditionReview:0},random:{count:0,firstRelatedLowerBound:0,top3RelatedLowerBound:0,unsupportedSolvedClaim:0,explicitPendingClaim:0,stepLiteralSupported:0,stepUnknown:0,conditionReview:0}};
 const details=report.rows.map(r=>{
  const source=raw(input.dataset.cases.find(c=>c.id===r.caseId));
  const candidates=r.top3.map(t=>{const c=input.dataset.cases.find(c=>c.id===t.id),s=raw(c);const related=Boolean(source&&s&&(c.id===r.caseId||(text(s.phenomenon)&&text(s.phenomenon)===text(source.phenomenon)&&text(s.solution)===text(source.solution)&&JSON.stringify((s.deviceInfo?.products||[]).map(norm).sort())===JSON.stringify((source.deviceInfo?.products||[]).map(norm).sort()))));return {caseId:c?.id,relatedLowerBound:related,raw:s};});
  const chosen=candidates[0]?.raw,reply=r.output?.reply||'';
  const claimed=/已解决|已经解决|验证过的/.test(reply);
  const noSolution=chosen&&!chosen.solution||/未填写|未明确|暂无|无解决/.test(chosen?.solution||'');
  const status=String(chosen?.sourceExcerpt||'').match(/(?:^|\n)状态[:：]\s*([^\n]+)/)?.[1]||'';
  const explicitPending=/挂起|未解决|未复现|待验证|跟踪中/.test(status);
  const operation=reply.split('【这样解决】')[1]?.split('【来源】')[0]?.trim()||'';
  const literalSupport=Boolean(operation&&chosen&&text([chosen.solution,chosen.troubleshooting,chosen.sourceExcerpt].join(' ')).includes(text(operation.replace(/(?:^|\n)\d+[.、]\s*/g,''))));
  const queryScans=(r.query.match(/\b\d{1,3}\s*S\b/gi)||[]).map(norm);const scans=(chosen?.deviceInfo?.scans||[]).map(norm);
  const conditionReview=Boolean(queryScans.length&&scans.length&&!queryScans.some(x=>scans.includes(x)));
  const stat=summaries[r.set];stat.count++;if(candidates[0]?.relatedLowerBound)stat.firstRelatedLowerBound++;if(candidates.some(x=>x.relatedLowerBound))stat.top3RelatedLowerBound++;if(claimed&&noSolution)stat.unsupportedSolvedClaim++;if(claimed&&explicitPending)stat.explicitPendingClaim++;if(literalSupport)stat.stepLiteralSupported++;else stat.stepUnknown++;if(conditionReview)stat.conditionReview++;
  return {set:r.set,caseId:r.caseId,chosenCase:candidates[0]?.caseId,firstRelatedLowerBound:Boolean(candidates[0]?.relatedLowerBound),top3RelatedLowerBound:candidates.some(x=>x.relatedLowerBound),status,unsupportedSolvedClaim:Boolean(claimed&&noSolution),explicitPendingClaim:Boolean(claimed&&explicitPending),stepLiteralSupported:literalSupport,stepVerification:literalSupport?'literal-source-trace':'unknown-paraphrase-or-no-steps',conditionReview};
 });phases[phase]={summaries,details};
}
const features=require('../backend/product-features.cjs');
const productChecks=['HD-A3','HD-A3L','HD-R712','HD-VP620A'].map(name=>{
 const spec=input.specs.products.find(p=>p.product===name),answer=features.buildProductFeatures(name);
 const own=(spec?.specificationFiles||[]).filter(f=>new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-z0-9])','i').test(f));
 return {model:name,output:answer,ownSpecificationFiles:own,foreignOnlyDocuments:!own.length&&(spec?.specificationFiles||[]).length>0,parameterEvidence:'original PDF page text when available; units and loading scope must be retained'};
});
const cn=pdf.documents.find(d=>d.file==='HD-A3L规格书 V1.1.pdf'),en=pdf.documents.find(d=>d.file==='HD-A3L Specification V1.1.pdf');
const chineseHeight=cn?.pages.map(p=>p.text).join('\n').match(/垂直最大支持\s*(\d+)\s*像素/)?.[1];
const englishHeight=en?.pages.map(p=>p.text).join('\n').match(/maximum vertical support is\s*(\d+)\s*pixels/i)?.[1];
const specificationConflicts=chineseHeight&&englishHeight&&chineseHeight!==englishHeight?[{model:'HD-A3L',parameter:'maximum vertical pixels',chinese:{value:Number(chineseHeight),file:cn.file,sha256:cn.sha256,page:2},english:{value:Number(englishHeight),file:en.file,sha256:en.sha256,page:3},decision:'conflict; do not automatically replace either source value'}]:[];
const firmwareChecks=input.firmware.items.map(f=>({file:f.file,card:f.card,filenameModelMatches:norm(f.file.split('_')[0])===norm(f.card),hardwareCodeConflict:Boolean(f.hwFromFile&&f.hwFromTable&&f.hwFromFile!==f.hwFromTable),applicabilityUnknown:!f.tableMatched}));
const ordering=read('after-status-results.json').ordering.map(o=>{const r=o.result?.ok?o.result:o.result?.provisional,issues=[...o.issues],unknown=[...o.unknown];if(r?.ok){const bom=r.bom?.items||[];const rx=bom.find(x=>x.category==='receiver'),ctrl=bom.find(x=>x.category==='controller');if(!rx||rx.quantity!==r.receiverQuantity||norm(rx.model)!==norm(r.card?.name))issues.push('receiver-bom');if(ctrl&&ctrl.quantity!==r.controllerQuantity)issues.push('controller-bom');if(r.card?.name==='R712'&&(r.plan?.ports||[]).flatMap(p=>p.cells||[]).some(c=>c.pxW*c.pxH>512*512))issues.push('R712-original-PDF-max-points');}return {query:o.query,confirmedResult:Boolean(r?.ok),issues,unknown};});
const report={method:'Independent raw extracted sources and original PDF bytes; exact-source/identical-phenomenon relatedness is a conservative lower bound, not general semantic relevance or field engineering success.',phases,productChecks,specificationConflicts,firmwareSummary:{count:firmwareChecks.length,filenameModelMismatches:firmwareChecks.filter(x=>!x.filenameModelMatches).length,hardwareCodeConflicts:firmwareChecks.filter(x=>x.hardwareCodeConflict).length,applicabilityUnknown:firmwareChecks.filter(x=>x.applicabilityUnknown).length},firmwareChecks,ordering};
fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({phases:Object.fromEntries(Object.entries(phases).map(([k,v])=>[k,v.summaries])),productChecks,specificationConflicts,firmwareSummary:report.firmwareSummary,orderingIssues:ordering.filter(x=>x.issues.length)},null,2));
