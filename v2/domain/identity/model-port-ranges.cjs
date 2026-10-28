'use strict';
const {modelId}=require('./model-id.cjs');
// A registry-confirmed device followed by a numbered port range is two typed
// entities even when the customer omitted a space. Unknown suffixes stay intact.
function separateModelPortRanges(input,lookup){
 const text=String(input).normalize('NFKC');if(!lookup?.findProducts)return text;
 return text.replace(/\b((?:HD[-_ ]?)?[A-Z]{1,20}\d[A-Z0-9_+-]*)\s*(~|～|至|到|—|–|-)\s*(\d{1,3})\s*(网口|端口|通道|路输出|号口)/gi,(whole,token,separator,end,unit)=>{
  if(lookup.findProducts(modelId(token)).length)return whole;
  for(let length=1;length<=3;length++){
   const index=token.slice(-length),device=token.slice(0,-length);
   if(!/^\d+$/.test(index)||!/[A-Z]\d|\d[A-Z]/i.test(device)||Number(index)<1||Number(index)>Number(end))continue;
   if(lookup.findProducts(modelId(device)).length)return device+' '+index+separator+end+unit;
  }
  return whole;
 });
}
module.exports={separateModelPortRanges};
