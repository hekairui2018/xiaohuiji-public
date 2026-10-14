'use strict';
// Extract explicit parameters only. No device selection, guesses or model calls.
const {extractKnownModels}=require('../identity/extract-models.cjs');
const {parseOrderingFields}=require('./ordering-fields.cjs');
function parseInput(input,dataset,{operation:forcedOperation}={}){
 if(input&&typeof input==='object'&&!Array.isArray(input))return {demand:input};
 if(typeof input!=='string'||!input.trim())return {status:'needs_input',missing_parameters:[{path:'/topic',reason:'请提供问题或标准需求JSON'}]};
 const text=input.trim();if(text.length>4096)return {status:'invalid_request',errors:[{path:'/topic',code:'too_long'}]};
 const fault=/黑屏|黑电平|灰阶|花屏|闪烁|偏色|连不上|掉线|故障|不开机|异常|水波纹|摩尔纹|鬼影|拖影|横线|竖线|死机|卡死|不亮/.test(text)||(/wi-?fi|ssid/i.test(text)&&/搜不到|搜索不到|找不到|无法搜索/.test(text));
 const order=/配单|配卡|配屏|接收卡数量|网口规划|BOM|拓扑|接线图|选控制卡|匹配控制卡|(?:模组|屏体).*(?:尺寸|宽|高|分辨率)/i.test(text)||(/\bP\d+(?:\.\d+)?\b/i.test(text)&&/\d+\s*[x×]\s*\d+/.test(text)&&/同步|异步/.test(text));
 const operation=fault?'aftersales':forcedOperation|| (order?'ordering':'consultation');
 const demand={schemaVersion:'2.0',operation,topic:text,provenance:{}};
 const models=extractKnownModels(text,dataset);
 if(models.length)demand.providedDevices=models.map(modelId=>({modelId,revisionId:null}));
 if(operation==='aftersales')demand.symptoms=[text];
 if(operation==='ordering'){
  Object.assign(demand,parseOrderingFields(text));
 }
 return {demand};
}
module.exports={parseInput};
