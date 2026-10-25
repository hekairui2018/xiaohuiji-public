'use strict';
// Short request-local handles avoid generating content hashes. Originals remain server-side.
function answerPacket(input,evidence){
 const ids=new Map(evidence.map((e,i)=>[e.evidenceId,'s'+(i+1)]));
 const originals=new Map([...ids].map(([id,short])=>[short,id]));
 const packed=structuredClone(input);
 if(packed.preparedEvidence?.evidence)packed.preparedEvidence.evidence=packed.preparedEvidence.evidence.map(e=>{
  const row={};for(const key of ['text','name','modelIds','category','locator','readPerformed','contextComplete','verificationStatus','sourceKind','scope','compatibilityConfirmed'])if(e[key]!==undefined)row[key]=e[key];
  row.evidenceId=ids.get(e.evidenceId);return row;
 });
 return {input:packed,encode:id=>ids.get(id),decode(output){
  if(output?.action!=='answer')return output;
  return {...output,question:'',generalAdvice:output.generalAdvice||[],claims:output.claims?.map(c=>({...c,evidenceIds:Array.isArray(c.evidenceIds)?[...new Set(c.evidenceIds.map(id=>originals.get(id)||id))]:c.evidenceIds}))};
 }};
}
module.exports={answerPacket};
