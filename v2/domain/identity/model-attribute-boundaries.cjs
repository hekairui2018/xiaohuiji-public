'use strict';
const {modelId}=require('./model-id.cjs');
// Split only a registry-confirmed model followed by an explicit interface or
// media noun. A real model suffix always wins; arbitrary suffixes stay intact.
function separateModelAttributes(input,lookup){
 const text=String(input).normalize('NFKC');if(!lookup?.findProducts)return text;
 return text.replace(/\b((?:HD[-_ ]?)?[A-Z]{1,20}\d[A-Z0-9_+-]*?)(U盘|USB(?:接口|播放|连接)|HDMI(?:输入|输出|接口)|DP(?:输入|输出|接口))/gi,(whole,device,attribute)=>{
  const token=(whole.match(/^[A-Z0-9_+ -]+/i)||[])[0];
  if(token&&lookup.findProducts(modelId(token)).length)return whole;
  return lookup.findProducts(modelId(device)).length?device+' '+attribute:whole;
 });
}
module.exports={separateModelAttributes};
