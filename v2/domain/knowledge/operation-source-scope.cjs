'use strict';
// The customer's explicit software edition constrains every retrieval round,
// including model-initiated follow-up searches. Generic manuals stay eligible;
// a named different edition is not an interchangeable procedure source.
function filterOperationSources(plan,rows=[]){
 if(!plan.operation)return {rows,rejected:[]};
 const request=[plan.original,plan.focus].join(' ').normalize('NFKC');
 const edition=request.match(/(?:全彩|单双色|单色|双色|商显)版/)?.[0];
 const lcd=/LCD/i.test(request),rejected=[];
 const kept=rows.filter(row=>{
  // A presentation/document may contain several editions. The retrieved
  // section heading owns the passage; a generic filename cannot erase it.
  const heading=String(row.text||'').split(/\r?\n/).filter(Boolean).slice(0,2).join(' ').slice(0,180);
  const identity=[row.name,row.scope?.softwareEdition,row.locator?.section,heading].filter(Boolean).join(' ').normalize('NFKC');
  const otherEdition=identity.match(/(?:全彩|单双色|单色|双色|商显)版/)?.[0];
  const reason=!lcd&&(/LCD/i.test(identity)&&!/\bLED\b/i.test(identity)||otherEdition==='商显版')?'different-display-technology':edition&&otherEdition&&edition!==otherEdition?'different-software-edition':null;
  if(reason){rejected.push({name:row.name,reason,requestedEdition:edition||null});return false;}return true;
 });
 return {rows:kept,rejected};
}
module.exports={filterOperationSources};
