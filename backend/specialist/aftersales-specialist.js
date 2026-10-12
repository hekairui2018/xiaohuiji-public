/**
 * 小灰机 · 售后经验专精通道（多问题域）
 * --------------------------------------------------
 * 独立模块，不依赖 server.js 内部函数，风险隔离。
 * 框架：售后经验按 5+1 问题域组织，产品系列/型号/芯片仅作标签。
 * 当前只“启用” display(显示效果) 与 network(连接联网) 两个域，做精做透再放开；
 * 未启用域（黑屏死机/节目播放/固件等）与非售后咨询不在此回答，交由上层做边界引导。
 * 配屏不单列：智能设置/描点/走线/数据组等画面调试经验已并入 display，由助手在显示效果问题里指导。
 *
 * 职责：
 *   1. 判定提问属于哪个启用域（信息不足时结合最近历史，支持多轮继承）
 *   2. 识别现象小类、产品型号、芯片
 *   3. 信息不足时只反问一个最关键问题（混合模式）
 *   4. 仅在该域真实案例中检索评分（排除咨询类、排除其他域，防串味）
 *   5. 按“金字塔结构”组织：结论 → 最多3步排查 → 兜底 → 参考案例
 * 数据：data/aftersales/aftersales-cases.json（由 scripts/build-aftersales-cases.cjs 生成，只读）
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "..", "..", "data", "aftersales", "aftersales-cases.json");
const CHIP_INDEX_FILE = path.join(ROOT, "..", "..", "data", "chip-model-index.json");

// 纯数字别名 → 规范芯片名（如 6363 → FM6363）。白名单制：只认芯片索引里登记过的数字，避免误认型号/点间距。
let _chipAlias = null;
function loadChipAliases() {
  if (_chipAlias) return _chipAlias;
  const map = new Map();
  try {
    const idx = JSON.parse(fs.readFileSync(CHIP_INDEX_FILE, "utf8").replace(/^﻿/, ""));
    // 登记一个别名键 → 该键对应的规范芯片名集合
    const addAlias = (rawKey, models) => {
      const key = String(rawKey).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!key) return;
      if (!map.has(key)) map.set(key, new Set());
      models.forEach((m) => map.get(key).add(String(m).toUpperCase()));
    };
    for (const row of idx.rows || []) {
      const models = row.models || [];
      for (const alias of row.numericAliases || []) {
        addAlias(alias, models);
        // 兼容客户只打纯数字：9929S/9929N → 9929（≥4位数字才登记前缀，避免误认短数字）
        const digits = String(alias).replace(/[^0-9]/g, "");
        if (digits.length >= 4) addAlias(digits, models);
      }
    }
  } catch (e) { /* 芯片索引缺失时退化为不认纯数字 */ }
  _chipAlias = map;
  return map;
}

// “接收卡测试后现象仍在”时给客户的高频驱动芯片快捷项：只平铺全局最高频的若干个（默认 6，客户大多不知道厂家名，
// 不再让其先选厂家），其余芯片客户直接打字发丝印数字即可（extractChips 全认、售后续问链路会接住）。
// 数据驱动：从案例库 chips 统计，按“厂家前缀+数字”归并尾缀、只留能被芯片选型表归一的 ≥4 位数字，按覆盖案例数降序；
// 案例库追加文件后重新构建即自动更新，不硬编码。
let _rxChipTop = null;
function loadRxChipTop(limit = 6) {
  if (!_rxChipTop) {
    const alias = loadChipAliases();
    const baseCnt = new Map();   // 基础名(厂家前缀+数字，去掉尾缀) -> 出现案例数（同一案例内去重）
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8").replace(/^﻿/, ""));
      const arr = Array.isArray(data) ? data : (data.cases || data.items || []);
      for (const c of arr) {
        let chips = c && c.chips;
        if (chips == null) continue;
        if (Array.isArray(chips)) chips = chips.join(" ");
        const seen = new Set();
        String(chips).split(/[、,\/\s;；|]+/).forEach((tok) => {
          const m = String(tok).toUpperCase().match(/^([A-Z]+)(\d{4,5})/);  // 厂家前缀 + 数字主体（去尾缀字母）
          if (!m) return;
          if (!alias.has(m[2])) return;     // 只留选型表认得出的，保证点了/手打都能检索
          seen.add(`${m[1]}${m[2]}`);
        });
        for (const base of seen) baseCnt.set(base, (baseCnt.get(base) || 0) + 1);
      }
    } catch (e) { /* 案例库缺失时退化为空，客户仍可手打芯片丝印 */ }
    _rxChipTop = [...baseCnt.entries()]
      .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
      .map(([label, n]) => ({ label, n }));
  }
  return _rxChipTop.slice(0, limit);
}

// ============ 1. 启用域与现象识别 ============
// —— 显示效果域 7 小类现象词表（客户口语同义词库）——
// 维护方式：客户冒出新说法，只需往对应小类的 phrases（多字词）或 chars（独立单字）里加一个词；
// 正则由 buildPhenRegex 统一生成。chars 单字自动加“前后不是中文/字母”的边界，避免误命中（如独立“闪”不影响“闪烁”）。
// 边界约定：局部不亮/缺块/一行不亮等“显示效果”问题收在“显示不全异常”；整屏黑屏/不开机/死机属 power_boot 域（已启用，detectDomain 中 power_boot 排在 display 之前，整屏黑屏优先命中）。
const DISPLAY_PHENOMENA = [
  {
    key: "波纹摩尔纹",
    phrases: ["摩尔纹", "莫尔条纹", "水波纹", "波纹", "干涉纹", "网纹", "扫描线", "扫描纹", "拍照有纹", "拍摄有纹", "摄像机拍", "细纹滚动"],
  },
  {
    key: "闪烁抖动", // 画面随时间不稳定：闪 / 抖 / 跳
    phrases: ["闪屏", "闪烁", "一闪一闪", "一闪一", "闪点", "闪白点", "闪色", "闪一下", "一直闪", "老闪", "老是闪", "总闪", "闪个不停",
      "屏幕闪", "画面闪", "闪了", "频繁闪", "频闪", "忽明忽暗", "忽亮忽灭", "时亮时灭", "亮一下就灭",
      "抖屏", "抖动", "跳动", "跳屏", "跳变", "一直跳", "乱跳", "老跳", "跳来跳去", "晃动", "眨眼", "一眨一眨", "抽搐"],
    chars: ["闪", "抖"],
  },
  {
    key: "花屏乱码", // 画面整体错乱/破碎/错位重叠/发糊
    phrases: ["花屏", "屏幕花", "画面花", "屏花", "花了", "花花的", "乱码", "画面乱", "画面错乱", "画面断裂", "画面破碎", "画面断层",
      "马赛克", "雪花", "杂点", "噪点", "碎屏", "灰屏", "格子", "方块块", "油画", "油画感", "像油画", "花纹", "画面失真", "失真",
      "错位", "移位", "画面移位", "行错位", "行顺序乱", "标序错误", "序号不对", "拼接错乱", "扫描错位", "重叠", "画面重叠", "断层",
      "不连贯", "没连起来", "没连接起来", "顺序异常", "点描顺序", "走点",
      "坐标错乱", "坐标跳动", "画面不固定", "画面跑偏", "画面歪", "镜像", "颠倒", "左右反", "画面反过来",
      "模糊", "发虚", "不清晰", "清晰度低", "看不清楚", "画面糊", "糊了", "发糊"],
    chars: ["花", "糊", "乱"],
  },
  {
    key: "偏色缺色", // 颜色倾向不对 / 缺某基色 / 明暗异常
    phrases: ["偏色", "偏青", "偏紫", "偏白", "偏红", "偏绿", "偏蓝", "偏黄", "偏暗", "偏黑", "偏灰", "色差", "色偏",
      "颜色异常", "颜色不对", "颜色不一致", "颜色不均", "变色", "颜色变了", "白平衡", "色温",
      "发红", "泛红", "发绿", "泛绿", "发蓝", "泛黄", "发黄", "发黑", "泛黑", "发白", "泛白", "发灰", "灰蒙蒙",
      "色块", "彩块", "花块", "缺色", "少色", "丢色", "颜色少", "少了一色", "缺红", "缺绿", "缺蓝", "纯色",
      "只显示单色", "只显示蓝色", "只显示红色", "只显示绿色", "只显示黄色", "只显示黑白", "只显示黑白色", "其他颜色不显示", "颜色不显示",
      "色带", "颜色缺陷", "红色缺陷",
      "底色", "底色不均", "去底色", "绿底", "红底", "蓝底", "暗道", "黑色发灰", "黑色显示灰",
      "很暗", "太暗", "发暗", "暗淡", "亮度低", "亮度不够", "亮度差异", "亮度不一致", "亮度上不去", "亮度有点低",
      "忽暗忽亮", "一会暗一会亮", "明暗不均", "整体偏暗", "屏幕偏暗"],
  },
  {
    key: "横竖线条", // 固定方向的线 / 条带
    phrases: ["横线", "竖线", "横条", "竖条", "横纹", "竖纹", "亮线", "暗线", "亮暗线", "斜扫", "隔行", "错行", "一条线", "行线", "列线",
      "绿线", "青线", "红线", "蓝线", "白线", "绿色竖线", "绿色横线", "线条", "条纹", "条带", "竖带", "横带",
      "拉丝", "一道亮", "一道暗", "亮带", "暗带"],
  },
  {
    key: "鬼影拖影", // 上一帧残留 / 拖尾
    phrases: ["鬼影", "拖影", "拖尾", "重影", "残影", "虚影", "阴影", "暗影", "烧屏", "图像残留", "文字残留", "历史文字",
      "余辉", "余晖", "余像", "滞留", "上一帧", "灯珠老化"],
  },
  {
    key: "显示不全异常", // 局部缺失/不亮/坏点；整屏黑屏/不开机/死机由 power_boot 域优先承接，此处只管局部缺失
    phrases: ["显示不全", "显示不完整", "画面缺失", "缺行", "缺列", "缺一块", "缺了一块", "少一块", "少了一块", "局部不显示", "局部不亮", "一块不亮", "一块黑",
      "黑块", "暗块", "坏块", "黑斑", "暗区", "区域不亮", "半边不亮", "半屏不亮", "显示一半", "一半不亮", "半边",
      "某路不亮", "一路不亮", "某路不显示", "一路不显示", "某组不亮", "半边无数据", "不出数据", "没数据输出", "网口不出画面", "接口不出画面",
      "缺划", "断划", "缺笔", "断笔", "缺字", "字缺",
      "死灯", "灯珠不亮", "灯不亮", "坏点", "坏灯", "黑点", "红点", "彩点", "异色点", "亮点", "亮点常亮", "单点常亮", "暗点", "毛毛虫", "连串亮", "一串亮", "一行不亮", "一行灯珠不亮",
      // 整屏黑屏/不亮/不开机/白屏/只有背光 归 power_boot 域（见下方 POWER_BOOT_REGEX），此处只保留局部缺失类
      "低灰", "灰度0", "低灰微亮", "低灰常亮", "低灰发亮", "灰度0还亮", "灯珠还亮", "光斑"],
  },
];
// 域级泛词：只用于判断“是不是显示问题”，过于宽泛、不参与具体子类归类（否则会让“显示不全”乱入到各类案例）
const DISPLAY_DOMAIN_HINTS = ["显示异常", "画面异常", "屏幕异常", "显示效果", "显示问题", "画面问题", "显示不正常",
  // 屏幕已能正常点亮、但要做画质调优的说法（无具体现象大类，交硬件高频兜底承接）
  "参数优化", "效果优化", "画质优化", "画面优化", "画质", "调效果", "效果不好", "效果不佳", "显示效果不佳", "低灰不均", "不均匀"];
const PHEN_ESCAPE = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function buildPhenRegex(def) {
  const alts = (def.phrases || []).map(PHEN_ESCAPE);
  for (const ch of def.chars || []) alts.push(`(?<![一-龥A-Za-z])${PHEN_ESCAPE(ch)}(?![一-龥A-Za-z])`);
  return new RegExp(alts.join("|"));
}
const DISPLAY_SUB_DEFS = DISPLAY_PHENOMENA.map((d) => [d.key, buildPhenRegex(d)]);
const DISPLAY_REGEX = new RegExp(
  [...DISPLAY_SUB_DEFS.map((d) => d[1].source), ...DISPLAY_DOMAIN_HINTS.map(PHEN_ESCAPE)].join("|"));

// —— 连接联网域 ——
const NETWORK_REGEX =
  /连不上|连接不上|搜不到|搜索不到|找不到|识别不到|识别不了|发现不了|找卡|找不|探测不到|探测|离线|掉线|联网|网络|局域网|网段|IP地址|改IP|上不了线|不在线|云平台|小灰云|云端|通讯失败|通讯|连接超时|连接失败|wifi|wi-fi|4g|5g|mac地址|投屏|网线直连|直连不上|直连失败|无法连接|连接设备|扫描不到|扫描设备|扫描找卡/;
// 注意：裸“直连”（异步直连控制卡/板载HUB直连）与裸“扫描”（16扫/扫描方式）是配单架构/规格词，
// 不得作为联网故障信号；仅“网线直连/直连失败”“扫描不到设备”这类真故障搭配才命中本域。
// 连接域内部子类（用于让“同故障”优先于“同型号”）
const NETWORK_SUB_DEFS = [
  ["云端在线", /云平台|云端|小灰云|上云|注册到云|云离线|连不上云|不在线|在线状态/],
  ["设备搜索", /搜不到|搜索不到|找不到设备|识别不到|识别不了|发现不了|找卡|探测不到|扫描不到|搜不出|搜索设备/],
  ["离线掉线", /离线|掉线|断开连接|频繁断|连不上|连接不上|连接失败|连接超时|无法连接|连接设备/],
  ["网络配置", /IP|网段|局域网|ping|网关|子网|DHCP|通讯失败|通讯/],
  ["无线联网", /wifi|wi-fi|4g|5g|手机卡|流量卡|信号/],
];

// —— 黑屏/开机/死机域：整屏不亮、上电、死机/闪退/重启（局部缺块/一行不亮仍属 display）——
const POWER_BOOT_REGEX = /黑屏|黑了|整屏不亮|全黑|完全不亮|不亮|点不亮|不开机|开不了机|无法开机|启动不了|无法启动|上电|通电|不通电|上电没反应|没反应|死机|卡死|卡住|卡顿|闪退|崩溃|反复重启|不断重启|自动重启|重启循环|一直重启|不定时重启|每隔.{0,4}重启|重启|来电自启|自启动?|卡在启动|卡logo|卡开机|开不了机|白屏|只有背光|背光亮没画面|背光亮无显示|没显示|无显示|没画面|无画面|烧了|烧保险|跳闸|断电|掉电|关机|变砖|刷成砖|无法点亮|点亮不了|进不了系统|进不去系统/i;
// —— 节目内容/软件操作域：节目编辑发布、素材字幕、画布分区、音频、播放、拼接级联、U盘/软件操作等 ——
const CONTENT_REGEX = /节目|素材|字幕|字体|画布|分区|开窗|窗口|图层|画中画|音频|声音|没声音|无声音|无声|音量|视频(播放|区域|添加|显示|资源|文件|倒放|发不出)|播放|动画|特效|密钥|发送(节目|失败)|发布(节目|失败)|上传(节目|失败)|下载失败|导入|导出|U盘|优盘|USB|SD卡|扩容|屏参|拼接|级联|多屏|分屏|定时|播放列表|编辑|排版|远程发布|节目更新|播放器|退回桌面|退出到桌面|信发|网页|HTML|安卓|APK|安装.{0,2}(软件|APK|app)|命令失败|设备名称|文件夹|HDPlayer|屏掌控|手机 ?APP|app里|软件(里|打开|运行|安装|异常|识别)/i;
// —— 固件域：只认升级/刷机/烧录/掉固件等动作或异常（裸“XX固件/固件尾缀”是售前查询，不在此命中）——
const FIRMWARE_REGEX = /升级|刷机|刷固件|烧录|烧写|烧程序|刷程序|固件异常|MCU|固件损坏|固件丢失|固件掉|掉固件|掉备份|备份版本|回读固件|固件回读|固件回滚|回滚|降级|固件版本(不对|异常|变|掉)|版本号一直|变砖|固件选哪个|固件选错/i;

// 启用域配置：名称、识别、无型号/无证据时的通用排查、兜底、反问话术
const DOMAIN_CONF = {
  display: {
    name: "显示效果",
    detect: (t) => DISPLAY_REGEX.test(t),
    askPhenomenon: "方便描述一下具体的显示现象吗？比如是花屏、闪烁、偏色、出现横竖线，还是鬼影拖影？",
    noModelSteps: [
      "重新插拔或更换信号线/排线，排除接触不良（做完看画面是否恢复）",
      "核对输出分辨率、刷新率是否在设备支持范围内，必要时降一档刷新率测试",
    ],
    noEvidenceSteps: [
      "检查并重新插拔信号线、排线，排除接触不良（做完看画面是否恢复）",
      "核对输出分辨率/刷新率是否在设备支持范围内（超出会导致花屏闪烁）",
      "用HDSet/HDPlayer重新加载一次配置并发送",
    ],
    genericCause: "通常由信号、参数配置、排线/硬件或固件几个方向引起，按下面顺序排查，成功率从高到低。",
    fallback: "如果以上步骤做完仍未恢复，请拍一段屏幕异常的短视频，连同设备背面的型号/SN发我，我帮你判断是参数、固件还是硬件问题，少走弯路。",
  },
  network: {
    name: "连接联网",
    detect: (t) => NETWORK_REGEX.test(t),
    askPhenomenon: "方便说下具体是哪种情况吗？软件搜不到设备、设备显示离线、连不上云平台，还是 WiFi/4G 联网失败？",
    noModelSteps: [
      "检查网线是否插紧，换一根网线或换一个网口，排除线路/网口故障（换完重新搜索设备）",
      "确认电脑和设备在同一网段（如设备是192.168.1.x，电脑也要设同网段），临时关闭电脑防火墙/杀毒软件后再搜索",
    ],
    noEvidenceSteps: [
      "确认设备已正常上电，看 RUN 运行灯是否在规律闪烁",
      "把电脑 IP 设为与设备同一网段，用 HDSet 重新搜索设备",
      "用网线把电脑和设备直连，绕过交换机/路由器，判断是否中间网络设备问题",
    ],
    genericCause: "通常从网线/网口、电脑与设备网段、防火墙拦截、设备网络状态几个方向排查，按下面顺序处理。",
    fallback: "如果仍然连不上，请把软件搜索界面的截图、电脑 IP 地址和设备背面型号发我，我帮你判断是网段、网线还是设备网口的问题。",
  },
  power_boot: {
    name: "黑屏开机",
    phenLabel: "黑屏/开机异常",
    detect: (t) => POWER_BOOT_REGEX.test(t),
    askPhenomenon: "方便说下具体是哪种情况吗？整屏黑屏/白屏、通电点不亮、开机卡住，还是用着突然死机重启？",
    noModelSteps: [
      "确认电源供电正常、电源指示灯是否亮，换一个电源或电源线排除供电问题（做完看能否点亮）",
      "断电静置10秒后重新上电，排除临时死机；仍不亮就拔掉接收卡/排线，只留一张卡测试（做完看是否恢复）",
    ],
    noEvidenceSteps: [
      "确认设备已正常上电，看 RUN 运行灯状态",
      "重新烧录/恢复对应固件，排除固件损坏导致的不开机",
    ],
    genericCause: "通常从供电、固件、启动卡死几个方向排查，按下面顺序处理。",
    fallback: "如果仍点不亮或反复死机，请拍一段上电过程的视频，连同设备背面型号/SN发我，我帮你判断是电源、固件还是硬件问题。",
  },
  content: {
    name: "节目操作",
    phenLabel: "节目与操作",
    detect: (t) => CONTENT_REGEX.test(t),
    askPhenomenon: "方便说下具体卡在哪一步吗？节目编辑/发送发布、素材字幕、画布分区、音频，还是拼接级联显示？",
    noModelSteps: [
      "保存节目后重新发送一次，确认软件右下角提示发送成功（做完看屏上是否更新）",
      "核对节目分辨率/画布与设备带载是否匹配，删除多余窗口/区域后重发（做完看是否正常）",
    ],
    noEvidenceSteps: [
      "确认软件版本与设备固件匹配，必要时更新到同一版本",
      "新建一个最简节目（单个文本区）测试，定位是不是某个素材/区域导致",
    ],
    genericCause: "通常从节目设置、画布/分区、素材与软件版本几个方向排查。",
    fallback: "如果仍无法解决，请把软件操作界面截图、节目设置和设备型号发我，我帮你定位是哪一步的问题。",
  },
  firmware: {
    name: "固件升级",
    phenLabel: "固件升级",
    detect: (t) => FIRMWARE_REGEX.test(t),
    askPhenomenon: "方便说下具体情况吗？升级失败、找不到固件、升级后异常，还是不确定该选哪个固件？",
    noModelSteps: [
      "确认固件型号与设备完全对应，升级过程中不要断电（重新选对固件再升一次）",
      "换一根优质USB线/网线、关掉杀毒软件后重新升级（做完看是否升级成功）",
    ],
    noEvidenceSteps: [
      "核对设备背面完整型号，按型号选对应固件",
      "升级失败变砖时按对应型号的强制烧录步骤恢复",
    ],
    genericCause: "通常从固件型号是否对应、升级链路、升级过程是否中断几个方向排查。",
    fallback: "如果仍升级不了，请把设备背面型号、当前固件版本和升级报错截图发我，我帮你选对固件并给出恢复步骤。",
  },
};
// 启用顺序：整机黑屏/开机优先（整屏黑屏先于显示子类），再显示效果、联网、节目操作、固件升级
const ACTIVE_DOMAIN_KEYS = ["power_boot", "display", "network", "content", "firmware"];
// 各域无子类时的现象统称（硬件高频兜底、金字塔措辞统一取这里，不再写死“显示异常”）
const DOMAIN_PHEN_LABEL = {
  display: "显示异常", network: "连接联网", power_boot: "黑屏/开机异常",
  content: "节目与操作", firmware: "固件升级",
};

function detectDisplaySubs(text) {
  const hits = [];
  for (const [name, re] of DISPLAY_SUB_DEFS) if (re.test(String(text || ""))) hits.push(name);
  return hits;
}
function detectNetworkSubs(text) {
  const hits = [];
  for (const [name, re] of NETWORK_SUB_DEFS) if (re.test(String(text || ""))) hits.push(name);
  return hits;
}
function detectSubs(domain, text) {
  if (domain === "network") return detectNetworkSubs(text);
  if (domain === "display") return detectDisplaySubs(text);
  return []; // power_boot / content / firmware 不再细分子类
}
// 与 scripts/build-aftersales-cases 入库定域同口径（客户实时提问侧）：
// 设备硬现象守卫；联网/纯软件软词在“无硬现象、无显示现象”时分别归 network/content，不被 power_boot 抢先
const HARD_BOOT_RE = /黑屏|整屏不亮|全黑|完全不亮|点不亮|黑了|不开机|无法开机|开不了机|上电没反应|上电不|无法启动|启动不了|无法正常启动|卡logo|卡LOGO|卡在logo|卡在启动|卡开机|死机|自动重启|反复重启|重启循环|一直重启|变砖|刷成砖|烧保险|跳闸|无法点亮|点亮不了|进不了系统|进不去系统|RUN灯|运行灯|指示灯不亮|只有背光|背光亮没?画面|白屏/;
const NET_SOFT_RE = /掉线|离线|连不上|搜不到|找不到|无法找到|发现不了|发现不到|识别不到|识别不了|无法识别|探测不到|无法发现|找卡|联网|wifi|wi-fi|4g|5g|丢失?IP|丢IP|模块未接入|模块(?:检测不到|识别不到|未接入|无法识别)|软件[^\n。；]{0,8}(?:掉线|找不到|搜不到|识别|发现|连接)|投屏[^\n。；]{0,4}掉线|IP地址|网段|网线|云平台[^\n。；]{0,4}(?:离线|不在线|连不上)/i;
const SOFT_CRASH2_RE = /闪退|崩溃|卡死|卡住|卡顿|无响应|未响应|打不开|无法打开|不能打开|停止运行|已停止|用不了|卡死退出|自动退出|强退|一直加载|加载不出/;
const SOFT_APP2_RE = /软件|APP|App|APK|HDSet|HDPlayer|屏掌控|LCDPlayer|HDSign|magic\s?player|MagicPlayer|boxplayer|eshare|teamviewer|应用|安卓|手机|节目|文本|边框|素材|视频|图片|网页|HTML|U盘|优盘|播放|投屏|数据/;
const FIRMWARE_ACTION_RE = /刷机|刷固件|烧录|烧写|烧程序|刷程序|变砖|固件(?:异常|损坏|丢失|掉程序|选错|选哪个|找不到|在哪|哪里下载|下载|版本不对|版本异常|回读|升级失败|升级不上|刷不上|烧不上|无法升级|升级不了)|升级(?:失败|不上|不了|报错|出错|异常|中断|超时)|找不到[^\n。；]{0,3}固件|固件[^\n。；]{0,3}(?:找不到|没有|缺失)/;
function detectDomain(text) {
  const t = String(text || "");
  const hard = HARD_BOOT_RE.test(t);
  const displayHit = DISPLAY_REGEX.test(t); // 现象优先：已命中花屏/闪烁等显示现象的不被软词抢走
  const fwAction = FIRMWARE_ACTION_RE.test(t);
  // 明确升级/刷机/找固件（无硬现象、无显示现象）→ 固件升级，不被联网“找不到”抢
  if (!hard && !displayHit && fwAction) return "firmware";
  // 联网/掉线/搜不到（无设备硬现象、无显示现象、非固件动作）→ 连接联网
  if (!hard && !displayHit && !fwAction && NET_SOFT_RE.test(t)) return "network";
  // 纯软件/APP/节目 闪退崩溃卡死卡顿（无硬现象、无显示现象、非固件动作）→ 节目操作
  if (!hard && !displayHit && !fwAction && SOFT_CRASH2_RE.test(t) && SOFT_APP2_RE.test(t)) return "content";
  for (const key of ACTIVE_DOMAIN_KEYS) if (DOMAIN_CONF[key].detect(t)) return key;
  return null;
}
// 兼容旧导出名
function detectCategories(text) { return detectDisplaySubs(text); }
function isDisplayFault(text) { return DISPLAY_REGEX.test(String(text || "")); }

// ============ 2. 产品型号 / 芯片识别 ============
const PRODUCT_REGEX =
  /\b(?:HD[-\s]?)?(VPX\d{2,3}[A-Z]?|VP\d{3,4}[A-Z]?|KVX\d{2,3}[A-Z]?|KV\d{3,4}[A-Z]?|VX\d{3,4}[A-Z]?|V\d{3,4}[A-Z]?|H4K|H\d{1,2}\b|X\d{1,3}[A-Z]?|T\d{1,4}[A-Z]?|A\d{1,4}L?|C8\d{3}[A-Z]{0,2}|C\d{1,2}[A-Z]?|D\d{1,2}[A-Z]?|B\d{1,2}L?|W\d{1,3}[A-Z]?|R\d{1,4}[A-Z]?|K\d{2}[A-Z]?|E\d{2,3}|WF\d{1,2}|M\d{2,3}|U\d{2,3}|S\d{1,2}[A-Z]?|PM\d{2,3}[A-Z]?|CT\d{3,4}|40S|64A|VP10|MS\d{3,4}[A-Za-z-]*|(?:3288|3399|3566|3568|3576|3588|972|133)\d?[A-Z]{0,2}|\d{3,4}[A-Z]{1,2})\b/gi;
const CHIP_REGEX =
  /\b(?:SM|HX|ICND?|DP|FM|LS|CNS|MBI|MB|TC|RUC|RUL|LYD|GC|MY|TL|RT)\d{2,5}[A-Z]{0,3}\b/gi;
const PITCH_REGEX = /\bP\d(?:\.\d{1,2})?\b/gi;
const SCAN_REGEX = /\b\d{1,3}\s*S\b/gi;            // 扫描方式 10S / 32S / 64S
const VERSION_REGEX = /\bV?\d{1,2}[._]\d{1,3}(?:[._]\d{1,4})+\b/gi; // 软件/固件版本
const NUM_TOKEN_REGEX = /\b\d{3,5}[A-Z]{0,2}\b/gi;  // 独立数字/数字+尾缀(大小写不敏感,如16386s)，用于查芯片数字别名白名单

function canonical(v) { return String(v || "").toUpperCase().replace(/^HD[-\s]?/, "").replace(/[^A-Z0-9]/g, ""); }
function extractProducts(text) {
  const out = new Set();let m;PRODUCT_REGEX.lastIndex = 0;
  while ((m = PRODUCT_REGEX.exec(String(text || "")))) out.add(m[1].toUpperCase());
  return [...out];
}
// 芯片：①带字母前缀的标准芯片名；②纯数字（如6363）按芯片索引白名单补全为规范名（FM6363）
function extractChips(text) {
  const s = String(text || "");
  const out = new Set();let m;
  CHIP_REGEX.lastIndex = 0;
  while ((m = CHIP_REGEX.exec(s))) out.add(m[0].toUpperCase());
  const alias = loadChipAliases();
  NUM_TOKEN_REGEX.lastIndex = 0;
  while ((m = NUM_TOKEN_REGEX.exec(s))) {
    const key = m[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (alias.has(key)) alias.get(key).forEach((full) => out.add(full));
  }
  return [...out];
}
function extractPitches(text) {
  const out = new Set();let m;PITCH_REGEX.lastIndex = 0;
  while ((m = PITCH_REGEX.exec(String(text || "")))) out.add(m[0].toUpperCase().replace(/\s+/g, ""));
  return [...out];
}
function extractScans(text) {
  const out = new Set();let m;SCAN_REGEX.lastIndex = 0;
  while ((m = SCAN_REGEX.exec(String(text || "")))) out.add(m[0].toUpperCase().replace(/\s+/g, ""));
  return [...out];
}
function extractVersions(text) {
  const out = new Set();let m;VERSION_REGEX.lastIndex = 0;
  while ((m = VERSION_REGEX.exec(String(text || "")))) out.add(m[0].toUpperCase());
  return [...out];
}

// 用户原文里实际打出的硬件称呼（不做数字白名单补全），用于硬件高频兜底的标题/回显，
// 避免“16380”被补全数组的第一个具体后缀（如 SM16380SC）当成标签
function rawHardwareLabel(text) {
  const s = String(text || "");
  let m;
  CHIP_REGEX.lastIndex = 0;
  if ((m = CHIP_REGEX.exec(s))) return m[0].toUpperCase();
  PRODUCT_REGEX.lastIndex = 0;
  if ((m = PRODUCT_REGEX.exec(s))) return m[1].toUpperCase();
  NUM_TOKEN_REGEX.lastIndex = 0;
  if ((m = NUM_TOKEN_REGEX.exec(s))) return m[0].toUpperCase();
  return "";
}

// 拆分历史构建数据里两个型号连写的粘连：前段发送端 + 后段接收卡（VP2060K12→VP2060+K12、C16LR716→C16L+R716、T901R501→T901+R501）
function splitStickyProducts(products) {
  const out = [];
  for (const p of products || []) {
    const x = canonical(p);
    const m = /^(.+?)(R[57]\d{2}[A-Z]?|R5S|K12)$/.exec(x);
    if (m && m[1].length >= 2 && /\d/.test(m[1])) out.push(m[1], m[2]);
    else out.push(x);
  }
  return [...new Set(out)];
}

// ============ 3. 案例库加载（带缓存，按mtime自动重载）============
let _cache = null, _cacheMtime = 0;
function loadSpecialist() {
  const stat = fs.statSync(DATA_FILE);
  if (_cache && _cacheMtime === stat.mtimeMs) return _cache;
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8").replace(/^\uFEFF/, ""));
  // 加载即归一化：拆开型号粘连，下游打分/归类/表格统一拿到干净型号
  if (Array.isArray(raw.cases)) raw.cases.forEach((c) => { if (Array.isArray(c.products)) c.products = splitStickyProducts(c.products); });
  _cache = raw;_cacheMtime = stat.mtimeMs;
  return _cache;
}

// 6级标签权重：L1现象40(近邻现象16) > L2硬件身份首个命中30形成“锁定”、之后每个10 > L3工况4 > L4版本3 > L5关键词1；质量仅作同分微调
const W_L1_SUB = 40, W_L1_NEAR = 16, W_L2_HW_FIRST = 30, W_L2_HW_MORE = 10, W_L2_PAIR = 12, W_L2_SERIES = 14, W_L3_WORK = 4, W_L4_VER = 3, W_L5_KW = 1;
const QUALITY_BASE = { A: 8, B: 5, C: 2, D: 0 };
const QUALITY_WEIGHT = QUALITY_BASE; // 兼容旧引用
// 显示域现象近邻：客户说A、案例标B（相近画面异常）时给半分，避免近邻现象被当不相关
const SUB_NEIGHBORS = {
  "闪烁抖动": ["花屏乱码", "鬼影拖影", "波纹摩尔纹"],
  "花屏乱码": ["闪烁抖动", "显示不全异常", "偏色缺色", "鬼影拖影", "横竖线条"],
  "偏色缺色": ["花屏乱码", "显示不全异常"],
  "鬼影拖影": ["闪烁抖动", "花屏乱码"],
  "横竖线条": ["花屏乱码", "显示不全异常"],
  "波纹摩尔纹": ["闪烁抖动"],
  // 坏点/亮点/黑屏(显示不全)与低灰微闪、红点偏色在物理上相邻，给半分但低于严格同类，便于“点名芯片+坏点”命中同芯片的低灰亮点案例
  "显示不全异常": ["花屏乱码", "横竖线条", "闪烁抖动", "偏色缺色"],
};

// 译码芯片谱（其余芯片视为驱动IC）；可维护
const DECODE_CHIP_RE = /^(?:138|59\d{2}|51\d{2}|52\d{2}|72\d{2}|20\d{2}|CFD\d+[A-Z]*|SUM\d+)/i;
function isDecoderChip(ch) { return DECODE_CHIP_RE.test(canonical(ch)); }
// 设备端判定（productRole 与 familyOf 共用，避免两处规则漂移；归类以产品库登记的系列为准）
// 接收端：R7 系列 + 老款 R5 接收卡(R5S/R507/R512/R516) + K12 接收卡
const RE_RECEIVER = /^(?:R[57]\d|R5S|K12)/;
// 同步发送端：VP/VPX/KV/KVX/VX 视频处理器、H4K 播放盒、MS 多媒体服务器、CT 中央控制器
const RE_PROCESSOR = /^(?:VPX?|KVX?|VX)\d|^H4K|^MS\d|^CT800/;
// 异步发送/控制端：A/B/C/D/T/W/H/X 异步卡 + E 网口卡 + WF Wi-Fi 卡 + U U盘卡
const RE_ASYNC_SENDER = /^[ABCDTWHX]\d|^E\d|^WF\d|^U\d/;
// 产品角色粗分
function productRole(p) {
  const x = canonical(p);
  if (RE_RECEIVER.test(x)) return "receiver";                 // 接收端
  if (RE_PROCESSOR.test(x)) return "processor";               // 同步处理器/服务器/控制器
  if (/^HD(SET|PLAYER|SHOW)/.test(x)) return "software";      // 软件
  if (RE_ASYNC_SENDER.test(x)) return "sender";              // 异步/发送主控
  return "other";                                            // 产品库未登记的安卓方案板/残片，不臆归类
}
// 芯片的可匹配形式：规范名 + 纯数字尾（FM6363→6363），兼容案例只写数字的情况
function chipForms(ch) {
  const canon = canonical(ch);
  const digits = canon.replace(/[A-Z]/g, "");
  return digits && digits.length >= 3 ? [canon, digits] : [canon];
}
// 发送端视频处理器“十位系列”档：取型号数字末两位的十位，VP210/VP410→10系，VP620/VP820/VP1220→20系；非 VP/KV/VX 返回 null
function vpSeriesBand(model) {
  const x = canonical(model);
  if (!/^(VP|KV|VX)/.test(x)) return null;
  const m = /(\d{2,})/.exec(x);
  if (!m) return null;
  return Math.floor(Number(m[1].slice(-2)) / 10) * 10;
}
// 案例是否含“与查询产品同十位系列、但不同具体型号”的发送端（结构化字段或正文提及都算）
function sameSenderSeries(p, cProducts, headBlob) {
  const band = vpSeriesBand(p);
  if (band == null) return false;
  const pCanon = canonical(p);
  if (cProducts.some((cp) => { const b = vpSeriesBand(cp); return b != null && b === band && canonical(cp) !== pCanon; })) return true;
  const re = /(?:VP|KV|VX)\s*0*(\d{2,4})[A-Z]{0,3}/g;
  let m;
  while ((m = re.exec(headBlob || ""))) {
    if (Math.floor(Number(m[1].slice(-2)) / 10) * 10 === band) return true;
  }
  return false;
}

// 设备族（=来源文档线）第一路由：接收卡/显示效果rx、视频处理器(同步)vp、异步盒/卡async；纯芯片返回null(同步异步都关联)
function familyOf(products) {
  for (const p of products) {
    const x = canonical(p);
    if (RE_RECEIVER.test(x)) return "rx";
    if (RE_PROCESSOR.test(x)) return "vp";
    if (RE_ASYNC_SENDER.test(x)) return "async";
  }
  return null;
}

// 一次性提取查询的全部标签（避免逐条案例重复正则）
function extractQueryTags(query, domain, familyOverride = null) {
  const products = extractProducts(query).map(canonical);
  const chips = extractChips(query).map(canonical);
  return {
    subs: detectSubs(domain, query),
    products,
    chips,
    family: familyOverride || familyOf(products),
    pitches: extractPitches(query).map(canonical),
    scans: extractScans(query).map(canonical),
    versions: extractVersions(query).map(canonical),
    tokens: String(query || "").toUpperCase().split(/[\s,，。、；;:：？?！!的了吗呢啊和与及]+/).filter((s) => s.length >= 2),
  };
}

// 案例与查询的6级标签相关性评分（domain 已在外层过滤；q 为预提取标签）
function scoreCase(c, domain, q) {
  const headBlob = [c.title, c.customerWording, c.phenomenon].filter(Boolean).join(" ").toUpperCase();
  const blob = [headBlob, c.finalCause, c.solution,
    (c.products || []).join(" "), (c.chips || []).join(" "),
    (c.pitches || []).join(" "), (c.scans || []).join(" "),
    (c.softwareVersions || []).join(" "), (c.firmwareVersions || []).join(" "),
    (c.keywords || []).join(" ")].filter(Boolean).join(" ").toUpperCase();

  let score = QUALITY_BASE[c.quality] || 0;

  // L0 设备族（来源文档线）第一权重：查询能定族时，同族案例+25显著靠前，异族-8保留但靠后；纯芯片无族则不限（同步/异步都关联）
  const cLines = c.productLines || [];
  if (q.family) {
    if (cLines.includes(q.family)) score += 25;
    else if (cLines.length) score -= 8;
  }

  // L1 现象小类：同故障+40（最大），近邻现象+16（避免相近画面异常被当不相关）
  let cSubs = [];
  if (domain === "display") cSubs = c.subCategory ? [c.subCategory] : [];
  else if (domain === "network") cSubs = detectNetworkSubs([c.title, c.phenomenon, c.finalCause, c.solution].filter(Boolean).join(" "));
  // power_boot / content / firmware 无子类，cSubs 留空、L1 不参与加分
  if (q.subs.length) {
    if (cSubs.some((s) => q.subs.includes(s))) score += W_L1_SUB;
    else if (cSubs.some((s) => q.subs.some((qs) => (SUB_NEIGHBORS[qs] || []).includes(s)))) score += W_L1_NEAR;
  }

  // L2 硬件身份（型号/芯片同级）：首个完整命中+30形成“锁定”，之后每个+10；仅文本弱命中+5；发送端同十位系列+14（介于完整型号与弱命中之间）
  let fullHw = 0, weakHw = 0, seriesHw = 0;
  const cProducts = (c.products || []).map(canonical);
  for (const p of q.products) {
    if (cProducts.some((cp) => cp === p || cp.includes(p) || p.includes(cp))) fullHw++;
    else if (headBlob.includes(p)) weakHw++;
    else if (sameSenderSeries(p, cProducts, headBlob)) seriesHw++;
  }
  const cChips = (c.chips || []).map(canonical);
  for (const ch of q.chips) {
    const forms = chipForms(ch);
    if (cChips.some((cc) => forms.some((f) => cc === f || cc.includes(f) || f.includes(cc)))) fullHw++;
    else if (forms.some((f) => headBlob.includes(f))) weakHw++;
  }
  if (fullHw >= 1) score += W_L2_HW_FIRST + (Math.min(fullHw, 3) - 1) * W_L2_HW_MORE;
  score += Math.min(weakHw, 2) * 5;
  score += Math.min(seriesHw, 2) * W_L2_SERIES;   // 发送端同十位系列（查VP210可参考VP410），不叠加于完整命中，故低于 W_L2_HW_FIRST
  // 驱动IC+译码IC成对命中：查询同时给出驱动与译码、案例也都对得上时再加权（芯片组合越对口，解法越可迁移）
  const qDrivers = q.chips.filter((ch) => !isDecoderChip(ch));
  const qDecoders = q.chips.filter((ch) => isDecoderChip(ch));
  if (qDrivers.length && qDecoders.length) {
    const chipHit = (ch) => {
      const forms = chipForms(ch);
      return cChips.some((cc) => forms.some((f) => cc === f || cc.includes(f) || f.includes(cc)))
        || forms.some((f) => headBlob.includes(f));
    };
    if (qDrivers.some(chipHit) && qDecoders.some(chipHit)) score += W_L2_PAIR;
  }

  // L3 模组工况：点间距 / 扫描方式，每命中 +4
  let workHit = 0;
  const cPitches = (c.pitches || []).map(canonical);
  const cScans = (c.scans || []).map(canonical);
  if (q.pitches.some((p) => cPitches.includes(p) || headBlob.includes(p))) workHit++;
  if (q.scans.some((s) => cScans.includes(s) || headBlob.includes(s))) workHit++;
  score += workHit * W_L3_WORK;

  // L4 版本：软件/固件版本每命中 +3
  const cVers = [...(c.softwareVersions || []), ...(c.firmwareVersions || [])].map(canonical);
  const verHit = q.versions.filter((v) => cVers.some((cv) => cv.includes(v) || v.includes(cv)) || blob.includes(v)).length;
  score += Math.min(verHit, 2) * W_L4_VER;

  // L5 自由关键词：每重合 +1（封顶6）
  const kwPool = (c.keywords || []).map((k) => String(k).toUpperCase());
  let kwHit = 0;
  for (const tok of q.tokens) {
    if (kwPool.some((k) => k.includes(tok) || tok.includes(k))) kwHit++;
    else if (blob.includes(tok)) kwHit += 0.5;
  }
  score += Math.min(kwHit, 6) * W_L5_KW;
  return score;
}

// 检索真实售后案例。domain="*" 时跨问题域（接收卡测试分流到异步/同步设备族时用）；familyOverride 强制设备族
function retrieve(query, limit = 30, domain = "display", familyOverride = null) {
  const db = loadSpecialist();
  const crossDomain = domain === "*";
  const scoreDomain = crossDomain ? (detectDomain(query) || "display") : domain;
  const pool = (db.cases || []).filter((c) =>
    (crossDomain ? c.recordType !== "inquiry" : c.domain === domain && c.recordType !== "inquiry"));
  const q = extractQueryTags(query, scoreDomain, familyOverride);
  return pool
    .map((c) => ({ c, s: scoreCase(c, scoreDomain, q), q }))
    .filter((x) => x.s > 18)
    .sort((a, b) => (b.s - a.s) || String(a.c.id).localeCompare(String(b.c.id)))
    .slice(0, limit);
}

// ============ 4. 步骤清洗与切分 ============
const NARRATIVE_REGEX = /寄回|返厂|研发|远程分析|远程调试|复现|现场有人|已返回|对接|沟通|怀疑是硬件|焊接|DDR颗粒|硬件异常|需返厂|等待|等现场|待验证|推测|问题\d|不确定|出现.{0,10}现象|的时候|出现闪点|案例描述|提\s*需求|等.{0,8}支持|后续版本|排期|迭代|需求单|暂不支持|平台再做/;
const PLACEHOLDER_STEP = /【|未填写|未明确|未单列|暂无|无(?:明确)?(?:解决|处理)方案|^\s*$/;
const ACTION_HEAD = /^[请先再然后可需应建议您你]*[改换调升级关开重启检查设置进入勾选降低提高切换更换拔插拔下重新导入导出选确认核对备份断电下载刷新重置恢复加载使用将把]/;

function clientFacing(s) {
  return String(s || "")
    .replace(/微盘上?(?:的)?(?:这个|那个|对应)?固件/g, "对应固件")
    .replace(/升级到?PPT[^，,。；;]*?给出的?/g, "升级到")
    .replace(/临时固件/g, "固件").replace(/临时版本/g, "版本")
    .replace(/\s+/g, " ").trim();
}
function cleanStepText(s) {
  return clientFacing(String(s || "")
    .replace(/^\s*(?:方案)?\d+\s*[、.．:：)）]\s*/, "")
    .replace(/^第[一二三四五]步\s*[:：]?\s*/, "")
    .replace(/[；;]\s*$/, "")).trim();
}
function splitSteps(text) {
  let s = String(text || "").trim();
  if (!s) return [];
  s = s.replace(/^(解决方法|解决方案|处理方法|处理方案)\s*[:：]?\s*/, "");
  const parts = s.split(/(?:^|[\n；;])\s*(?:\d+\s*[、.．)）]|[①②③④⑤⑥⑦⑧⑨]|第[一二三四五]步\s*[:：]?)/);
  let steps = parts.map(cleanStepText).filter((p) => p.length >= 4);
  if (steps.length <= 1) steps = s.split(/[。\n]/).map(cleanStepText).filter((x) => x.length >= 6);
  return steps.filter((st) => !PLACEHOLDER_STEP.test(st) && !NARRATIVE_REGEX.test(st) && ACTION_HEAD.test(st));
}

const CAUSE_PLACEHOLDER = /【(?:原文|原表|原文档)[^】]*】|未单列|暂无|^$/;
const CAUSE_UNCERTAIN = /怀疑|未确认|未能确认|未记录|无法确认|不能作为|待定|尚未|暂未|没记录|有待|需进一步/;
function summarizeCause(text) {
  let s = clientFacing(String(text || "").trim());
  if (!s || CAUSE_PLACEHOLDER.test(s)) return "";
  s = s.replace(/^(原因|根本原因|最终原因|故障原因|结论)\s*[:：]?\s*/, "").replace(/^定性为[，,]?/, "");
  let first = s.split(/[。\n；;]/)[0].trim();
  // 切掉逗号之后的内部分析/不确定尾巴（如“，具体故障部件未被单独验证”），只把前面确定的结论留给客户
  first = first.replace(/[，,][^，,。]*(?:未被?|未能|无法|尚未|暂未|待进一步|有待|不确定|没法确认|不能断定)[^，,。]*$/, "").trim();
  if (CAUSE_PLACEHOLDER.test(first) || CAUSE_UNCERTAIN.test(first)) return "";
  if (first.length > 70) first = first.slice(0, 68) + "…";
  return first;
}

// ============ 5. 混合模式：信息是否充分、反问 ============
// 信息足够 = 有现象(L1) + 有任一硬件身份(L2：型号 或 芯片)，缺哪个补哪个
function assessSituation(query, domain, history = []) {
  const subs = detectSubs(domain, query);
  const products = extractProducts(query);
  const chips = extractChips(query);
  const recent = history.slice(-4).map((h) => String(h.content || h.message || "")).join(" ");
  const histProducts = extractProducts(recent);
  const histChips = extractChips(recent);
  const allProducts = [...new Set([...products, ...histProducts])];
  const allChips = [...new Set([...chips, ...histChips])];
  return {
    domain,
    subs,
    products: allProducts,
    chips: allChips,
    hasPhenomenon: domain === "display" ? subs.length > 0 : true, // 显示效果需命中子类；其余域识别到即视为有现象
    hasHardware: allProducts.length > 0 || allChips.length > 0,  // 型号或芯片任一即算有硬件身份
    hasProduct: allProducts.length > 0,
  };
}
function buildClarifyQuestion(sit) {
  const conf = DOMAIN_CONF[sit.domain];
  if (!sit.hasPhenomenon) return conf.askPhenomenon;
  if (!sit.hasHardware) return "为了给你最准确的处理步骤，请问用的是哪款设备、或什么驱动/接收卡芯片？（比如异步卡A6L/C16L、视频处理器VP620A、接收卡R712，或芯片FM6363/ICN2065，直接发数字如6363也行）";
  return "";
}

// ============ 6. 金字塔回答组装 ============
// 案例是否与查询的“硬件身份”同源：同型号 或 同芯片（任一即可）
function sameHardware(c, sit) {
  const prods = sit.products || [], chips = sit.chips || [];
  if (!prods.length && !chips.length) return true;
  const cProds = (c.products || []).map(canonical);
  const cChips = (c.chips || []).map(canonical);
  const head = [c.title, c.customerWording, c.phenomenon].filter(Boolean).join(" ").toUpperCase();
  if (prods.some((p) => cProds.some((cp) => cp === p || cp.includes(p) || p.includes(cp)) || head.includes(p))) return true;
  if (chips.some((ch) => {
    const forms = chipForms(ch);
    return cChips.some((cc) => forms.some((f) => cc === f || cc.includes(f))) || forms.some((f) => head.includes(f));
  })) return true;
  return false;
}

// 案例所属现象子类（display取构建标签，network实时判定）
function cSubsOfCase(c, domain) {
  if (domain === "display") return c.subCategory ? [c.subCategory] : [];
  if (domain === "network") return detectNetworkSubs([c.title, c.phenomenon, c.finalCause, c.solution].filter(Boolean).join(" "));
  return [];
}
// 硬件覆盖度：案例命中查询里几个硬实体（型号+芯片）。查询给≥2个硬件时，“全对上”优先于“只对上一个”；
// 只给0/1个硬件时恒返回1（排序无差异，保持原结果）。命中口径与 sameHardware 完全一致。
function hwCoverage(c, sit) {
  const wantProducts = (sit.products || []).map(canonical);
  const wantChips = (sit.chips || []).map(canonical);
  const total = wantProducts.length + wantChips.length;
  if (total <= 1) return 1;
  const cProds = (c.products || []).map(canonical);
  const cChips = (c.chips || []).map(canonical);
  const head = [c.title, c.customerWording, c.phenomenon].filter(Boolean).join(" ").toUpperCase();
  let hit = 0;
  for (const p of wantProducts) {
    if (cProds.some((cp) => cp === p || cp.includes(p) || p.includes(cp)) || head.includes(p)) hit++;
  }
  for (const ch of wantChips) {
    const forms = chipForms(ch);
    if (cChips.some((cc) => forms.some((f) => cc === f || cc.includes(f) || f.includes(cc)))
      || forms.some((f) => head.includes(f))) hit++;
  }
  return hit / total;
}
// 选“最匹配案例”，优先级（每层内先按硬件覆盖度、再按相关分降序、并列按案例号升序，保证结果唯一确定、绝不随机）：
// 1 同硬件+严格同现象 → 2 同硬件+近邻现象 → 3 同硬件任意 → 4 全体严格同现象 → 5 全体近邻现象 → 6 榜首
function pickBest(ranked, sit) {
  const bySub = (arr) => arr.filter((r) => {
    const subs = cSubsOfCase(r.c, sit.domain);
    return sit.subs.length && subs.some((s) => sit.subs.includes(s));
  });
  const byNear = (arr) => arr.filter((r) => {
    const subs = cSubsOfCase(r.c, sit.domain);
    return sit.subs.length && subs.some((s) => sit.subs.some((qs) => (SUB_NEIGHBORS[qs] || []).includes(s)));
  });
  const hw = ranked.filter((r) => sameHardware(r.c, sit));
  const pick = (arr) => {
    if (!arr || !arr.length) return null;
    return [...arr].sort((a, b) =>
      (hwCoverage(b.c, sit) - hwCoverage(a.c, sit))   // 多硬件查询：型号+芯片全命中者优先
      || (b.s - a.s)
      || String(a.c.id).localeCompare(String(b.c.id)))[0].c;
  };
  return pick(bySub(hw)) || pick(byNear(hw)) || pick(hw)
    || pick(bySub(ranked)) || pick(byNear(ranked)) || (ranked[0] && ranked[0].c);
}

// 首选案例驱动的精简回答：只讲最匹配那一条怎么解决，不跨案例拼凑、不堆套话
function buildPyramidReply(query, ranked, sit) {
  const conf = DOMAIN_CONF[sit.domain];
  const all = ranked.map((r) => r.c);
  const best = pickBest(ranked, sit);
  const lines = [];

  // 现象措辞以“选中案例的真实子类”为准，避免问闪烁却给鬼影案例时文案对不上；近邻回退时显式说明
  const fallbackPhen = DOMAIN_PHEN_LABEL[sit.domain] || "售后问题";
  const bestSubs = best ? cSubsOfCase(best, sit.domain) : [];
  let phenText = sit.subs[0] || fallbackPhen;
  if (bestSubs.length) {
    if (!sit.subs.length || sit.subs.includes(bestSubs[0])) phenText = bestSubs[0];
    else phenText = `${bestSubs[0]}（与你说的${sit.subs[0]}相近）`;
  }
  const hwLabel = sit.products[0] || (sit.chips[0] ? `${sit.chips[0]}芯片` : "");
  const head = hwLabel ? `${hwLabel} ` : "";

  // 第一层：有真实根因才说根因；库里 96%+ 案例未单列根因，此时不编造原因、但必须给一句结论，
  // 否则 parsePyramidText 取不到【判断】段，客户看到的卡片首句（conclusion）会是空白。
  const cause = summarizeCause(best?.finalCause);
  const subject0 = hwLabel ? `${hwLabel}的` : "这类";
  if (cause) {
    // 根因原文若已以“是”开头（如“是由于…”）就不再补“是”，避免出现“当时是是由于”叠字
    const causeText = /^是/.test(cause) ? cause : `是${cause}`;
    lines.push(`【判断】${subject0}${phenText}，有一条已经解决的同款现场案例，当时${causeText}，按它验证过的步骤来就行。`);
  } else if (best) {
    lines.push(`【判断】给你找了一条${subject0}${phenText}的已解决现场案例，照下面验证过的步骤处理就行。`);
  }

  // 第一层补充：权重最大那条案例的“现场情况总结”，让客户先对照是不是同一种现场；与解决办法正文重复时不重复展示
  if (best) {
    const scene = String(best.phenomenon || best.customerWording || best.title || "")
      .replace(/^\s*\d+\s*[.、)）]\s*/, "")
      .replace(/^\s*(?:问题现象|问题描述|现象描述|现场现象|故障现象|问题|现象)\s*[:：]\s*/, "")
      .replace(/\s+/g, " ").trim();
    const solNorm = String(best.solution || "").replace(/\s/g, "");
    const sceneHead = scene.replace(/\s/g, "").slice(0, 16);
    const isDup = sceneHead && (solNorm.includes(sceneHead) || sceneHead.includes(solNorm.slice(0, 16)));
    if (scene && !isDup) lines.push(`【现场情况】${scene.slice(0, 70)}`);
  }

  // 第二层：解决办法只取自最匹配案例本身（拆不出步骤就直接陈述），不东拼西凑
  if (best) {
    const steps = splitSteps(best.solution).slice(0, 3);
    if (steps.length) {
      lines.push("\n【这样解决】");
      steps.forEach((st, i) => lines.push(`${i + 1}. ${st.replace(/[。\s]+$/, "")}`));
    } else {
      const sol = clientFacing(String(best.solution || "")).replace(/^解决(方法|方案|办法)\s*[:：]?/, "").trim();
      if (sol && !/^【/.test(sol)) lines.push(`\n【这样解决】${sol.slice(0, 320)}`);
    }
  }
  // 第三层：来源（首选案例出处，客户可追溯；不再输出黄色兜底卡，分段定位由 followUp 按钮承担）
  if (best) {
    const s = best.source || {};
    const loc = s.locator || (s.worksheet ? `第${s.worksheet}表${s.row ? "第" + s.row + "行" : ""}` : "") || (s.slideStart ? `第${s.slideStart}页起` : "");
    const srcText = [best.id, s.fileName || best.sourceFile || "", loc].filter(Boolean).join(" · ");
    if (srcText) lines.push(`\n【来源】${srcText}`);
  }
  return { text: lines.join("\n"), bestId: best?.id || "" };
}

// ============ 6.5 案例表格行组装（答案卡之下的可搜索案例表）============
const TEXT_CHIP_RE = /(?:SM|HX|ICND?|DP|FM|LS|CNS|MBI|TC|RUC|RUL|LYD|GC|MY|TL|RT|CFD|SUM)\d{2,5}[A-Z]{0,3}/gi;
const TEXT_DECODE_RE = /\b(?:138|59\d{2}|51\d{2}|52\d{2}|72\d{2}|2038[A-Z]?)\b/g;
const TEXT_PITCH_RE = /\bP\d(?:\.\d{1,2})?\b/g;
const VENDOR_STOP = /正常|单个|全彩|屏幕|显示屏|画面|芯片|列行管|网格|新建|文字|电脑|接口|这个|那个|同款|同型|一张|一排|针对|该款|这款|此款|对应|所有|同一|不同|本款|相关/;
// 汇总一条案例里出现的芯片（结构化优先，文本补抓）
function collectChips(c) {
  const set = new Set((c.chips || []).map((x) => String(x).toUpperCase()));
  const t = [c.title, c.phenomenon, c.customerWording].filter(Boolean).join(" ");
  let m;
  TEXT_CHIP_RE.lastIndex = 0;
  while ((m = TEXT_CHIP_RE.exec(t))) set.add(m[0].toUpperCase());
  TEXT_DECODE_RE.lastIndex = 0;
  while ((m = TEXT_DECODE_RE.exec(t))) set.add(m[0]);
  return [...set];
}
function collectPitches(c) {
  const set = new Set((c.pitches || []).map((x) => String(x).toUpperCase()));
  const t = [c.title, c.phenomenon].filter(Boolean).join(" ");
  let m; TEXT_PITCH_RE.lastIndex = 0;
  while ((m = TEXT_PITCH_RE.exec(t))) set.add(m[0].toUpperCase());
  return [...set];
}
function collectVendor(c) {
  const t = [c.title, c.phenomenon, c.sourceExcerpt].filter(Boolean).join(" ");
  const m = /([一-龥]{2,4})(?=模组)/.exec(t);
  if (m && !VENDOR_STOP.test(m[1])) return m[1];
  return "";
}
function uniqSorted(arr) { return [...new Set(arr.filter(Boolean))]; }
// 组装一行
function buildTableRow(rankedItem) {
  const c = rankedItem.c, s = Math.round(rankedItem.s);
  const chips = collectChips(c);
  const driver = uniqSorted(chips.filter((x) => !isDecoderChip(x)));
  const decoder = uniqSorted(chips.filter((x) => isDecoderChip(x)));
  const prods = (c.products || []);
  const sender = uniqSorted(prods.filter((p) => ["sender", "processor"].includes(productRole(p))));
  const receiver = uniqSorted(prods.filter((p) => productRole(p) === "receiver"));
  const pitches = collectPitches(c);
  const vendor = collectVendor(c);
  const phenomenon = String(c.phenomenon || c.title || "")
    .replace(/^\s*\d+\s*[.、)）]\s*/, "")
    .replace(/^\s*(?:问题现象|问题描述|现象描述|现场现象|故障现象|问题|现象)\s*[:：]\s*/, "")
    .replace(/\s+/g, " ").slice(0, 46);
  return {
    id: c.id, score: s, quality: c.quality || "",
    subCategory: c.subCategory || (c.domain === "network" ? (detectNetworkSubs([c.title, c.phenomenon].join(" "))[0] || "") : ""),
    module: { vendor, pitches },                 // 模组：厂家 + P几
    driverChips: driver,                          // 驱动芯片
    decoderChips: decoder,                        // 译码芯片
    senderCards: sender,                          // 发送卡/主控/处理器
    receiverCards: receiver,                      // 接收卡
    phenomenon,                                   // 现象（简述）
    // 点开详情所需完整内容
    detail: {
      title: c.title || "",
      finalCause: c.finalCause || "",
      solution: c.solution || "",
      troubleshooting: c.troubleshooting || "",
      source: c.source || null,
      softwareVersions: c.softwareVersions || [],
      firmwareVersions: c.firmwareVersions || [],
      scans: c.scans || [],
    },
  };
}
function buildTableRows(ranked, limit = 30) {
  return ranked.slice(0, limit).map(buildTableRow);
}

// ============ 6.6 硬件级高频兜底（千人千面说法的统一落点）============
// 触发条件：没强命中任何现象大类，但识别到了型号/芯片。
// 做法：直接按硬件身份全量召回该硬件的真实案例（结构化字段+标题文本都算，绕开 retrieve 的综合相关阈值，
//      避免漏掉“芯片只写在标题”的案例），统计最高频现象，给一条代表案例+解法，再请客户点选具体现象。
function collectHardwareCases(sit, domain) {
  const db = loadSpecialist();
  const sameHw = (db.cases || []).filter((c) => c.recordType !== "inquiry" && sameHardware(c, sit));
  const inDomain = sameHw.filter((c) => c.domain === domain);
  // 本域优先；该硬件在本域确实没有记录时，放宽到全部域找最接近经验，避免无谓反问
  return inDomain.length ? inDomain : sameHw;
}
const CHIP_LIKE_RE = /^(?:SM|HX|ICND?|DP|FM|LS|CNS|MBI|MB|TC|RUC|RUL|LYD|GC|MY|TL|RT|CFD|SUM)\d|^\d{3,5}[A-Z]{0,2}$/;
function hardwareFallback(sit, domain, rawLabel) {
  if (!sit.hasHardware) return null;
  const pool = collectHardwareCases(sit, domain);
  if (!pool.length) return null;

  // 该硬件在各现象小类的条数（降序，并列按小类名稳定排序，结果唯一不随机）
  const count = {};
  for (const c of pool) {
    const k = cSubsOfCase(c, domain)[0] || DOMAIN_PHEN_LABEL[domain] || "同类问题";
    count[k] = (count[k] || 0) + 1;
  }
  const topSubs = Object.keys(count).sort((a, b) => (count[b] - count[a]) || a.localeCompare(b, "zh"));
  const top = topSubs[0];

  // 把查询现象临时设为最高频小类，复用 pickBest / buildPyramidReply，不另起一套组装逻辑
  const sitTop = Object.assign({}, sit, { subs: [top] });
  const ranked = pool.map((c) => ({ c, s: QUALITY_BASE[c.quality] || 0 }));
  const best = pickBest(ranked, sitTop);
  if (!best) return null;

  // 显示名优先用客户原文打的硬件词（忠于输入，不把 16380 写成某个具体后缀）；芯片加“芯片”，产品型号不加
  const hwKey = rawLabel || sit.products[0] || sit.chips[0] || "";
  const hwName = CHIP_LIKE_RE.test(hwKey) ? `${hwKey}芯片` : hwKey;
  const pyr = buildPyramidReply("", ranked, sitTop);
  const intro = `没看到具体现象，先按 ${hwName} 最常见的「${top}」给你一条历史经验（该硬件这类记录 ${count[top]} 条）：`;
  // 高频现象快捷选项：value 直接带上硬件，点了即“硬件+现象”强命中走精准检索
  const options = topSubs.slice(0, 4).map((s) => ({ label: `${s} ${count[s]}条`, value: `${hwKey} ${s}`.trim() }));
  return {
    reply: `${intro}\n\n${pyr.text}`,
    ranked, sit: sitTop, bestId: pyr.bestId || best.id,
    followUp: { tip: "如果不是上面这类，点选最接近你现场的现象，我再精确匹配：", options },
  };
}

// 只给现象、没给任何硬件时：先给该域最多3步通用排查 + 兜底引导补型号，不空手反问；域没配通用步骤才返回 null
function buildGenericDomainReply(domain) {
  const conf = DOMAIN_CONF[domain];
  if (!conf || !Array.isArray(conf.noModelSteps) || !conf.noModelSteps.length) return null;
  const lines = [`【判断】${conf.genericCause || "先按下面顺序做通用排查。"}`];
  lines.push("\n【这样解决】");
  conf.noModelSteps.slice(0, 3).forEach((st, i) => lines.push(`${i + 1}. ${st}`));
  if (conf.fallback) lines.push(`\n${conf.fallback}（告诉我设备背面型号或接收卡芯片数字，我能直接调出同款历史案例。）`);
  return { text: lines.join("\n") };
}

// 现象边界清晰、且配了本域通用排查步骤的域：本域确无案例时给“本域通用排查”，不按现象文本跨域捞他域案例
// （否则“整屏黑屏点不亮”会被显示域“黑屏下有阴影”这类沾边案例带偏）。显示/联网域不在此列，维持原跨域就近兜底。
const GENERIC_FIRST_DOMAINS = new Set(["power_boot", "content", "firmware"]);

// ============ 7. 主入口 ============
// 给候选行打分组：best=最匹配(顶部卡已展示) / sameHw=该设备或芯片的其他问题 / samePhen=同类现象参考 / related
function groupCandidates(ranked, sit, domain, bestId) {
  const rank = { best: -1, sameHw: 0, samePhen: 1, related: 2 };
  return ranked.map((r) => {
    const row = buildTableRow(r);
    let group;
    if (row.id === bestId) group = "best";
    else if (sameHardware(r.c, sit)) group = "sameHw";
    else if (sit.subs.length && cSubsOfCase(r.c, domain).some((s) => sit.subs.includes(s))) group = "samePhen";
    else group = "related";
    row.group = group;
    return row;
  }).sort((a, b) => (rank[a.group] - rank[b.group]) || (b.score - a.score) || String(a.id).localeCompare(String(b.id)));
}

function answerPayload(reply, ranked, sit, domain, extra) {
  const sources = ranked.slice(0, 5).map((r) => ({
    id: r.c.id, title: r.c.title, score: Math.round(r.s), quality: r.c.quality,
    domain: r.c.domain, sourceFile: r.c.sourceFile, source: r.c.source,
  }));
  return Object.assign({
    matched: true, needClarify: false, reply, sources,
    candidates: groupCandidates(ranked, sit, domain, extra.bestId || "").filter((r) => r.group !== "best"),
    meta: {
      specialist: "aftersales", domain: sit.domain || domain, intent: "fault",
      categories: sit.subs, products: sit.products, chips: sit.chips,
      stage: "answer", hitCount: ranked.length,
    },
  }, extra || {});
}
function clarifyPayload(reply, domain, stage, options) {
  return {
    matched: true, needClarify: true, reply, options: options || null, sources: [],
    meta: { specialist: "aftersales", domain, intent: "fault", stage },
  };
}

function handle(query, history = []) {
  const text = String(query || "").trim();
  if (!text) return null;
  // 仅当上一轮助手是在“反问/分流提问”（以问号收尾）时才继承历史，支持只补一个型号/芯片的续问
  const histArr = Array.isArray(history) ? history : [];
  const lastAssistant = [...histArr].reverse().find((h) => h.role === "assistant");
  const lastIsClarify = lastAssistant && /[？?]\s*$/.test(String(lastAssistant.content || lastAssistant.message || "").trim());
  const recentText = lastIsClarify ? histArr.slice(-4).map((h) => String(h.content || h.message || "")).join(" ") : "";
  const combined = `${recentText} ${text}`.trim();

  // ===== 企微“其他高匹配案例”下钻：客户回编号 → 桥还原成 [CASE_DETAIL:案例号]，按 ID 直取该案例完整解法 =====
  // 纯确定性：不经模型、不重新打分，案例号来自上一轮我们自己给出的候选；找不到就请客户重发，绝不乱配。
  const detailM = text.match(/\[CASE_DETAIL:([A-Za-z0-9_-]+)\]/);
  if (detailM) {
    const db = loadSpecialist();
    const c = (db.cases || []).find((x) => String(x.id) === detailM[1]);
    if (!c) {
      return clarifyPayload("这条案例没有找到（可能已更新）。把设备型号或芯片丝印、现场现象再发我一次，我重新匹配。", "display", "case_detail_missing", null);
    }
    const domain = DOMAIN_CONF[c.domain] ? c.domain : "display";
    const cText = `${c.phenomenon || ""} ${c.title || ""} ${(c.chips || []).join(" ")} ${(c.products || []).join(" ")}`.trim();
    const sit = assessSituation(cText, domain, []);
    const ranked = [{ c, s: 999, q: {} }]; // 唯一候选即最佳，pickBest 必选它
    const pyr = buildPyramidReply(cText, ranked, sit);
    const followUp = domain === "display" ? {
      tip: "如果按上面处理还没解决，请在 HDSet 里给接收卡打测试画面，看故障现象是否仍存在：",
      options: [
        { label: "测试后现象仍在", value: "[RX_STILL]" },
        { label: "测试画面正常", value: "[RX_OK]" },
      ],
    } : null;
    return answerPayload(pyr.text, ranked, sit, domain,
      { bestId: c.id, followUp, meta: { stage: "case_detail" } }); // candidates 中唯一一条即主案例会被剔除 → 聚焦本条、不再重复 TOP5
  }

  // ===== 接收卡测试分段定位分流（按钮带 [TAG]，并由前端拼上原问题现象）=====
  const tagM = text.match(/\[(RX_STILL|RX_OK|SIDE_ASYNC|SIDE_SYNC)\]/);
  let tag = tagM ? tagM[1] : null;
  let cleanText = text.replace(/\[[A-Z_]+\]/g, "").trim();
  // 续问继承：上一轮停在“接收卡测试后现象仍在（RX_STILL）、等客户补芯片”，本轮客户不点按钮、直接手打一个芯片
  // （消息里没有 [RX_STILL] 标记、结尾也不是问号），等价于点了 [RX_STILL] 芯片：继承分流并把上一轮现象拼回，按芯片收窄。
  if (!tag) {
    const lastAsstText = String(lastAssistant?.content || lastAssistant?.message || "");
    const inRxStillCtx = /接收卡测试画面上仍有同样现象|问题在接收卡\s*\/\s*屏体侧|已按驱动芯片/.test(lastAsstText);
    if (inRxStillCtx && extractChips(cleanText).length) {
      tag = "RX_STILL";
      const prevUser = [...histArr].reverse().find((h) => h.role === "user");
      const prevPhen = String(prevUser?.content || "")
        .replace(/\[[A-Z_]+\]/g, "").replace(/[A-Za-z]+\d{4,5}/g, "").trim();
      if (prevPhen) cleanText = `${cleanText} ${prevPhen}`.trim();
    }
  }

  if (tag === "RX_OK") {
    return clarifyPayload(
      "接收卡测试画面正常、说明接收卡和屏体本身没问题，故障出在发送端这一侧。\n\n请问发送端用的是哪一类？",
      "display", "triage_sender",
      [{ label: "异步处理器（播放盒/异步卡）", value: "[SIDE_ASYNC]" }, { label: "同步视频处理器", value: "[SIDE_SYNC]" }]);
  }
  if (tag === "RX_STILL" || tag === "SIDE_ASYNC" || tag === "SIDE_SYNC") {
    // 同步/异步发送端分流：客户还没给这一侧的具体型号时，先确认方向并请其补型号（不急于匹配，避免拿接收卡芯片乱配处理器案例）
    if (tag === "SIDE_ASYNC" || tag === "SIDE_SYNC") {
      const wantFamily = tag === "SIDE_ASYNC" ? "async" : "vp";
      const hasSideModel = extractProducts(cleanText).some((p) => familyOf([p]) === wantFamily);
      if (!hasSideModel) {
        if (tag === "SIDE_ASYNC") {
          return clarifyPayload(
            "好的，故障定位在异步处理器（播放盒/异步卡，发送端）这一侧。\n\n请补充这台异步设备的具体型号（机身背面标签可见，如 C16L、A6L、H4K 等），我按型号给你最接近的历史案例。",
            "display", "triage_ask_async",
            [{ label: "C16L", value: "[SIDE_ASYNC] C16L" }, { label: "C16H", value: "[SIDE_ASYNC] C16H" },
             { label: "A6L", value: "[SIDE_ASYNC] A6L" }, { label: "A8", value: "[SIDE_ASYNC] A8" },
             { label: "H4K", value: "[SIDE_ASYNC] H4K" }, { label: "H6", value: "[SIDE_ASYNC] H6" }]);
        }
        return clarifyPayload(
          "好的，故障定位在同步视频处理器（发送端）这一侧。\n\n请补充这台视频处理器的具体型号（机身背面标签可见，如 VP210H、VP410H、VP1640A 等），我按型号给你最接近的历史案例。",
          "display", "triage_ask_vp",
          [{ label: "VP210H", value: "[SIDE_SYNC] VP210H" }, { label: "VP410H", value: "[SIDE_SYNC] VP410H" },
           { label: "VP620A", value: "[SIDE_SYNC] VP620A" }, { label: "VP820A", value: "[SIDE_SYNC] VP820A" },
           { label: "VP1640A", value: "[SIDE_SYNC] VP1640A" }, { label: "VP2060", value: "[SIDE_SYNC] VP2060" }]);
      }
    }
    let domain, family, head;
    if (tag === "RX_STILL") {
      domain = "display"; family = "rx";
      const stillChips = extractChips(cleanText);
      head = stillChips.length
        ? `接收卡测试画面上仍有同样现象，问题在接收卡/屏体侧；已按驱动芯片 ${stillChips.slice(0, 3).join("、")} 收窄，下面是相关历史案例：`
        : "接收卡测试画面上仍有同样现象，说明问题在接收卡/屏体侧（显示效果）。下面是同类故障的其他历史案例：";
    }
    else if (tag === "SIDE_ASYNC") { domain = "*"; family = "async"; head = "已定位到发送端·异步处理器（播放盒/异步卡）侧。下面是异步处理器的同类历史案例："; }
    else { domain = "*"; family = "vp"; head = "已定位到发送端·同步视频处理器侧。下面是视频处理器的同类历史案例："; }
    const ranked = retrieve(cleanText, 30, domain, family);
    if (!ranked.length) {
      return clarifyPayload("这一侧暂时没有检索到高度匹配的历史案例。请把设备型号和一段现象视频发我，由技术支持进一步定位。", "display", "triage_empty", null);
    }
    const scoreDomain = domain === "*" ? "display" : domain;
    const sit = assessSituation(cleanText, scoreDomain, []);
    sit.products = extractProducts(cleanText); sit.chips = extractChips(cleanText);
    sit.hasHardware = sit.products.length > 0 || sit.chips.length > 0;
    const pyr = buildPyramidReply(cleanText, ranked, sit);
    // 接收卡测试后现象仍在：先给同类案例，再平铺 6 个全局最高频芯片做快捷收窄；
    // 不在这 6 个里的，客户下一轮直接打字发芯片丝印数字即可（售后续问链路会接住、按芯片检索），已给芯片则不再追问。
    const stillNeedChip = tag === "RX_STILL" && extractChips(cleanText).length === 0;
    const triageFollowUp = stillNeedChip
      ? {
        tip: "点下面高频芯片可精确收窄；你的芯片不在其中也没关系，直接把模组上的芯片丝印数字发我（如 2065、5153）。",
        options: loadRxChipTop(6).map((c) => ({ label: c.label, value: `[RX_STILL] ${c.label}` })),
      }
      : null;
    return answerPayload(`${head}\n\n${pyr.text}`, ranked, sit, scoreDomain,
      { bestId: pyr.bestId, followUp: triageFollowUp, meta: { stage: `triage_${tag.toLowerCase()}` } });
  }

  // 判定启用域：本轮能判出域就以本轮为准（防止上一问题域污染），本轮判不出才继承历史（支持只补型号的续问）
  const textDomain = detectDomain(text);
  let domain = textDomain || detectDomain(combined);
  const textProducts = extractProducts(text);
  const textChips = extractChips(text);
  // 统一组装情境：本轮硬件优先，缺则继承最近历史
  const buildSit = (dom, q) => {
    const s = assessSituation(q, dom, []);
    s.products = textProducts.length ? textProducts : s.products;
    s.chips = textChips.length ? textChips : s.chips;
    s.hasHardware = s.products.length > 0 || s.chips.length > 0;
    return s;
  };
  const rawLabel = rawHardwareLabel(text) || rawHardwareLabel(combined);

  // 判不出问题域：若给了型号/芯片，按显示效果域做“硬件高频兜底”（千人千面说法的统一落点）；否则交上层做边界引导
  if (!domain) {
    const s0 = buildSit("display", combined);
    if (s0.hasHardware) {
      const fb0 = hardwareFallback(s0, "display", rawLabel);
      if (fb0) return answerPayload(fb0.reply, fb0.ranked, fb0.sit, "display",
        { bestId: fb0.bestId, followUp: fb0.followUp, meta: { stage: "hw_top_no_domain" } });
    }
    return { matched: false };
  }

  // 本轮自带现象时以本轮为准；本轮无现象（如只回“C16系列”）才用 combined 继承
  const retrieveQuery = textDomain ? text : combined;
  const sit = buildSit(domain, retrieveQuery);
  let ranked = retrieve(retrieveQuery, 30, domain);
  // 仅显示/联网域允许本域无料时按现象文本跨域找最接近；黑屏开机/节目/固件域语义边界清晰，不跨域（避免被他域沾边词带偏）
  if (!ranked.length && domain !== "*" && !GENERIC_FIRST_DOMAINS.has(domain)) ranked = retrieve(retrieveQuery, 30, "*");
  const conf = DOMAIN_CONF[domain];

  // ① 没强命中现象大类：有硬件→先给该硬件最高频经验+解法并请其点选现象；无硬件→才简短反问现象
  if (!sit.hasPhenomenon) {
    const fb = hardwareFallback(sit, domain, rawLabel);
    if (fb) return answerPayload(fb.reply, fb.ranked, fb.sit, domain,
      { bestId: fb.bestId, followUp: fb.followUp, meta: { stage: "hw_top_no_phen" } });
    return clarifyPayload(conf.askPhenomenon, domain, "clarify_phenomenon", null);
  }

  // ② 本域+跨域都没检索到：有硬件就给该硬件最高频历史经验（跨域池），实在连硬件都没有才请其补充
  if (ranked.length === 0) {
    // 边界清晰域：本域确无案例时先给本域通用排查（供电/启动、节目操作、固件升级），不拿他域相似词案例冒充
    if (GENERIC_FIRST_DOMAINS.has(domain)) {
      const gen0 = buildGenericDomainReply(domain);
      if (gen0) return answerPayload(gen0.text, [], sit, domain,
        { bestId: "", followUp: null, meta: { stage: "generic_domain_empty" } });
    }
    if (sit.hasHardware) {
      const fb = hardwareFallback(sit, domain, rawLabel);
      if (fb) return answerPayload(fb.reply, fb.ranked, fb.sit, domain,
        { bestId: fb.bestId, followUp: fb.followUp, meta: { stage: "hw_fallback_crossdomain" } });
    }
    // 无硬件：先给该现象的通用排查步骤，再引导补型号；域没配通用步骤时才简短反问
    const gen = buildGenericDomainReply(domain);
    if (gen) return answerPayload(gen.text, [], sit, domain,
      { bestId: "", followUp: null, meta: { stage: "generic_no_hardware" } });
    return clarifyPayload(
      "暂时没有检索到与该现象高度匹配的历史案例。补充一下设备型号，或驱动/接收卡芯片（直接发数字如 6363 也行），我再精确匹配。",
      domain, "clarify_noevidence", null);
  }

  // 正常回答：首选案例直给 + 该设备/芯片其他问题分组表；显示域末尾给“接收卡测试”分段定位引导
  const pyr = buildPyramidReply(text, ranked, sit);
  const followUp = domain === "display" ? {
    tip: "如果按上面处理还没解决，请在 HDSet 里给接收卡打测试画面，看故障现象是否仍存在：",
    options: [
      { label: "测试后现象仍在", value: "[RX_STILL]" },
      { label: "测试画面正常", value: "[RX_OK]" },
    ],
  } : null;
  return answerPayload(pyr.text, ranked, sit, domain, { bestId: pyr.bestId, followUp });
}

module.exports = {
  handle,
  detectDomain,
  isDisplayFault,
  detectCategories,
  detectDisplaySubs,
  extractProducts,
  extractChips,
  retrieve,
  pickBest,
  hwCoverage,
  hardwareFallback,
  splitSteps,
  loadSpecialist,
};
