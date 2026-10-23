'use strict';
// The model chooses a business action. It cannot manufacture identities,
// calculations, source approval or a completed repair from that choice.
function consultationPlan(question,packet,{software=[]}={}){
 const intent=question.intent||'unknown',missing=packet.question.missing||[];
 const knownObject=question.models?.length||question.software?.length||question.chips?.length;
 const lookupGap=['not-retrieved','search-failed','unparsed','partial'].includes(packet.outcome);
 const supplement=lookupGap&&!question.unknownModels?.length&&!question.ambiguous&&packet.outcome!=='needs-input';
 return {
  task:intent,customerGoal:question.answerQuestion||question.original||'',
  known:packet.question.confirmed,assumptions:packet.question.assumptions,missing,
  identities:{models:question.models||[],software:question.software||[],chips:question.chips||[]},
  softwareCatalog:software.map(s=>({name:s.name,aliases:s.aliases||[]})),
  capabilities:[
   {action:'explain',purpose:'解释适用证据、比较差异和说明条件推断；产品事实必须引用原文'},
   {action:'calculate',purpose:'由已校验配单程序计算像素、尺寸、设备数量和连接区域；模型不能自行确定BOM'},
   {action:'diagnose',purpose:'结合现场结构和已完成检查，选择下一项可回退的对照；结果只能支持排查方向'},
   {action:'guide',purpose:'按手册原文前提、步骤、完成标志指导操作，随客户反馈继续'},
   {action:'find',purpose:'查找公开规格书、手册、软件、固件或视频；目录身份不能证明正文内容'},
   {action:'clarify',purpose:'只问当前任务确实缺少的条件，不重复索要已提供信息'}
  ],
  supplementalSearch:{enabled:supplement,maxSearches:2,goals:supplement?[knownObject?'补齐当前已确认对象与操作/参数之间的原文依据':'理解当前业务目标后查找适用原文；不能自行指定一个设备作为客户设备']:[],reason:supplement?'首轮检索尚未取得回答依据，可换任务表达寻找缺失证据':'使用已准备依据；客户条件缺失与图像未解析不能靠反复搜索消除'}
 };
}
module.exports={consultationPlan};
