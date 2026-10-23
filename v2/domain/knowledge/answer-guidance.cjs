'use strict';
// A presentation recommendation, never a second router or a model invocation.
function answerGuidance(query,result){
 const intent=result.intent||query.intent,type=result.answerType||'';
 const reasons=[];
 if(type==='multiple-actions')reasons.push('你的问题包含多个需要一起分析的需求');
 if(intent==='feedback'||query.taskPlan?.relation==='FEEDBACK')reasons.push('上一轮回答没有解决问题，需要结合前文重新分析');
 if(['aftersales','compatibility'].includes(intent))reasons.push('需要核对现场条件和资料适用范围');
 if(intent==='technical'||query.original?.length>240)reasons.push('需要结合较长描述和上下文解释');
 if(/insufficient-evidence|unrecognized-intent/.test(type))reasons.push('快速检索暂未找到足以直接回答的证据');
 const missing=/insufficient|not-found|not-registered|unavailable/.test(type)||result.status==='not-found';
 return {answerBasis:result.status==='clarify'?'clarification':missing?'insufficient':result.results?.length?'source-excerpt':intent==='ordering'?'calculation':'conversation',
  expertSuggestion:reasons.length?{recommended:true,reason:reasons.join('；'),label:'请专家继续分析',message:'请结合上文继续分析我的问题，沿用我已提供的条件；先回答可确认的部分，再问最关键的缺项。'}:null};
}
function sourceLocation(locator){
 if(typeof locator==='string')return locator;
 const labels={page:'页',paragraph:'段',row:'行',sheet:'工作表',slide:'幻灯片',section:'章节',line:'行',table:'表'};
 return Object.entries(locator||{}).filter(([k])=>labels[k]).map(([k,v])=>`${labels[k]} ${v}`).join(' · ');
}
function conciseParameters(rows){
 // Only remove pure notes from the answer when quantitative evidence exists;
 // preserve them as conditions and keep every source card available.
 const quantitative=rows.filter(r=>/\d/.test(r.text)&&!/^\s*(?:注[：:]|Note\s*:)/i.test(r.text));
 const selected=quantitative.length?quantitative:rows;
 const groups=new Map();
 for(const row of selected){const key=JSON.stringify([row.modelIds||[],row.documentVersion||'',row.field||'',row.conditions||[]]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 return [...groups.values()].flatMap(group=>group.slice(0,2));
}
module.exports={answerGuidance,sourceLocation,conciseParameters};
