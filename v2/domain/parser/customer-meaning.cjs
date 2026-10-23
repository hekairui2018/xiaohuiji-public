'use strict';
// Shared language observations. These never select a product, repair an ID,
// assign an absent unit, or turn catalogue assumptions into customer facts.
function chineseNumber(value){
 const digits={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 if(!/[十百千]/.test(value))return Number([...value].map(c=>digits[c]).join(''));
 let total=0,current=0;for(const c of value){if(c in digits)current=digits[c];else{total+=(current||1)*({'十':10,'百':100,'千':1000}[c]);current=0;}}return total+current;
}
function spokenGeometry(value){
 return String(value).normalize('NFKC')
  .replace(/[零〇一二两三四五六七八九十百千]+(?=\s*(?:块|张|列|行|排|毫米|厘米|米|像素|点|宽|高))/g,s=>String(chineseNumber(s)))
  .replace(/宽度|宽那边|宽这边/g,'宽').replace(/高度|高那边|高这边/g,'高')
  .replace(/(宽|高)\s*(?:不要|不是)\s*\d+(?:了)?\s*[，,]?\s*(\d+)\s*(张|块|列|行)/g,'$1$2$3')
  .replace(/(宽|高)\s*(?:改成|改为|调整为|换成|变成|是|为)\s*/g,'$1');
}
function describedControlMode(value){
 const text=String(value).normalize('NFKC').replace(/(?:不是|不要|不用|无需|不需要|不)\s*(?:实时|同步|复制|脱机|离线|独立播放)[^，,。；;]*/g,'');
 const async=/脱机播放|离线播放|独立播放|节目.{0,12}(?:自己|独立|自动|断网|离线|脱机).{0,8}播|(?:发|传|拷|存).{0,10}节目.{0,12}(?:自己|独立|自动).{0,6}播|(?:U盘|优盘).{0,18}(?:自己|脱机|独立).{0,6}播|不(?:用|需|要)?(?:长期)?接电脑.{0,12}(?:播|运行)/i.test(text);
 const sync=/(?:实时|同步|复制).{0,6}(?:显示|播放|跟随)?\s*(?:电脑|计算机|笔记本|HDMI).{0,6}(?:画面)?|(?:跟|随|和|与)(?:电脑|笔记本).{0,8}(?:一样|一致|同步|同画面)|电脑.{0,6}显示什么.{0,8}(?:屏|就).{0,6}显示什么/.test(text);
 return async&&!sync?'async':sync&&!async?'sync':null;
}
function orderingScene(text,fields){
 const s=fields.screen||{},m=fields.module||{};
 const geometry=!!((s.moduleColumns&&s.moduleRows)||(s.pixelWidth&&s.pixelHeight)||(s.physicalWidthMm&&s.physicalHeightMm));
 const request=/配单|配屏|选型|清单|方案|帮.{0,6}选|选.{0,8}(?:主控|控制器|控制设备|接收卡)|(?:控制器|主控|接收卡).{0,12}(?:各要|数量|几张|多少)/.test(text);
 return geometry&&(!!m.pitchMm||request)||!!m.pitchMm&&(!!fields.controlMode||!!fields.environment)&&/屏|模组|广告|配|(?:宽|长)\s*\d+.{0,10}高\s*\d+/.test(text);
}
module.exports={chineseNumber,spokenGeometry,describedControlMode,orderingScene};
