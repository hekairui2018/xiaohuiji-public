'use strict';
// Shared business vocabulary. Relations guide retrieval, never assert product capability.
const softwareAliases=Object.freeze({XiaoHuiYun:['小灰云信息发布系统','小灰云信息发布','小灰云信发','云信发']});
const lexicalAliases=[...softwareAliases.XiaoHuiYun.map(from=>[from,'小灰云']),...['小灰云平台','云平台软件','云平台'].map(from=>[from,'小灰云'])];
const rules=[
 ['module-configuration','resource',s=>/P\s*\d+(?:\.\d+)?/i.test(s)&&/芯片|译码|模组/.test(s)&&/参数|配置文件/.test(s),['模组配置文件'],'品牌、点间距、驱动芯片、译码共同限定配置文件；相近文件标明差异，不当成已确认适用。'],
 ['folded-canvas','procedure',s=>/打折/.test(s)&&/异步|播放|视频|画布|连接图|屏|C\d|H\d|A\d/i.test(s),['连接图打折','画布','超长屏'],'这里的打折是显示几何/画布关系，不是价格或亮度；阈值、素材尺寸和步骤须查对应型号/版本。'],
 ['external-live-content','integration',s=>/叫号|排队/.test(s)&&/系统|数据|对接/.test(s),['动态数据','SDK','二次开发','通信协议'],'检索外部系统实时内容对接；有MQTT或HTTP不等于开放第三方发布接口。'],
 ['password-object','ambiguity',s=>/忘.{0,5}密码|密码.{0,5}忘|找回密码/.test(s),['Wi-Fi密码','设备锁','软件设置密码','账号密码'],'先区分密码对象；不同对象的默认值、找回及重置方式不能混用。'],
 ['export-device-media','procedure',s=>/(?:视频|素材|节目).{0,20}(?:盒子|设备)|(?:盒子|设备).{0,20}(?:视频|素材|节目)/.test(s)&&/下载出来|取出来|拷出来|导出|取回/.test(s),['导出','终端素材','节目存储位置'],'任务是从终端取回素材，不是下载安装播放器或向设备发送节目；路径和可用方式查原文。'],
 ['neutral-edition','edition',s=>/中性|OEM/i.test(s),['中性版','品牌版'],'版别是资料/软件属性；中性文档不证明存在中性软件包。'],
 ['software-overview','overview',s=>/HD\s*(?:Player|Set|Show|Sign)|小灰云|云信发|屏掌控/i.test(s)&&/是什么|干什么|用途|介绍/.test(s),['用途','软件介绍'],'先查软件登记和手册概述；不要把用途说明扩写成所有产品兼容。'],
 ['equipment-label','identity-candidate',s=>/\b(?:HD[- ]?)?[A-Z]+\d+[A-Z]*-\d{2,}-[A-Z0-9-]+\b/i.test(s),['产品身份'],'完整标签可含型号候选和其他标记；仅从登记库取候选，剩余标签保留，不猜硬件/日期。'],
 ['software-spelling','identity',s=>/HD[ _-]*(?:SHOW|PLAYER|SET|SIGN)/i.test(s),['软件身份'],'大小写、空格和连接符变体沿用同一个登记软件身份。'],
 ['lcd-output-selection','selection',s=>/LCD|商显/i.test(s)&&/输出/.test(s)&&/[一二三四五六七八九十\d]+路/.test(s),['视频输出','独立输出','复制输出'],'这是LCD输出能力选型，不是LED屏配单；多台软拼接不等价于单板多路物理输出。'],
 ['box-abbreviation','identity-candidate',s=>/\b(?:HD[- ]?)?\d{4}[- ]?BOX\b/i.test(s),['BOX产品身份'],'按数字和BOX角色查登记产品候选，保留型号后缀；简称不能直接确认完整型号。'],
 ['port-count-selection','selection',s=>/[一二三四五六七八九十\d]+(?:个)?网口/.test(s)&&/异步|盒子|播放盒/.test(s),['网口数量','产品选型'],'客户已给产品类别和网口数量，可反查候选，不要求先提供型号；候选仍按原参数核对。'],
 ['signage-local-mode','procedure',s=>/信发|播放器|MagicPlayer/i.test(s)&&/单机|联网模式|服务器模式/.test(s),['单机模式','联网模式','系统模式'],'检索终端播放器的工作模式；裸“信发”不是小灰云网页版的无条件别名，先结合设备和关联软件查证。'],
 ['simultaneous-windows','selection',s=>/开窗|[一二三四五六七八九十\d]+(?:路|个)?信号上屏/.test(s),['多画面','同时开窗'],'信号同时显示需求须分别核对输入接口数、同时开窗数和输出带载；三者不是同一个指标。'],
 ['c16-receiver-role','topology',s=>/C16L/i.test(s)&&/接收卡|直连|模组/.test(s),['内置带载','外接接收卡'],'区分控制卡内置带载和外接接收卡；历史外接案例不证明所有现场必须外接，实际配置走现有配单规则。'],
];
function relationsFor(text){return rules.filter(([, ,matches])=>matches(String(text))).map(([id,kind,,terms,meaning])=>({id,kind,terms,meaning,basis:'business-retrieval-vocabulary; not product evidence'}));}
function canonicalBusinessText(value){
 const source=String(value);const protectedSpans=[...source.matchAll(/https?:\/\/\S+|[^\s，。；：:,;!?！？"'“”‘’「」『』]+\.[a-z][a-z0-9]{0,9}\b|["'“‘「『][^"'”’」』]*["'”’」』]/gi)].map(m=>[m.index,m.index+m[0].length]);
 return source.replace(/小灰云信息发布系统|小灰云信息发布|小灰云信发|小灰云平台|云平台软件|云信发|云平台/g,(from,index)=>protectedSpans.some(([a,b])=>index>=a&&index<b)?from:lexicalAliases.find(([alias])=>alias===from)[1]);
}
function identityCandidates(text,models=[]){
 const tokens=String(text).match(/\b(?:HD[- ]?)?(?:[A-Z]+\d+[A-Z]*-\d{2,}-[A-Z0-9-]+|\d{4}[- ]?BOX)\b/gi)||[];
 const key=s=>String(s).toUpperCase().replace(/^HD[- ]?/,'').replace(/[ _-]/g,'');
 return tokens.map(input=>{const bare=input.replace(/^HD[- ]?/i,''),prefix=bare.match(/^[A-Z]+\d+[A-Z]*/i)?.[0],box=bare.match(/^(\d{4})[- ]?BOX$/i)?.[1];const candidates=models.filter(m=>prefix?key(m)===key(prefix):box&&new RegExp('^'+box+'[A-Z]*BOX$').test(key(m)));return {input,candidates:[...new Set(candidates)],confirmed:false};}).filter(x=>x.candidates.length);
}
module.exports={canonicalBusinessText,relationsFor,identityCandidates,softwareAliases};
