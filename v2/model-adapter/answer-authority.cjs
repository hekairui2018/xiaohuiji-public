'use strict';
// Source availability is a server fact. Whether those sources answer the actual
// question remains a semantic decision; an empty search is not proof of absence.
function answerAuthority(evidence=[],trace=[]){
 const searches=trace.filter(t=>['search_evidence','quick_answer'].includes(t.name)&&!t.cached&&!t.error).length;
 const read=evidence.filter(e=>e.readPerformed===true&&e.sourceKind!=='validated-ordering-calculation').length;
 const failures=trace.filter(t=>t.error).length;
 return {companySources:read?'read-sources-available':evidence.length?'candidates-only':searches?'searched-without-evidence':failures?'tools-unavailable':'not-checked',readSources:read,completedSearches:searches,failedTools:failures};
}
module.exports={answerAuthority};
