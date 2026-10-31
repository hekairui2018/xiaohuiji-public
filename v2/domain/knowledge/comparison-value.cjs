'use strict';
// Keep the source literal. A placeholder or unlabelled glyph cannot establish
// a product capability, even when the opposite column has a concrete value.
function comparisonValue(value,{recorded=true,conflict=false}={}){
 const text=String(value??'').normalize('NFKC').trim();
 if(conflict)return {state:'conflict',capability:null};
 if(!recorded||!text||/^(?:[/／\\—–－-]+|N\/?A|未填写|未记录|未知|待确认)$/i.test(text))return {state:'unknown',capability:null};
 if(/^(?:[xX×✗✘√✓✔]|[○●])$/.test(text))return {state:'uninterpreted-symbol',capability:null};
 if(/^(?:不支持|不具备|无此功能|没有此功能|否)$/.test(text))return {state:'explicit-negative',capability:false};
 if(/^(?:支持|具备|是)$/.test(text))return {state:'explicit-positive',capability:true};
 const dimensions=/(?<![\d.])(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)(?![\d.])/.exec(text);
 return {state:'recorded-value',capability:null,...(dimensions?{quantity:{kind:'listed-dimension-combination',components:[Number(dimensions[1]),Number(dimensions[2])],independentAxisLimitsConfirmed:false}}:{})};
}
const comparisonValueInstructions='单元格语义：value为原值；meaning.state为unknown时仅表示未确认，不能写成无、不支持或没有此接口；uninterpreted-symbol表示原表符号未取得图例，不自行解释x、√等为支持或不支持；conflict须保留冲突。仅explicit-negative/explicit-positive是来源明确的否定/肯定。recorded-value按原值及适用范围说明，勿从对方有值推导本方不支持。quantity.kind为listed-dimension-combination时只表示原表列出的尺寸组合，不能据此把两个分量称为独立最大宽度、最大高度；独立上限须查对应明确字段或原文。';
module.exports={comparisonValue,comparisonValueInstructions};
