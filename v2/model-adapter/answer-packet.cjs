'use strict';
// Short request-local handles avoid generating content hashes. Originals remain server-side.
function answerPacket(input,evidence){
 const ids=new Map(evidence.map((e,i)=>[e.evidenceId,'s'+(i+1)]));
 const originals=new Map([...ids].map(([id,short])=>[short,id]));
 const packed=structuredClone(input);
 // lastToolResult and preparedEvidence refer to the same source rows. Keep
 // tool status/notice but transmit the original passages once per request.
 if(packed.lastToolResult?.evidence)delete packed.lastToolResult.evidence;
 if(packed.preparedEvidence?.evidence)packed.preparedEvidence.evidence=packed.preparedEvidence.evidence.map(e=>{
  const row={};for(const key of ['text','name','modelIds','category','locator','readPerformed','readAvailable','blockId','nextOffset','contextComplete','verificationStatus','sourceKind','scope','compatibilityConfirmed','caseSemantics'])if(e[key]!==undefined)row[key]=e[key];
  if(row.caseSemantics){row.caseSemantics=structuredClone(row.caseSemantics);delete row.caseSemantics.caseId;}
  row.downloadAvailable=typeof e.download==='string'&&e.download.length>0;
  row.evidenceId=ids.get(e.evidenceId);return row;
 });
 return {input:packed,encode:id=>ids.get(id),decodeDelivery:values=>Array.isArray(values)?[...new Set(values.map(id=>originals.get(id)||id))]:[],decode(output){
  if(output?.action!=='answer')return output;
  return {...output,question:'',generalAdvice:output.generalAdvice||[],claims:output.claims?.map(c=>({...c,evidenceIds:Array.isArray(c.evidenceIds)?[...new Set(c.evidenceIds.map(id=>originals.get(id)||id))]:c.evidenceIds}))};
 }};
}
module.exports={answerPacket};
