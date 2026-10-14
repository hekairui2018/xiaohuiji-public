'use strict';
const {createDiagnosticSessions}=require('./diagnostic-session.cjs');
const {createOrderingSessions}=require('./ordering-session.cjs');
const {formatResourceReply}=require('./resource-reply.cjs');
// Shared channel response; no call to the quick endpoint/service.
function formatReply(result){
 if(result.resources)return formatResourceReply(result.resources);
 if(result.diagnosis){const d=result.diagnosis;let checks=d.checks||[];
  if(d.state==='confirm-scope')checks=checks.filter(c=>c.checkId.endsWith('-scope'));
  if(['execute-checks','observe-step-result','confirm-step-condition','unresolved-after-checks'].includes(d.state)&&d.activeCheckId)checks=checks.filter(c=>c.checkId===d.activeCheckId);
  if(d.state==='verify-phenomenon')checks=checks.filter(c=>c.checkId.endsWith('-resolution'));
  const instruction={'confirm-scope':'条件完全一致请回复“条件一致”；不一致请回复“条件不一致”。','confirm-step-condition':'前提满足请回复“条件满足”，不满足请补充实际情况。','execute-checks':'完成当前这一步回复“已完成排查”；有现场结果可回复“正常”或“无效果”。','observe-step-result':'请反馈当前步骤的现场结果：“正常”或“无效果”。','verify-phenomenon':'请回复“现象消失”或“未解决”。','unresolved-after-checks':'当前结果未复现资料中的处理效果，请补充新的现象或现场条件。'}[d.state];
  const rejected=(d.branches||[]).filter(b=>!['untried','in-progress'].includes(b.status));
  const branchText=[rejected.length?'已记录 '+rejected.length+' 条流程的条件不符或未复现效果；这不等于已排除故障原因。':null,d.incompleteEvidenceReason].filter(Boolean).join('\n');
  return [d.conclusion?.text||'先核对现场条件，再按资料排查；目前尚未确认故障原因。',d.evidencePolicy==='reference-only-investigation'?'这份记录只支持所引用的排查经验，不能把其中历史处理方案当作已验证方案或固件兼容结论。':null,branchText,...checks.map(c=>c.text+(c.scope?'\n适用条件：'+JSON.stringify(c.scope):'')),instruction,d.state==='supported-branches-exhausted'?'请用“补充现象：…”或“补充条件：…”描述现场新信息，再继续核对有源流程。':null,...(d.sourceReferences||[]).filter(ref=>ref.originalSha256).map(ref=>'原始依据：'+ref.originalName+' · '+(ref.locator||'第'+ref.page+'页')),d.sourceReference?'来源：'+d.sourceReference.file+' · '+d.sourceReference.locator:'暂无适用的有源排查流程'].filter(Boolean).join('\n\n');}
 if(result.knowledge){return [result.knowledge.records.map(p=>[p.displayName||p.model,p.selectedDocumentVersion?'资料版次：'+p.selectedDocumentVersion+'（不是硬件版本）':null,...(p.claims||[]).map(c=>c.text.replace(/(\d),(?=\d{3}\b)/g,'$1')), ...Object.values(p.parameterEvidence||{}).flat().map(r=>'参数来源：'+r.originalName+' · 第'+r.page+'页'),...(p.documents||[]).filter(d=>d.url).map(d=>d.name+'：'+d.url)].filter(Boolean).join('\n')).join('\n\n'),...(result.missing_parameters||[]).map(x=>x.reason)].filter(Boolean).join('\n')||'未找到对应型号资料，请确认完整型号。';}
 if(result.bom)return [`整屏：${result.plan.screen.pixelWidth}×${result.plan.screen.pixelHeight} 像素`,...result.bom.map(x=>`${x.kind==='module'?'模组':x.kind==='receiver'?'接收卡':'主控'} ${x.kind==='module'?'P'+result.plan.module.dotPitch.spacing+' '+result.plan.module.resolution.join('×'):x.modelId}：${x.quantity}`),result.plan.architecture==='direct'?`直控：${result.plan.directOutputs.length} 个逻辑HUB接口区域；实际排线待核对，不生成接收卡SSM`:`网口：${result.plan.ports.length} 个`].join('\n');
 return result.missing_parameters?.map(x=>x.reason).join('\n')||result.reason||'请提供问题或标准需求参数。';
}
function createDialogueService(app){const sessions=createDiagnosticSessions({understandInput:app.understandInput}),ordering=createOrderingSessions(app);return async input=>{
 if(!input||typeof input!=='object'||Array.isArray(input))return {status:'invalid_request',reply:'请提供聊天请求对象。'};
 let request=input.demand||input.message||input;
 if(typeof request==='string'&&request.trim().startsWith('{')){try{request=JSON.parse(request);}catch{return {status:'invalid_request',reply:'标准需求JSON格式不正确。'};}}
 const continued=typeof request==='string'?(sessions.continue(input.sessionId,request)||ordering.continue(input.sessionId,request)):null;
 const result=await app.dialogue(continued||request),reply=formatReply(result);
 ordering.save(input.sessionId,result);
 if(result.diagnosis&&input.sessionId)sessions.save(input.sessionId,result.normalizedDemand,result);
 else if(result.operation&&input.sessionId)sessions.clear(input.sessionId);
 return {status:result.status==='ready'?'answer':result.status==='needs_input'?'clarify':result.status,model:'v2-rules',reply,clarifyQuestion:result.status==='needs_input'?reply:undefined,result};
};}
module.exports={createDialogueService,formatReply};
