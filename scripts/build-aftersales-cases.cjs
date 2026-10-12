// 构建【售后经验统一数据表】—— 5+1 问题域框架（可重复遍历更新；不单独设配屏域）
// ==================================================================
// 【更新机制】
//   1) 把新的售后案例原始 JSON 投放到：data/aftersales/sources/
//   2) 重跑本脚本：node scripts/build-aftersales-cases.cjs
//   脚本会自动遍历 sources 目录下所有 *.json（不写死文件名），
//   去重、打问题域/产品线标签、质量分级，重建数据表。
//
// 【收录原则】只收“有源文件原文支撑”的真实经验：
//   必须有原文摘录(sourceExcerpt)或非空解决方案且来自真实源文件，
//   没有原文、纯推断/空壳的经验一律不收录（推倒重来，不背历史包袱）。
//
// 一级主轴=客户问题域（稳定，不随产品线变化），产品系列/型号/芯片仅作标签。
// 现象优先于解决手段：如“升级固件后花屏”归显示效果，不归固件升级。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = "D:\\xiaohuiji";
const SOURCE_DIR = path.join(ROOT, "data", "aftersales", "sources");
const OUT_JSON = path.join(ROOT, "data", "aftersales", "aftersales-cases.json");
const OUT_MD = path.join(ROOT, "data", "aftersales", "aftersales-cases-report.md");

// 当前启用（后端可答）的问题域；其余域先入库、暂不启用，保证“瘦身专精”
const ACTIVE_DOMAINS = ["power_boot", "display", "network", "content", "firmware"];

// ============ 一级问题域（顺序=优先级，现象类在前，手段类靠后）============
const DOMAIN_RULES = [
  {
    key: "display", name: "显示效果异常",
    tags: ["flicker","flower_screen","garbled","color","color_cast","ghost","horizontal_line","vertical_line","line","block","moire","low_gray_glow","blur","burn_in","artifacts","display_incomplete","dark","brightness","row_scan","stutter","flash"],
    regex: /花屏|闪烁|闪屏|闪点|闪色|抖屏|抖动|跳屏|频闪|偏色|偏青|偏紫|偏白|偏暗|缺色|色差|颜色异常|颜色不对|颜色差异|颜色不显示|只显示.{0,3}色|背景颜色|发红|发绿|发蓝|发黄|发黑|发白|暗道|异色|鬼影|拖影|重影|残影|横线|竖线|横条|竖条|亮线|暗线|摩尔|波纹|马赛克|色块|噪点|杂点|黑点|缺陷|油画|低灰|光斑|显示不全|缺行|缺列|画面异常|显示异常|花了|白屏|模糊|斜扫|隔行|底色|色温|智能设置|描点|走线|数据组|抽列/
  },
  {
    key: "power_boot", name: "黑屏死机重启掉线",
    tags: ["black_screen","black","restart","freeze"],
    regex: /黑屏|不亮|点不亮|黑了|重启|死机|卡死|卡顿|卡住|卡logo|卡LOGO|卡在logo|掉线|断电|无显示|没显示|上电不|不运行|闪退|RUN灯|指示灯|运行灯|无法开机|自动重启|反复重启|无反应|按键无反应|进不了.{0,4}界面|进不去系统|无法进入设置|一直弹/
  },
  {
    key: "network", name: "连接联网云平台",
    tags: ["network","signal","connection","cloud","control"],
    regex: /连不上|搜不到|找不到|发现不了|识别不到|识别不了|找卡|找不|探测不到|探测|离线|联网|网络|局域网|IP地址|改IP|网段|在线|云平台|小灰云|通讯|信号|连接设备|连接失败|wifi|wi-fi|4G|5G|超时|光纤|网线|无法找卡|直连|打不开.*wifi|mac地址|投屏|非法ID/
  },
  {
    key: "content", name: "节目播放软件操作",
    tags: ["program","playback","program_send","software","app","audio","video","usb","feature"],
    regex: /节目|播放|发送节目|发送失败|发送不了|发送过去|视频|图片|字体|字幕|排版|分区|不居中|位置偏|APP|U盘|音频|素材|编辑|语言识别|文本|区域|软件|安装.{0,4}(失败|不了)|需要登录|登录不了|命令失败|HDSign|HDPlayer|屏掌控|夏令时|时间显示/
  },
  // 说明：原 config(配屏/智能设置/级联) 域已删除——配屏不是独立功能，智能设置/描点/走线/数据组等
  // “画面调试动作”已并入 display（由售后助手在显示效果问题里指导客户）；带载/拼接/级联等系统能力属配单模块，
  // 不再作为售后故障域，无其他域命中时落 other 兜底。
  {
    key: "firmware", name: "固件升级",
    tags: ["upgrade"],
    regex: /固件升级|升级失败|升级不了|刷固件|回退|刷机|烧录|固件版本不对|找不到固件|升级报错|无法.{0,3}升级|升级不到|升不了级|掉备份|升级.{0,6}丢失/
  },
];
const DOMAIN_NAME = {};DOMAIN_RULES.forEach(r=>DOMAIN_NAME[r.key]=r.name);
DOMAIN_NAME.other="硬件返修其他";DOMAIN_NAME.inquiry="售前咨询/需求(非售后)";

// 咨询/需求类 caseNature（无故障现象时归 inquiry，不作为售后经验）
const INQUIRY_NATURE = new Set(["consultation","requirement"]);

// 显示效果域内部 7 小类
const DISPLAY_SUB_RULES = [
  ["闪烁抖动", { tags:["flicker","flash"], regex:/闪屏|闪烁|闪点|闪色|抖屏|抖动|跳屏|晃动|频闪|一闪一闪|闪一下|频繁闪/ }],
  ["花屏乱码", { tags:["flower_screen","garbled","block","artifacts"], regex:/花屏|色块|乱码|画面乱|画面错乱|画面断裂|马赛克|雪花|杂点|噪点|碎屏|画面破碎/ }],
  ["偏色缺色", { tags:["color","color_cast"], regex:/偏色|色差|颜色异常|颜色不对|颜色不一致|发红|发绿|发蓝|发黄|缺色|纯色|色偏|色温|底色不均|颜色不均/ }],
  ["横竖线条", { tags:["horizontal_line","vertical_line","line"], regex:/横线|竖线|横条|竖条|亮线|暗线|亮暗线|斜扫|隔行|线条|一条线|行线|列线/ }],
  ["鬼影拖影", { tags:["ghost","blur"], regex:/鬼影|拖影|重影|残影|阴影|暗影|模糊|虚影|影子/ }],
  ["波纹摩尔纹", { tags:["moire"], regex:/水波纹|波纹|摩尔纹|网纹|扫描线纹/ }],
  ["显示不全异常", { tags:["display_incomplete","low_gray_glow","stutter"], regex:/显示不全|显示不完整|画面缺失|缺行|缺列|低灰|光斑|显示异常|画面异常|局部不显示/ }],
];

const SOURCE_BLUR = /截取|截图|模板.{0,12}(模糊|下发)|素材|原视频|回显|压缩|转码|分辨率不匹配导致.{0,6}模糊/;
const CATEGORY_LINE = { "单双色":"mono","异步全彩":"async","视频处理":"vp","云平台":"cloud","LCD":"lcd","APP":"app","显示效果&接收卡&HDSet":"rx" };
function lineFromModel(t){t=String(t||"");if(/\bR\d{3,4}\b|接收卡/.test(t))return"rx";if(/\bVP\d|视频处理器|处理器/.test(t))return"vp";return"";}

function normText(v){return String(v??"").replace(/\s+/g," ").trim();}
const PLACEHOLDER=/【原文未|未单列|暂无|无记录|^$/;
function nonEmpty(v){const s=normText(v);return s&&!PLACEHOLDER.test(s);}
function gradeQuality(c){
  const hasCause=nonEmpty(c.finalCause),hasSol=nonEmpty(c.solution),hasProc=nonEmpty(c.troubleshooting);
  if(hasCause&&hasSol)return"A";if(hasSol)return"B";if(hasProc)return"C";return"D";
}
function dedupKey(c){const core=normText(c.customerWording||c.title||c.phenomenon).slice(0,120);return crypto.createHash("md5").update(core).digest("hex").slice(0,16);}

// 是否有“源文件原文支撑”：原文摘录够长，或有非空方案且来自真实源文件
function hasSource(c){
  const ex=normText(c.sourceExcerpt);
  if(ex.length>=12)return true;
  if(nonEmpty(c.solution)&&normText(c.solution).length>=8)return true;
  return false;
}

// 设备级硬现象守卫：出现整屏黑屏/不开机/上电/死机重启/变砖等，任何软词纠偏都不生效，保留 power_boot
const HARD_BOOT_RE=/黑屏|整屏不亮|全黑|完全不亮|点不亮|黑了|不开机|无法开机|开不了机|上电没反应|上电不|无法启动|启动不了|无法正常启动|卡logo|卡LOGO|卡在logo|卡在启动|卡开机|死机|自动重启|反复重启|重启循环|一直重启|变砖|刷成砖|烧保险|跳闸|无法点亮|点亮不了|进不了系统|进不去系统|RUN灯|运行灯|指示灯不亮|只有背光|背光亮没?画面|白屏/;
// 联网/搜索掉线语境：power_boot 旧正则里的“掉线/没反应”会误抢，无硬现象时归连接联网
const NET_SOFT_RE=/掉线|离线|连不上|搜不到|找不到|无法找到|发现不了|发现不到|识别不到|识别不了|无法识别|探测不到|无法发现|找卡|联网|wifi|wi-fi|4g|5g|丢失?IP|丢IP|模块未接入|模块(?:检测不到|识别不到|未接入|无法识别)|软件[^\n。；]{0,8}(?:掉线|找不到|搜不到|识别|发现|连接)|投屏[^\n。；]{0,4}掉线|IP地址|网段|网线|云平台[^\n。；]{0,4}(?:离线|不在线|连不上)/i;
// 纯软件/APP/节目操作的闪退崩溃卡死卡顿（无设备硬现象时归节目操作，不进黑屏开机）
const SOFT_CRASH2_RE=/闪退|崩溃|卡死|卡住|卡顿|无响应|未响应|打不开|无法打开|不能打开|停止运行|已停止|用不了|卡死退出|自动退出|强退|一直加载|加载不出/;
const SOFT_APP2_RE=/软件|APP|App|APK|HDSet|HDPlayer|屏掌控|LCDPlayer|HDSign|magic\s?player|MagicPlayer|boxplayer|eshare|teamviewer|应用|安卓|手机|节目|文本|边框|素材|视频|图片|网页|HTML|U盘|优盘|播放|投屏|数据/;
// 软件功能需求/优化建议（非已发生故障）归咨询需求；“建议/希望”必须后接功能动词，避免误伤“不建议混用”等经验结论
const FEATURE_REQ_RE=/需要在[^\n。；]{0,10}(?:加|增加|新增|开发|支持)|能不能加|可不可以加|提个需求|功能需求|希望(?:增加|新增|加|支持|开发|优化|添加|改进)|建议(?:增加|新增|加|支持|开发|优化|添加|改进)|加一个(?:读取|功能)|新增一个功能/;
// 固件动作/异常（区别于裸“XX固件”售前名词查询）：升级/刷机/烧录/找固件/固件损坏等，明确时优先固件域，不被联网“找不到”抢
const FIRMWARE_ACTION_RE=/刷机|刷固件|烧录|烧写|烧程序|刷程序|变砖|固件(?:异常|损坏|丢失|掉程序|选错|选哪个|找不到|在哪|哪里下载|下载|版本不对|版本异常|回读|升级失败|升级不上|刷不上|烧不上|无法升级|升级不了)|升级(?:失败|不上|不了|报错|出错|异常|中断|超时)|找不到[^\n。；]{0,3}固件|固件[^\n。；]{0,3}(?:找不到|没有|缺失)/;
function forceDomain(hits,key){
  const i=hits.findIndex(h=>h.key===key);
  if(i>0){const[it]=hits.splice(i,1);hits.unshift(it);}else if(i<0){hits.unshift({key,score:1});}
  return{domain:key,domainTags:[...new Set(hits.map(h=>h.key))]};
}
function classifyDomains(c){
  const tags=c.phenomenonTags||[];
  const blob=[c.title,c.customerWording,c.phenomenon,(c.phenomenonTerms||[]).join(" "),c.finalCause].filter(Boolean).join(" ");
  const hits=[];
  for(const r of DOMAIN_RULES){const th=tags.some(t=>r.tags.includes(t)),rh=r.regex.test(blob);if(th||rh)hits.push({key:r.key,score:(th?2:0)+(rh?1:0)});}
  const hard=HARD_BOOT_RE.test(blob);
  const hasDisplay=hits.some(h=>h.key==="display"); // 现象优先：已命中花屏/闪烁等显示现象的，显示域不被软词抢走
  const fwAction=FIRMWARE_ACTION_RE.test(blob);
  // ① 软件功能需求/优化建议（无设备硬现象）→ 咨询/需求，不作为售后故障
  if(!hard && FEATURE_REQ_RE.test(blob)) return{domain:"inquiry",domainTags:[]};
  // ② 明确升级/刷机/找固件（无硬现象、无显示现象）→ 固件升级，不被联网“找不到”抢
  if(!hard && !hasDisplay && fwAction) return forceDomain(hits,"firmware");
  // ③ 联网/掉线/搜不到（无设备硬现象、无显示现象、非固件动作）→ 连接联网
  if(!hard && !hasDisplay && !fwAction && NET_SOFT_RE.test(blob)) return forceDomain(hits,"network");
  // ④ 纯软件/APP/节目 闪退崩溃卡死卡顿（无设备硬现象、无显示现象、非固件动作）→ 节目操作
  if(!hard && !hasDisplay && !fwAction && SOFT_CRASH2_RE.test(blob) && SOFT_APP2_RE.test(blob)) return forceDomain(hits,"content");
  if(!hits.length){
    if(INQUIRY_NATURE.has(c.caseNature))return{domain:"inquiry",domainTags:[]};
    return{domain:"other",domainTags:[]};
  }
  const order=new Map(DOMAIN_RULES.map((r,i)=>[r.key,i]));
  hits.sort((a,b)=>(order.get(a.key)-order.get(b.key))||(b.score-a.score));
  return{domain:hits[0].key,domainTags:hits.map(h=>h.key)};
}
function classifyDisplaySub(c){
  const tags=c.phenomenonTags||[];
  const blob=[c.title,c.customerWording,c.phenomenon,(c.phenomenonTerms||[]).join(" ")].filter(Boolean).join(" ");
  let best=null,bs=0;
  for(const[name,rule]of DISPLAY_SUB_RULES){const s=(tags.some(t=>rule.tags.includes(t))?2:0)+(rule.regex.test(blob)?1:0);if(s>bs){bs=s;best=name;}}
  return best;
}

// ============ 遍历 sources 目录（自动识别新文件）============
const files=fs.readdirSync(SOURCE_DIR).filter(f=>/\.json$/i.test(f)).sort();
const collected=[];const fileStats=[];let droppedNoSource=0;
for(const name of files){
  const data=JSON.parse(fs.readFileSync(path.join(SOURCE_DIR,name),"utf8").replace(/^\uFEFF/,""));
  const cases=Array.isArray(data)?data:(Array.isArray(data.cases)?data.cases:Array.isArray(data.rows)?data.rows:[]);
  let kept=0;
  for(const c of cases){
    if(!hasSource(c)){droppedNoSource++;continue;}                 // 剔除无源经验
    const{domain,domainTags}=classifyDomains(c);
    if(domain==="display" && /模糊/.test([c.title,c.customerWording,c.phenomenon].filter(Boolean).join(" ")) && SOURCE_BLUR.test([c.title,c.customerWording,c.phenomenon].filter(Boolean).join(" ")))continue;
    const di=c.deviceInfo||{};const lines=new Set();
    [].concat(c.category||[]).forEach(x=>{const l=CATEGORY_LINE[x];if(l)lines.add(l);});
    const fl=lineFromModel([c.title,di.products&&di.products.join(" ")].filter(Boolean).join(" "));if(fl)lines.add(fl);
    kept++;
    collected.push({
      domain,domainTags,recordType:domain==="inquiry"?"inquiry":"case",
      subCategory:domain==="display"?(classifyDisplaySub(c)||"显示不全异常"):"",
      caseNature:normText(c.caseNature),
      productLines:[...lines],
      title:normText(c.title),customerWording:normText(c.customerWording),phenomenon:normText(c.phenomenon),
      products:di.products||[],chips:di.chips||[],pitches:di.pitches||[],scans:di.scans||[],
      softwareVersions:di.softwareVersions||[],firmwareVersions:di.firmwareVersions||[],
      troubleshooting:normText(c.troubleshooting),engineeringReasoning:normText(c.engineeringReasoning),
      finalCause:normText(c.finalCause),solution:normText(c.solution),applicability:normText(c.applicability),
      keywords:c.keywords||[],quality:gradeQuality(c),
      sourceFile:name,source:c.source||null,sourceExcerpt:normText(c.sourceExcerpt),
      originalId:c.id||"",_key:dedupKey(c),
    });
  }
  fileStats.push({name,total:cases.length,kept});
}

// 去重：同指纹保留质量最高、信息最全
const QR={A:4,B:3,C:2,D:1};const byKey=new Map();
for(const it of collected){
  it._rich=(it.finalCause?2:0)+(it.solution?2:0)+(it.troubleshooting?1:0)+(it.engineeringReasoning?1:0);
  const ex=byKey.get(it._key);
  if(!ex){byKey.set(it._key,it);continue;}
  if(QR[it.quality]*10+it._rich>QR[ex.quality]*10+ex._rich)byKey.set(it._key,it);
}
const ORDER=new Map(DOMAIN_RULES.map((r,i)=>[r.key,i]));ORDER.set("other",98);ORDER.set("inquiry",99);
let merged=[...byKey.values()].sort((a,b)=>{
  if(a.domain!==b.domain)return ORDER.get(a.domain)-ORDER.get(b.domain);
  if(a.subCategory!==b.subCategory)return a.subCategory.localeCompare(b.subCategory,"zh");
  if(a.quality!==b.quality)return QR[b.quality]-QR[a.quality];
  return a.title.localeCompare(b.title,"zh");
});
merged=merged.map((it,i)=>{const o={id:`AS-${String(i+1).padStart(4,"0")}`,...it};delete o._key;delete o._rich;return o;});

// 统计（售后经验 = 排除 inquiry）
const domainStats={},qualityStats={A:0,B:0,C:0,D:0},lineStats={},displaySubStats={},recordStats={case:0,inquiry:0};
for(const it of merged){
  domainStats[it.domain]=(domainStats[it.domain]||0)+1;qualityStats[it.quality]++;recordStats[it.recordType]++;
  it.productLines.forEach(l=>lineStats[l]=(lineStats[l]||0)+1);
  if(it.domain==="display"&&it.subCategory)displaySubStats[it.subCategory]=(displaySubStats[it.subCategory]||0)+1;
}
const aftersalesCount=merged.filter(m=>m.recordType==="case").length;

const result={
  schemaVersion:"2.1",generatedAt:new Date().toISOString(),
  framework:"售后经验5+1问题域（主轴=客户问题域，产品系列/型号/芯片为标签；配屏不单列，画面调试归display）；咨询/需求单列inquiry",
  updateHow:"把新案例原始JSON放入 data/aftersales/sources/ 后重跑 scripts/build-aftersales-cases.cjs",
  sourceDir:"data/aftersales/sources",activeDomains:ACTIVE_DOMAINS,
  domainDefs:DOMAIN_RULES.map(r=>({key:r.key,name:r.name})).concat([{key:"other",name:"硬件返修其他"},{key:"inquiry",name:"售前咨询/需求(非售后)"}]),
  count:merged.length,aftersalesCount,recordStats,droppedNoSource,
  domainStats,displaySubStats,productLineStats:lineStats,qualityStats,
  cases:merged,
};
fs.writeFileSync(OUT_JSON,JSON.stringify(result,null,2),"utf8");

// 报告
const L=[];
L.push("# 售后经验统一数据表 构建报告\n");
L.push(`生成时间：${result.generatedAt}`);
L.push(`源目录：${SOURCE_DIR}（${files.length}个文件）`);
L.push(`无源支撑剔除：${droppedNoSource} 条；去重后共 **${merged.length}** 条，其中售后经验 **${aftersalesCount}** 条、咨询/需求 ${recordStats.inquiry} 条\n`);
L.push("## 一、问题域分布\n");L.push("| 问题域 | key | 数量 | 启用 |");L.push("|---|---|---:|:--:|");
for(const d of result.domainDefs){const n=domainStats[d.key]||0;L.push(`| ${d.name} | ${d.key} | ${n} | ${ACTIVE_DOMAINS.includes(d.key)?"✅":""} |`);}
L.push("\n## 二、显示效果域内部7小类\n");L.push("| 小类 | 数量 |");L.push("|---|---:|");
Object.entries(displaySubStats).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>L.push(`| ${k} | ${v} |`));
L.push("\n## 三、产品线标签（可多挂）\n");L.push("| 产品线 | 数量 |");L.push("|---|---:|");
Object.entries(lineStats).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>L.push(`| ${k} | ${v} |`));
L.push("\n## 四、质量分级\n");L.push("| 等级 | 含义 | 数量 |");L.push("|---|---|---:|");
L.push(`| A | 有根因+方案 | ${qualityStats.A} |`);L.push(`| B | 有方案 | ${qualityStats.B} |`);L.push(`| C | 仅过程 | ${qualityStats.C} |`);L.push(`| D | 信息不全 | ${qualityStats.D} |`);
L.push("\n## 五、各源文件抽取\n");L.push("| 源文件 | 总 | 入库 |");L.push("|---|---:|---:|");
fileStats.forEach(s=>L.push(`| ${s.name} | ${s.total} | ${s.kept} |`));
fs.writeFileSync(OUT_MD,L.join("\n"),"utf8");

console.log("源文件:",files.length," 无源剔除:",droppedNoSource," 去重后:",merged.length,"(售后"+aftersalesCount+"/咨询"+recordStats.inquiry+")");
console.log("问题域:",JSON.stringify(domainStats));
console.log("显示小类:",JSON.stringify(displaySubStats));
console.log("质量:",JSON.stringify(qualityStats));
console.log("输出:",OUT_JSON);
