'use strict';
// Only explicit contradictory conditions exclude a case; absent facts remain unknown.
function scanValues(text){
 return [...new Set([...String(text||'').matchAll(/(?:^|[^A-Z0-9])(?:1\s*\/\s*)?(\d{1,3})\s*(?:S\b|扫)/gi)].map(m=>m[1]+'S'))];
}
function caseScans(c){return [...new Set((c.scans||[]).flatMap(scanValues))];}
function scanConflict(c,wanted){
 const q=[...new Set((wanted||[]).flatMap(scanValues))],actual=caseScans(c);
 return Boolean(q.length&&actual.length&&!q.some(s=>actual.includes(s)));
}
module.exports={scanValues,caseScans,scanConflict};
