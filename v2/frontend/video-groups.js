/* Browse-only taxonomy: no compatibility inference or changes to source files. */
(function(root){
'use strict';
function classify(video,source={}){
 const name=video.name||'',key=source.key||'',label=source.label||'';
 // Explicit computer environment content must never inherit an LED product folder.
 if(/华硕|H510M[-_ ]?K|BIOS|开启核显|显卡驱动|电脑驱动|Windows安装|远程工具|ToDesk|向日葵/i.test(name))return ['support',/核显|BIOS|主板/i.test(name)?'电脑主板与显示环境':'辅助工具'];
 if(key==='lcd'||/LCD|液晶|商显|Huidu\s*OS|MagicPlayer|(?:^|[^A-Za-z0-9])M20(?=[^A-Za-z0-9]|$)/i.test(name))return ['lcd',topic(name)];
 if(/校正|校准|calibrat/i.test(name))return ['calibration','操作教程'];
 if(/HD\s*Set/i.test(name)||/接收卡|扇形模组调试|梯形模组调试|不对称多开接线/.test(name))return ['display',/HD\s*Set/i.test(name)?'HDSet':/接收卡/.test(name)?'接收卡升级':'特殊屏体接线与调试'];
 const sw=name.match(/HD\s*(Player|Show|Sign|2020|2018)/i);
 if(sw)return ['software',{'player':'HDPlayer','show':'HD Show','sign':'HDSign','2020':'HD2020','2018':'HD2018'}[sw[1].toLowerCase()]];
 if(/云平台|小灰云|cloud/i.test(name))return ['cloud','云平台操作'];
 if(/屏掌控|LedArt|(?:^|[^A-Za-z])APP(?:[^A-Za-z]|$)/i.test(name))return ['app',/单色|单双色|single/i.test(name)?'单双色操作':/全彩|fullcolor/i.test(name)?'全彩操作':'通用操作'];
 if(/(?:^|[^A-Za-z0-9])(?:HD[-_ ]?)?(?:VPX?|KV|VS)(?:\d|xx|系列)/i.test(name)||key==='processor')return ['processor',topic(name)];
 if(/单双色|单色|(?:^|[^A-Za-z0-9])D15(?:reset|[^A-Za-z0-9]|$)/i.test(name)||key==='mono')return ['mono',topic(name)];
 if(/(?:^|[^A-Za-z0-9])(?:HD[-_ ]?)?(?:A[35678]L?|B[368][LH]?|C\d+[A-Z]*|CX6)(?=[^A-Za-z0-9]|reset|$)/i.test(name))return ['player',topic(name)];
 if(/全彩|异步|LED|W系列|WF系列/.test(name)||label==='LED')return ['general',topic(name)];
 return ['other',topic(name)];
}
function topic(name){
 // Specific business objects precede generic words such as update, program and setup.
 if(/屏参/.test(name))return '屏参与显示配置';
 if(/节目|program/i.test(name)&&/更新|update|U盘|Udisk/i.test(name))return '节目制作与发布';
 if(/固件|烧录|升级|刷机|刷固件|线刷|OTA|firmware|upgrade|the update of M20/i.test(name))return '固件升级与烧录';
 if(/复位|恢复出厂|reset/i.test(name))return '复位与恢复出厂';
 if(/Wi.?Fi|热点|固定\s*IP|IP地址|网段|联网|配网|网络|路由|Station|network|局域网/i.test(name))return '网络连接与配置';
 if(/拼接|同步|投屏|多屏|镜像|multi.screen|synchron/i.test(name))return '拼接、同步与投屏';
 if(/开窗|两画面|多画面|multi.window|multi.signal/i.test(name))return '开窗与多画面';
 if(/云平台|小灰云|cloud/i.test(name))return '云平台与远程管理';
 if(/APP|屏掌控|LedArt|手机信发/i.test(name))return '手机 APP 操作';
 if(/ADB|开发|APK|应用安装|安装软件|软件安装|第三方|环境搭建/i.test(name))return '应用安装与开发调试';
 if(/节目|播放|发布|转码|插播|program|playback/i.test(name))return '节目制作与发布';
 if(/LCD\s*Player|MagicPlayer/i.test(name))return '播放软件操作';
 if(/按钮|断电重启|开机自启动/.test(name))return '按键与启动设置';
 if(/LOGO|旋转|分辨率|亮度|屏幕|遥控|屏保|配置|设置|双屏异显/.test(name))return '屏幕与系统设置';
 if(/回读.*日志|Read back log/i.test(name))return '日志读取';
 if(/连接|接线|连接图/.test(name))return '连接与接线';
 if(/软件下载/.test(name))return '软件下载';
 if(/UI更新/.test(name))return '界面更新 · 所属软件待核对';
 if(/互动|数字人/.test(name))return '互动功能';
 if(/产品介绍|^HD[-_ ]?(?:3288|3566|3568)S\.mp4$|^M30\.mp4$/i.test(name))return '产品介绍与演示';
 if(/操作|演示|教程|调试|operation/i.test(name))return '基础操作与调试';
 return '主题待核对';
}

// Server browse categories are authoritative. Keep their labels and order.
// Operation topics may only be used as optional second-level sections supplied
// by the server. Do not re-classify videos from filename patterns in the UI.
function organize(groups){
 const out=[];
 for(const source of groups||[]){
  const videos=Array.isArray(source.videos)?source.videos:[];
  if(!videos.length)continue;
  const sections=Array.isArray(source.sections)&&source.sections.length
   ?source.sections.filter(s=>Array.isArray(s.videos)&&s.videos.length)
   :[{label:source.label||'操作视频',videos}];
  out.push({...source,key:source.key||'other',label:source.label||'其他',videos,
    sections,count:videos.length});
 }
 return out;
}
// Software cards show introductory walkthroughs, not every video in a shared folder.
function softwareVideos(software){
 const media=software.videos||{},items=[media.primary,...(media.more||[])].filter(Boolean);
 const pc={HDSet:'HDSet',HDPlayer:'HDPlayer',HDShow:'HDShow',HD2020:'HD2020',HD2018:'HD2018',HDSign:'HDSign',LCDPlayer:'LCDPlayer'};
 return items.filter(video=>{
  const name=video.name.replace(/\.(mp4|webm|mov)$/i,'').replace(/[\s_“”「」]/g,'');
  let rest;
  if(pc[software.id]){
   const prefix=pc[software.id];if(name.slice(0,prefix.length).toLowerCase()!==prefix.toLowerCase())return false;
   rest=name.slice(prefix.length);
  }else if(software.id==='PingZhangKong'){
   if(!/^(屏掌控|全彩APP标准版|APP操作动画)/i.test(name))return false;
   rest=name.replace(/^屏掌控(?:APP)?(?:标准版|单色版)?[-—]?(?:全彩卡|单色卡)?|^全彩APP标准版|^APP(?=操作动画)/i,'');
  }else if(software.id==='XiaoHuiYun'){
   if(!/^(小灰云|云平台)/.test(name))return false;rest=name.replace(/^(小灰云|云平台)[-—]?/,'');
  }else return false;
  return /^(?:基本操作|基础操作|简易操作|操作视频|操作演示|操作教程|操作动画|使用教程|入门教程|操作)(?:[（(].*[）)]|[-—]?(?:中文版|英文版|中文|英文|英语|中|英|印尼语)|V?\d[\d.px-]*|x264)*$/i.test(rest);
 });
}
const api={organize,classify,topic,softwareVideos};if(typeof module==='object'&&module.exports)module.exports=api;else root.VideoGroups=api;
})(typeof window==='object'?window:globalThis);
