'use strict';
// Historical outcomes describe one recorded site. A successful historical
// outcome alone does not establish a procedure or authorize present firmware.
function caseAdviceContract(record){
 const text=[record.sourceExcerpt,record.historicalSolution,record.possibleCause].filter(Boolean).join('\n');
 const temporary=/(?:临时|测试|未发布|研发提供).{0,30}(?:版本|固件|FPGA)|(?:固件|FPGA).{0,15}(?:临时|测试|未发布)/i.test(text);
 const operationClasses=[];
 if(/恢复出厂|复位|初始化|清除(?:配置|参数)/.test(text))operationClasses.push('reset-or-clear');
 if(/升级|刷写|烧录|固件/.test(text))operationClasses.push('firmware-change');
 if(/发送.{0,10}参数|下发|改写|调(?:整|节|低|高).{0,16}(?:参数|电流|增益|时钟)|DCLK/i.test(text))operationClasses.push('configuration-write');
 return {caseId:record.stableId||null,caseStatus:record.caseStatus||'unknown',solutionStatus:record.solutionStatus||'unknown',historicalOutcome:record.historicalSolution||null,
  applicability:structuredClone(record.scope||{}),historyOnly:true,operationClasses,temporaryFirmwareMentioned:temporary,
  hasDocumentedWorkflow:record.executableEvidence===true&&Array.isArray(record.workflow?.nodes)&&record.workflow.nodes.length>0,
  presentSiteCompatibilityConfirmed:false};
}
const caseAdviceInstructions='历史案例回答：先指出匹配现象及关键适用条件，简短转述当时处理和最终状态；已解决、挂起、未复现、返厂应按原记录区分，不把跟进中的经验写成当前已确诊。caseSemantics只整理原案例的条件和结果，不代表现场适用批准。把只读核查与会改变配置、固件或中断显示的操作分开：复位、恢复出厂、发送/写入参数、调电流或时钟、升级固件均不称为“无损检查”。重启、拔插或对调线缆、关闭定时功能也会中断显示或改变状态，不归为只读；可以提出有判别价值的对调实验，但说明需要维护窗口及实验观察目标。缺少可核验的操作步骤、准确适用条件或恢复方案时，可以交代历史处理方向，但不要转成“现在直接执行”的步骤。临时/测试固件只能说明历史曾使用，客户条件相同、具备备份也不等于该包现在已获批准；版本号更高或更低也不能单独证明升级适用性，需有当前正式文件及适用证据才能推荐。无需把每项风险重复列出，仅在涉及该操作时说明缺口。通用建议保留少量与现场事实相关的工程分析、只读观察及判别目的；不把同型号现象相似当成因果确认，不主动引入无依据的菜单或具体调参值。';
function needsCaseActionReview(output,cases=[]){
 if(!cases.some(c=>c?.historyOnly&&c.presentSiteCompatibilityConfirmed!==true&&c.operationClasses?.length))return false;
 return (output.generalAdvice||[]).some(text=>String(text).split(/[。；;\n]/).some(clause=>
  !/不要|不能|不应|不建议|禁止|尚未确认/.test(clause)&&/(?:先|再|请|建议|可以|可|尝试|把|将).{0,28}(?:升级|刷写|复位|恢复出厂|断开|拔插|更换|调(?:到|为|整)|设(?:为|置为)|关闭|重新执行)/.test(clause)));
}
function boundReviewedCaseAdvice(output,cases=[]){
 if(!needsCaseActionReview(output,cases))return output;
 const advice=(output.generalAdvice||[]).filter(text=>!needsCaseActionReview({generalAdvice:[text]},cases));
 return {...output,generalAdvice:[...advice,'上述历史处理尚未确认适用于当前现场，不能据此直接执行改参、复位或升级。'].slice(-6)};
}
module.exports={caseAdviceContract,caseAdviceInstructions,needsCaseActionReview,boundReviewedCaseAdvice};
