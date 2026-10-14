'use strict';
// Runtime projection only: preserve the snapshot and never promote experience to a hardware rule.
function consumeCase(original,reviews=[]){
 const c=structuredClone(original);c.verificationStatus=c.verificationStatus||'unknown';
 c.sourceReferences=c.sourceReferences||[c.sourceReference].filter(Boolean);
 c.scope={...c.scope};c.conditionReferences=[];
 if(c.verificationStatus==='verified_by_case'&&!c.checks.length){
  const lines=String(c.sourceExcerpt||'').split('\n').filter(line=>/\d+宽\d+高|\d+\s*[x×]\s*\d+|HUB\d+/i.test(line));
  if(lines.length)c.scope.additionalConditions=[...new Set([...(c.scope.additionalConditions||[]),...lines])];
 }
 for(const review of reviews.filter(r=>r.legacyId===c.legacyId&&c.sourceReferences.some(ref=>ref.originalSha256===r.originalSha256))){
  // Parse only the explicitly labelled module-information line; ignore the solution and cause prose.
  const line=/模组信息[：:]([^\n]+)/.exec(review.rawText)?.[1];if(!line)continue;
  const fields={chips:line.match(/\b(?:LS|ICN|ICND|FM|SM|MBI)\d+[A-Z0-9]*\b/g)||[],pitches:line.match(/\bP\d+(?:\.\d+)?\b/g)||[],scans:line.match(/\b\d+S\b/g)||[]};
  for(const [key,values]of Object.entries(fields))c.scope[key]=[...new Set([...(c.scope[key]||[]),...values])];
  c.scope.additionalConditions=[...new Set([...(c.scope.additionalConditions||[]),line.trim()])];
  c.conditionReferences.push({...review.sourceReference,excerpt:'模组信息：'+line});
 }
 c.sourceReferences=[...c.sourceReferences,...c.conditionReferences];
 c.evidencePolicy=c.verificationStatus==='reference_only'?'reference-only-investigation':c.verificationStatus==='verified_by_case'?'case-scoped-investigation':'indexed-source-investigation';
 const norm=s=>String(s||'').replace(/\s+/g,'');
 c.executableEvidence=c.verificationStatus!=='reference_only'||c.checks.every(check=>c.sourceReferences.some(ref=>ref.originalSha256&&norm(ref.excerpt).includes(norm(check.text))));
 return c;
}
module.exports={consumeCase};
