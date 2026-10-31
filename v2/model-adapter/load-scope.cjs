'use strict';
// Narrow a simple total-capacity request to explicitly stated output capacity.
// Never calculate total capacity from port count or input resolution.
function loadScope(message,models,rows){
 if(models?.length!==1||!/带载|带多少|控制范围/.test(message)||/网口|每口|单口|输入|对比|比较|接口|灰度|功耗/.test(message))return rows;
 // A table row can contain several chip-dependent capacities separated by
 // semicolons. Keep that row intact: dropping a later clause changes its meaning.
 const matches=rows.map(row=>{
  if(/^structured-(?:comparison|tender)-original$/.test(row.sourceKind))return row;
  const lines=String(row.text||'').split('\n'),selected=[];
  for(let i=0;i<lines.length;i++)if(/最大\s*(?:控制|带载)|整机.{0,8}带载|总带载|带载范围/.test(lines[i])){
   const section=[lines[i]];
   for(let j=i+1;j<Math.min(lines.length,i+5);j++){
    if(!/^\s*(?:常规|PWM|视芯|芯片|(?:\d+\s*[*x×]\s*\d+)|留空|注[：:]|备注)/i.test(lines[j]))break;
    section.push(lines[j]);
   }
   if(/\d/.test(section.join('')))selected.push(section.join('\n'));
  }
  return {...row,text:[...new Set(selected)].join('\n')};
 }).filter(row=>row.text);
 const structured=rows.filter(row=>row.sourceKind==='structured-comparison-original'||row.sourceKind==='structured-tender-original');
 return matches.length?[...structured,...matches.filter(row=>!structured.some(s=>s.evidenceId===row.evidenceId))]:rows;
}
module.exports={loadScope};
