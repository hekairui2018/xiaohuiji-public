'use strict';
const {parseInput}=require('./deterministic-parser.cjs');
const {extractKnownModels}=require('../identity/extract-models.cjs');
// Speech acts must consume the whole utterance. A greeting prefix never hides a technical question.
function chatIntent(text,lookup){
 const query=String(text).normalize('NFKC').trim(),social=query.replace(/[\s，。！？!?,.～~]/g,'').toLowerCase();
 if(/^(?:(?:你好|您好|嗨|哈喽|hello|hi)|(?:谢谢|多谢|感谢|thanks)|(?:你是谁|你能做什么|你有什么功能|能帮我什么))(?:呀|啊|哦|了)?$/.test(social))return {intent:'social',social:/谢|thanks/.test(social)?'thanks':/谁|什么|功能/.test(social)?'capabilities':'greeting',query,models:[]};
 const demand=parseInput(query,lookup).demand||{},models=extractKnownModels(query,lookup);
 const unknownModels=(query.match(/\b(?:HD[-_ ]?)?[A-Z]{1,6}\d[A-Z0-9_+-]*/gi)||[]).filter(t=>!(/^(?:P|V|LS|ICN|ICND|SM|FM|MBI|HUB)\d/i.test(t))&&!extractKnownModels(t,lookup).length&&!lookup.isSoftware?.(t));
 if(demand.operation==='aftersales')return {intent:'aftersales',query,models,unknownModels,demand};
 if(demand.operation==='ordering')return {intent:'ordering',query,models,unknownModels,demand:{...demand,operation:'ordering'}};
 const category=/固件|firmware|\.bin\b/i.test(query)?'firmware':/说明书|手册|manual/i.test(query)?'manual':/规格书|specification|datasheet/i.test(query)?'spec':/视频|教程|演示/.test(query)?'video':/软件|HDSet|HDPlayer/i.test(query)?'software':null;
 if(/通用|兼容|混用|互刷|能否.*刷|可以.*刷/.test(query))return {intent:'compatibility',category,query,models,unknownModels};
 if(category)return {intent:'resources',category,query,models,unknownModels,hardwareRequested:/硬件(?:版本)?[：:\s]*[A-Za-z0-9]/i.test(query)};
 if(models.length)return {intent:'product',query,models,unknownModels,hardwareRequested:/硬件(?:版本)?[：:\s]*[A-Za-z0-9]/i.test(query)};
 if(/LED|屏幕|显示屏|控制卡|接收卡|发送卡|芯片|智能设置|HUB75|扫描|灰阶/i.test(query))return {intent:'technical',query,models,unknownModels};
 return {intent:'clarify',query,models,unknownModels};
}
module.exports={chatIntent};
