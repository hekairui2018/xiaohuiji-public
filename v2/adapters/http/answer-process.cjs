'use strict';
// Customer-visible execution facts only. Never expose prompts or model reasoning.
function answerProcess({models=[],results=[],modelCallCount=0,status,queuePosition=0,liveGeneration}={}){
 const steps=[];
 const identities=[...new Set(models.filter(m=>typeof m==='string'&&/^(?:HD-)?[A-Za-z0-9][A-Za-z0-9_+.-]{0,45}$/.test(m)))];
 if(identities.length)steps.push({label:'识别型号',detail:identities.join('、')});
 const names=[...new Set(results.map(r=>r.name).filter(n=>typeof n==='string'&&n.length<=200&&!/[\\/]|https?:|[A-Za-z]:|[\r\n]/.test(n)))].slice(0,6);
 const running=['running','generating'].includes(status);
 if(names.length||running)steps.push({label:'引用资料',detail:names.length?names.join('；'):'尚未取得可引用资料'});
 if(Number.isInteger(modelCallCount)&&(modelCallCount>0||running))steps.push({label:'模型处理',detail:modelCallCount>0?'实际调用 '+modelCallCount+' 次':'尚未调用'});
 if(Number.isInteger(queuePosition)&&queuePosition>0)steps.push({label:'排队等候',detail:'前面还有 '+(queuePosition-1)+' 个等待请求，空出名额后自动开始'});
 steps.push({label:'处理结果',detail:status==='answer'?'已生成回答':status==='clarify'?'需要补充条件':status==='generating'?'正在生成正文':running?'正在处理':'本次未完成'});
 const rate=n=>Number.isFinite(n)&&n>=0?n:null;
 return {version:1,steps,...(liveGeneration?{liveGeneration:{phase:['input','reasoning','answer'].includes(liveGeneration.phase)?liveGeneration.phase:null,generatedTokens:Number.isSafeInteger(liveGeneration.generatedTokens)&&liveGeneration.generatedTokens>=0?liveGeneration.generatedTokens:null,inputTokensPerSecond:rate(liveGeneration.inputTokensPerSecond),outputTokensPerSecond:rate(liveGeneration.outputTokensPerSecond),includesThinking:liveGeneration.includesThinking===true}}:{})};
}
module.exports={answerProcess};
