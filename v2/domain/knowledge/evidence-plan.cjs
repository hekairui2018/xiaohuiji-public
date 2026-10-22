'use strict';
// Evidence requirements and scene comparison, not a business intent router.
// Customer text stays unchanged. These aliases only normalize retrieval terms.
const canonical=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/u盤|优盘|隨身碟|usb闪存/g,'u盘').replace(/網路|網絡|网络/g,'网络').replace(/離線/g,'离线').replace(/影片/g,'视频').replace(/燒錄/g,'烧录').replace(/播放內容/g,'播放内容').replace(/wi[\s-]?fi/g,'wifi');
const media=[['usb-disk',/u盘/],['ethernet',/网线|以太网|有线/],['wifi',/wifi|无线|ssid|热点/],['usb-link',/usb(?!闪存)/],['network',/网络|联网|互联网|云端|云平台/]];
const taskWords=[['play',/播放|视频|节目/],['send',/发送|发布|投发/],['upgrade',/升级|刷机|烧录固件/],['configure',/调试|配置|设置/],['read',/回读|读取/],['control',/控制(?!卡|器|系统)|切换|暂停|定时/]];
function scene(text){
 const value=canonical(text),positive=[],negative=[],normal=[];
 for(const [id,re]of media){const m=re.exec(value);if(!m)continue;const before=value.slice(Math.max(0,m.index-10),m.index),after=value.slice(m.index+m[0].length,m.index+m[0].length+8);
  ((/(?:不(?:使用|通过|用|走|连接|接入)|不用|无需|没有使用|未使用)[\s的]*$/.test(before)||id==='network'&&/不$/.test(before))&&!/(?:无法|不能|不正常)$/.test(before)?negative:positive).push(id);
  if(/正常|可用|已排除/.test(after))normal.push(id);
 }
 if(/离线|不联网/.test(value)&&!negative.includes('network'))negative.push('network');
 const tasks=taskWords.filter(([,re])=>re.test(value)).map(([id])=>id);
 const phases=[['after-upgrade',/升级(?:完|完成)?后/],['after-restart',/重启(?:完)?后|断电.*重启/],['media-insert',/插(?:入|上)?u盘/],['after-change',/换(?:了|完)?(?:电脑|卡|设备)|更换.*后/],['during-send',/发送(?:中|时|过程中)/],['during-play',/播放(?:中|时|过程中)/]].filter(([,re])=>re.test(value)).map(([id])=>id);
 const scope=[['local',/局部|右边|左边|单箱体|单个/],['whole',/整屏|全部|所有设备/]].filter(([,re])=>re.test(value)).map(([id])=>id);
 const exclusions=(value.match(/(?:已排除|确认不是|不是因为)[^，。；]{1,25}/g)||[]);
 return {media:positive,deniedMedia:negative,knownNormal:normal,tasks,phases,scope,exclusions};
}
function evidencePlan(q){
 const text=canonical(q.decision?.focusText||q.original),scenario=scene(text);
 const dependency=/(?:必须|一定|需要|要不要|不用|不配|不接|是否要)/.test(text)&&/接收卡|接收能力/.test(text);
 const purpose=dependency?'component-dependency':q.operation?.selectSoftware?'software-selection':/服务.{0,8}到期|授权.{0,8}到期|未授权|未激活|权限不足/.test(text)?'service-access':q.intent;
 const terms=purpose==='component-dependency'?['接收卡','板载','HUB75']:purpose==='software-selection'?['软件']:q.operation?.upgrade?['升级','接收卡']:q.operation?.sendProgram?['节目更新']:[...scenario.media.map(id=>({'usb-disk':'U盘',wifi:'Wi-Fi',ethernet:'网线','usb-link':'USB',network:'网络'}[id])),...scenario.tasks.includes('play')?['播放']:[],...scenario.tasks.includes('control')?['控制']:[],...(q.operation?.terms||[]).filter(t=>t.length<=4)];
 return {purpose,scenario,terms:terms.length?terms:q.operation?.terms||[],hardConstraints:{models:q.models,chips:q.chips,versions:q.versions,resource:q.resourceConstraints},requiredEvidence:purpose==='component-dependency'?'original-component-architecture':purpose==='software-selection'?'model-software-association':q.intent==='operation'?'task-steps-with-prerequisites':q.intent==='aftersales'?'same-symptom-with-scene-conditions':'relevant-original'};
}
function compareScene(expected,candidate){
 const actual=scene(candidate),matched=[],missing=[],conflicts=[],different=[];
 for(const id of expected.media)(actual.media.includes(id)?matched:missing).push('media:'+id);
 for(const id of expected.deniedMedia)if(actual.media.includes(id)&&!actual.deniedMedia.includes(id))conflicts.push('denied-media:'+id);
 for(const id of expected.tasks)(actual.tasks.includes(id)?matched:missing).push('task:'+id);
 for(const id of expected.phases)(actual.phases.includes(id)?matched:missing).push('phase:'+id);
 if(expected.phases.length&&actual.phases.length&&!expected.phases.some(p=>actual.phases.includes(p)))different.push('different-trigger-stage');
 for(const id of expected.scope)if(actual.scope.length&&!actual.scope.includes(id))different.push('different-fault-scope');
 for(const id of expected.knownNormal)if(actual.media.includes(id)&&new RegExp('(?:'+(id==='ethernet'?'网线|以太网':id==='wifi'?'wifi|无线':id==='usb-disk'?'u盘':id)+').{0,8}(?:失败|异常|搜不到|无法)').test(canonical(candidate)))conflicts.push('known-normal:'+id);
 return {matched,missing,conflicts,different,conditional:missing.length>0||different.length>0,score:matched.length*4-missing.filter(x=>x.startsWith('media:')).length*6-different.length*10};
}
function capabilityExcerpt(text,plan){
 if(plan.purpose!=='component-dependency')return null;
 const lines=String(text).split(/\n|(?<=[。；;])/).map(x=>x.trim()).filter(x=>x.length<650&&/板载|自带|集发送.*接收|HUB75|内置接收|receiv|on.?board/i.test(x));
 return lines.length?lines.slice(0,3).join('\n'):null;
}
module.exports={canonical,scene,evidencePlan,compareScene,capabilityExcerpt};
