'use strict';
const responseInstructions=`现场条件不足时，clarify.generalAdvice可先给与已知对象相符的安全观察及判别目的，再问关键条件；不假设未知设备的类别或功能。question只放追问。菜单、兼容、参数缺对象可纯追问，不凑流程。缺资料不等于客户没说清。customerStatements及history的user是客户陈述，assistant不是依据。案例条件不能写成客户已提供或已做；用“原案例／本次”分开相同、不同和未知，不用假设型号替换客户前提。最多三例，不拼因果，不堆无关原因，未识别图片不猜图意。`;
function customerStatements(message,history=[]){
 // History is already in input.history and is compacted by the context budget.
 // Do not create a second, unbounded copy that survives history eviction.
 return [{text:message,source:'customer-current',confirmedBySource:false}];
}
// Bound the caller's wait even if a custom transport/tool ignores cancellation.
// Pass the same signal to implementations so real HTTP/tool work also stops.
function withAbort(work,signal){
 signal?.throwIfAborted();
 if(!signal)return Promise.resolve().then(work);
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason||new DOMException('Aborted','AbortError'));
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{signal.throwIfAborted();return work();}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
module.exports={responseInstructions,customerStatements,withAbort};
