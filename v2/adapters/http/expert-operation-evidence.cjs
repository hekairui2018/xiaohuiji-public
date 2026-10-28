'use strict';
// Keep native chunks and their source identities. Prefer executable sequences
// over a lone feature sentence; retrieval scores are not completeness proofs.
function selectOperationEvidence(rows=[],plan={}){
 const norm=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
 const terms=(plan.terms||[]).map(norm),actions=plan.actions||[],seen=new Set();
 const {operationTarget,operationCoverage}=require('../../domain/knowledge/operation-target.cjs'),target=operationTarget(plan);
 return rows.filter(r=>!r.resourceOnly&&r.kind!=='video'&&r.text).map(r=>{
  const text=r.originalText||r.text,body=norm(text);
  const verbs=new Set(text.match(/点击|选择|打开|进入|勾选|输入|新建|添加|保存|导出|插入|连接|发送/g)||[]).size;
  const coverage=terms.length?terms.filter(t=>body.includes(t)).length/terms.length:0;
  const steps=(text.match(/(?:^|\n)\s*(?:\d+[.、）)]|[①②③④⑤⑥⑦⑧⑨])/g)||[]).length;
  const command=actions.some(action=>new RegExp('(?:点击|选择|打开|进入|勾选|按下|右键|单击)[^。；;\\n]{0,30}'+action.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(text));
  const goal=operationCoverage(text,target);
  return {row:r,goal,score:coverage*3+Number(command)*4+Math.min(verbs,6)*.25+Math.min(steps,5)*.15+Number(goal.complete)*8};
 }).filter(x=>x.goal.primarySupported!==false).sort((a,b)=>b.score-a.score).filter(({row})=>{const key=norm(row.originalText||row.text);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,4).map(x=>x.row);
}
module.exports={selectOperationEvidence};
