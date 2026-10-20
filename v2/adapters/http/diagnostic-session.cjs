'use strict';
// Ephemeral adapter state, no production data writes. Domain remains stateless.
function createDiagnosticSessions({maxSessions=200,ttlMs=300000,now=Date.now,understandInput}={}){
 const sessions=new Map();
 function key(id){return typeof id==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(id)?id:null;}
 const expiry=setInterval(()=>{for(const [id,row]of sessions)if(now()-row.at>ttlMs)sessions.delete(id);},30000);expiry.unref?.();
 return {
  clear(id){sessions.delete(key(id));},
  continue(id,text){const k=key(id),saved=sessions.get(k);if(!saved||now()-saved.at>ttlMs){sessions.delete(k);return null;}
   const d=saved.result.diagnosis,t=String(text||'').trim();let observations=[];
   const extra=t.match(/^(?:补充现象|补充条件|现场变化)[:：]\s*(.+)$/);
   if(extra){const parsed=understandInput?.(extra[1],'aftersales')?.demand||{},history=[...(saved.demand.provenance?.diagnosticRounds||[]),{symptoms:saved.demand.symptoms,observations:saved.demand.observations||[],reason:'user-supplied-new-conditions'}].slice(-10);
    return {...saved.demand,...parsed,operation:'aftersales',symptoms:[...(saved.demand.symptoms||[]),extra[1]],observations:[],provenance:{...saved.demand.provenance,...parsed.provenance,diagnosticRounds:history}};
   }
   if(d.state==='confirm-scope'&&/^(是|确认|条件一致|适用条件一致|型号和条件一致)$/.test(t))observations=[{checkId:d.activeCaseId+'-scope',result:'pass'}];
   if(d.state==='confirm-scope'&&/^(否|条件不一致|型号不一致)$/.test(t))observations=[{checkId:d.activeCaseId+'-scope',result:'fail'}];
   if(d.state==='confirm-scope'&&/^(不知道|不清楚|条件未知|未知|还没确认)(芯片型号|扫描方式|型号|条件)?$/.test(t))observations=[{checkId:d.activeCaseId+'-scope',result:'unknown'}];
   if(d.state==='confirm-step-condition'&&/^(是|确认|条件一致|条件满足)$/.test(t))observations=[{checkId:d.activeCheckId,result:'pass'}];
   if(d.state==='confirm-step-condition'&&/^(否|条件不一致|条件不满足|前提不满足|不适用)$/.test(t))observations=[{checkId:d.activeCheckId,result:'fail'}];
   if(d.state==='execute-checks'&&/^(已完成|完成排查|已完成排查|排查已完成)$/.test(t))observations=[{checkId:d.activeCheckId,result:'completed'}];
   if(['execute-checks','observe-step-result'].includes(d.state)&&/^(正常|恢复正常|有改善|有效果|通过)$/.test(t))observations=[{checkId:d.activeCheckId,result:'pass'}];
   if(['execute-checks','observe-step-result'].includes(d.state)&&/^(无效果|没有改善|没有变化|仍然异常|未解决|未通过)$/.test(t))observations=[{checkId:d.activeCheckId,result:'fail'}];
   if(d.state==='verify-phenomenon'&&/^(是|现象消失|恢复正常|已恢复正常|已解决)$/.test(t))observations=[{checkId:d.activeCaseId+'-resolution',result:'pass'}];
   if(d.state==='verify-phenomenon'&&/^(否|未解决|没有解决|仍然异常|未恢复正常)$/.test(t))observations=[{checkId:d.activeCaseId+'-resolution',result:'fail'}];
   const updated=new Map((saved.demand.observations||[]).map(o=>[o.checkId,o]));observations.forEach(o=>updated.set(o.checkId,{...o,text:t}));
   return observations.length?{...saved.demand,observations:[...updated.values()]}:d.state==='supported-branches-exhausted'&&/^(未解决|仍然异常|怎么办)$/.test(t)?saved.demand:null;
  },
  save(id,demand,result){const k=key(id);if(!k||!result.diagnosis)return;
   for(const [id,row]of sessions)if(now()-row.at>ttlMs)sessions.delete(id);
   if(!sessions.has(k)&&sessions.size>=maxSessions)sessions.delete(sessions.keys().next().value);
   sessions.set(k,{at:now(),demand:structuredClone(demand),result:structuredClone(result)});
  }
 };
}
module.exports={createDiagnosticSessions};
