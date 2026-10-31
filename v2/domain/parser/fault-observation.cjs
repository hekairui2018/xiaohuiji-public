'use strict';
// Observed state grammars, not a diagnosis or a list of customer sentences.
// Retrieval translations never replace original hardware identifiers.
const colorNames={红:'red',绿:'green',蓝:'blue',白:'white',黑:'black',red:'red',green:'green',blue:'blue',white:'white',black:'black'};
const chineseColor={red:'红',green:'绿',blue:'蓝',white:'白',black:'黑'};
function faultObservation(value){
 const text=String(value).normalize('NFKC'),observations=[],normalChecks=[];
 const changed=/之后|以后|完成后|设置后|现在|却|突然|一直|仍然|但是|\b(?:after|now|still|instead|but|stuck)\b/i.test(text);
 const desired=/(?:怎么|如何|怎样).{0,10}(?:设置|选择|生成|显示|播放).{0,10}(?:纯色|测试|红色|绿色|蓝色|白色|黑色)|(?:支持|有无|有没有).{0,18}(?:纯色|全蓝|全红|全绿|测试功能)|\bhow\s+(?:(?:can|do)\s+i\s+|to\s+)(?:set|display|select|generate|play)|\b(?:support|supports|feature|capability)\b/i.test(text);
 function add(kind,match,terms){if(!match)return;const before=text.slice(Math.max(0,match.index-8),match.index);if(/不是|并非|没有出现|不再|\bnot\s*$/i.test(before))return;observations.push({kind,text:match[0],start:match.index,end:match.index+match[0].length,retrievalTerms:terms});}
 if(!desired||changed){
  const cn=/(?:屏幕|显示屏|模组|灯板|测试(?:画面)?|画面)[^，。；;!?\n]{0,20}?(?:全|只(?:有|显示)?|一直|一片|纯)(?:是|为|显示)?([红绿蓝白黑])(?:色|屏)?/g;
  for(const m of text.matchAll(cn)){if(/不是|并非|不再/.test(m[0]))continue;const color=colorNames[m[1]];add('color-state',m,['颜色异常','全'+chineseColor[color]]);}
  const en=/\b(?:screen|display|panel|receiver\s+test|test\s+(?:pattern|screen))\b[^,.!?;\n]{0,35}?\b(?:is|looks?|shows?|displays?|stays?|turns?|stuck|only|all|solid|entirely)\s+(?:(?:always|only|all|solid|entirely|completely|in|on|a)\s+)*(red|green|blue|white|black)\b/gi;
  for(const m of text.matchAll(en)){if(/\b(?:not|never|no longer)\b/i.test(m[0]))continue;add('color-state',m,['颜色异常','全'+chineseColor[m[1].toLowerCase()]]);}
 }
 const failures=[
  ['network',/\b(?:(?:cannot|can't|unable\s+to|fails?\s+to)\s+(?:connect|discover|detect|find)\b[^.!?;\n]{0,30}|(?:connection|network|wifi|wi-fi)\s+(?:fails?|drops?|disconnects?|is\s+offline))\b/gi,['连接失败']],
  ['application-failure',/\b(?:software|app|application|program)\s+(?:crashes?|freezes?|is\s+not\s+responding|won't\s+open|cannot\s+open)\b/gi,['软件异常']],
  ['flicker',/\b(?:screen|display|panel)\s+(?:is\s+)?(?:flickering|flashing|flickers|flashes)\b/gi,['闪烁']],
  ['no-output',/\b(?:no\s+signal|no\s+output|nothing\s+is\s+displayed)\b/gi,['无信号']],
  ['upgrade-failure',/\b(?:firmware\s+(?:upgrade|update)|upgrade|update|upload|sending)\s+(?:fails?|failed|error)\b/gi,['升级失败']]
 ];
 if(!desired||changed)for(const [kind,pattern,terms]of failures)for(const m of text.matchAll(pattern))add(kind,m,terms);
 for(const m of text.matchAll(/(?:标序|编号|序号)[^，。；;\n]{0,8}(?:正常|正确)|(?:module\s+)?(?:numbering|indexing|numbers)[^,.!?;\n]{0,20}(?:normal|correct|works)/gi))normalChecks.push({kind:'module-numbering',text:m[0],start:m.index,end:m.index+m[0].length,retrievalTerms:['标序正常']});
 const receiverTest=/接收卡.{0,8}(?:打)?测试|\breceiver\s+test\b|\btest\s+(?:pattern|screen)\b/i.test(text);
 return {observations,normalChecks,stage:receiverTest?'receiver-test':null,retrievalTerms:[...new Set([...observations.flatMap(o=>o.retrievalTerms),...normalChecks.flatMap(o=>o.retrievalTerms),...(receiverTest?['接收卡测试']:[])])]};
}
module.exports={faultObservation};
