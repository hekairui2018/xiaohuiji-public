'use strict';
// Customer-visible execution facts only. Never expose prompts or model reasoning.
function answerProcess({models=[],results=[],modelCallCount=0,status}={}){
 const steps=[];
 const identities=[...new Set(models.filter(m=>typeof m==='string'&&/^(?:HD-)?[A-Za-z0-9][A-Za-z0-9_+.-]{0,45}$/.test(m)))];
 if(identities.length)steps.push({label:'识别型号',detail:identities.join('、')});
 const names=[...new Set(results.map(r=>r.name).filter(n=>typeof n==='string'&&n.length<=200&&!/[\\/]|https?:|[A-Za-z]:|[\r\n]/.test(n)))].slice(0,6);
 if(names.length)steps.push({label:'引用资料',detail:names.join('；')});
 if(Number.isInteger(modelCallCount)&&modelCallCount>0)steps.push({label:'模型处理',detail:'实际调用 '+modelCallCount+' 次'});
 steps.push({label:'处理结果',detail:status==='answer'?'已生成回答':status==='clarify'?'需要补充条件':'本次未完成'});
 return {version:1,steps};
}
module.exports={answerProcess};
