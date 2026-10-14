// 产品特点结构化提取（业务逻辑层）
// 目标：接口只留“类型×数量”，带载/分辨率取干净数字，最后一行用一句话讲差异化卖点。
// 数据源：product-specs-index.keyParameters（规格书）+ product-index.facts（含“选型速查”浓缩行）。
const { loadProductData } = require("./product-data.cjs");
const { receiverLoadEvidence } = require("./product-parameters.cjs");
const specsMap = () => loadProductData().specs;
const indexList = () => loadProductData().products;
const hasCN = (s) => /[一-龥]/.test(String(s));
// 取某字段下所有候选句（? 分隔），优先中文句、去掉产品名前缀
function fieldSentences(kp, key) {
  const raw = String((kp && kp[key]) || "");
  if (!raw || raw === "未从规格书索引中确认") return [];
  return raw.split(/[?？]/).map((s) => s.trim()).filter(Boolean);
}
function pickCN(arr) {
  const cn = arr.filter(hasCN);
  return (cn.length ? cn : arr).slice();
}
function stripName(s) {
  return String(s).replace(/^HD[-_]?[A-Z0-9.]+\s*/i, "").replace(/\s+/g, " ").trim();
}

// ---------- 带载 ----------
// OCR 常把一个数字内部拆开（2 30 / 1 920），匹配前先去掉数字之间的空格
const despaceNum = (s) => String(s).replace(/(\d)\s+(?=\d)/g, "$1");
function extractLoad(kp, quick, facts, cluster) {
  const conditional = cluster === "rx" ? receiverLoadEvidence(kp, facts) : null;
  if (conditional) return conditional.text;
  const blob = despaceNum([...fieldSentences(kp, "load"), ...(facts || [])].join(" "));
  // 1) 单双色门头卡：单色/双色带载不同，必须分开标
  if (cluster === "mono") {
    const parts = [];
    // 先在“未并空格”的原文上严格取 * /× 两侧第一个完整数字，高度后不紧跟数字：
    // 避免 “Dual color : 512*64 4M Byte（内存）” 里 64 被后面的 4M 误粘成 644
    const rawBlob = [...fieldSentences(kp, "load"), ...(facts || [])].join(" ");
    // 宽度允许 OCR 把 512 拆成“5 12”（用“其后必须是乘号”锁边界，不会越到高度）；
    // 高度只取乘号后第一个完整数、不跨空格，避免 “*64 4M Byte（内存）” 把 64 和 4 粘成 644
    const sNumW = "([\\d](?:\\s?\\d){0,5})";
    const sNumH = "(\\d{1,6})";
    const pairStrict = (label, flags) => rawBlob.match(
      new RegExp(label + "\\s*[:：]?\\s*" + sNumW + "\\s*[*×x]\\s*" + sNumH + "(?!\\d)", flags));
    // 回退：OCR 把同一个数字拆开（如 5 12）时，用已并空格的 blob + 宽松数字再认一次
    const num = "([\\d][\\d\\s]{0,6}?\\d|\\d)(?!\\d)";
    const pairLoose = (label, flags) => blob.match(
      new RegExp(label + "\\s*[:：]?\\s*" + num + "\\s*[*×x]\\s*" + num, flags));
    const pick = (label, flags) => pairStrict(label, flags) || pairLoose(label, flags);
    const clean = (s) => String(s).replace(/\s/g, "");
    let m = pick("Single\\s*color", "i") || pick("单色");
    if (m) parts.push(`单色 ${clean(m[1])}×${clean(m[2])}`);
    m = pick("Dual\\s*color", "i") || pick("双色");
    if (m) parts.push(`双色 ${clean(m[1])}×${clean(m[2])}`);
    if (!parts.length) { // 中文“控制范围：1024×32、2048×32”
      const ctl = blob.match(/控制范围[:：]\s*([0-9×x*、,，\s]+)/);
      if (ctl) return ctl[1].trim().replace(/[x*]/g, "×").replace(/\s+/g, "") + "点";
    }
    if (parts.length) return parts.join("　") + "点";
  }
  // 2) 接收卡等：最大带载 256×384（点数）
  let pt = blob.match(/最大带载[:：]?\s*(\d+)\s*[×x*]\s*(\d+)/);
  if (pt) return `${pt[1]}×${pt[2]}点`;
  // 2.5) 多媒体服务器：整机最大输出 8192×4320 像素 → 换算万像素
  const mo = blob.match(/(?:整机)?最大输出[^0-9]{0,8}(\d{3,5})\s*[×x*]\s*(\d{3,5})\s*像素/);
  if (mo) { const px = (+mo[1]) * (+mo[2]); return `${Math.round(px / 10000)}万像素（${mo[1]}×${mo[2]}）`; }
  // 3) 全彩：X万像素（宽×高）；万也可能被 OCR/简写为 W，且后面不一定紧跟“像素”
  let wan = "", w = "", h = "";
  if (quick) {
    const mc = despaceNum(String(quick["最大控制"] || quick["控制范围"] || "")).match(/(\d+(?:\.\d+)?)\s*万/);
    if (mc) wan = mc[1];
    const wh = String(quick["宽/高"] || quick["宽／高"] || "").match(/(\d{3,5})\s*[\/／]\s*(\d{3,5})/);
    if (wh) { w = wh[1]; h = wh[2]; }
  }
  if (!wan) {
    for (const s of pickCN(fieldSentences(kp, "load")).concat(facts || [])) {
      const t = despaceNum(s);
      // “万”安全；简写 W 只在其后紧跟“像素”时才认（否则会把传感器功率 0.8W/12W 误当万像素）
      const m = t.match(/(\d+(?:\.\d+)?)\s*万(?!克|瓦)/) || t.match(/(\d+(?:\.\d+)?)\s*W(?=\s*像素)/);
      if (m) {
        wan = m[1];
        const pair = t.match(/(\d{3,5})\s*[×x*]\s*(\d{3,5})/);
        if (pair) { w = pair[1]; h = pair[2]; }
        const wm = t.match(/(?:水平最大支持|水平|最宽|宽度|最大宽)[^0-9]{0,8}(\d{3,5})/);
        const hm = t.match(/(?:垂直最大支持|垂直|最高|高度|最大高)[^0-9]{0,8}(\d{3,5})/);
        if (wm) w = wm[1]; if (hm) h = hm[1];
        break;
      }
    }
  }
  if (!wan) { // 英文兜底：3.9 million pixels / 650,000 pixels
    const en = fieldSentences(kp, "load").join(" ") + " " + (facts || []).join(" ");
    let m = en.match(/([\d.]+)\s*million\s*pixels/i);
    if (m) wan = String(Math.round(+m[1] * 100));
    else { m = en.match(/([\d,]{4,})\s*pixels/i); if (m) wan = String(Math.round(+m[1].replace(/,/g, "") / 10000)); }
  }
  if (!wan) return "";
  return `${wan}万像素${w && h ? `（${w}×${h}）` : ""}`;
}

// ---------- 分辨率 ----------
function extractResolution(kp, quick) {
  const pool = [...fieldSentences(kp, "resolution"), ...fieldSentences(kp, "load"), ...fieldSentences(kp, "support")].join(" ");
  const m = [...pool.matchAll(/(\d{3,4})\s*[×x*]\s*(\d{3,4})\s*@?\s*(\d{1,3})?\s*Hz?/gi)];
  if (m.length) {
    // 取总像素最大的那条
    let best = null;
    m.forEach((x) => { const area = +x[1] * +x[2]; if (!best || area > best.area) best = { area, w: x[1], h: x[2], hz: x[3] }; });
    let out = `最高 ${best.w}×${best.h}`;
    if (best.hz) out += `@${best.hz}Hz`;
    if (/4K/i.test(pool)) out += "（4K）";
    return out;
  }
  if (/4K@60/i.test(pool)) return "最高 4K@60Hz";
  if (/4K/i.test(pool)) return "最高 4K";
  return "";
}

// ---------- 接口数字化 ----------
// 标准接口别名 -> 统一名
const PORT_ALIASES = [
  [/千兆|Gigabit/i, "千兆网口"],
  [/百兆|100M communication/i, "百兆网口"],
  [/HUB\s?75E?/i, "HUB75E"],
  [/HUB\s?320/i, "HUB320"], [/HUB\s?12/i, "HUB12"], [/HUB\s?08/i, "HUB08"], [/HUB\s?40/i, "HUB40"],
  [/HDMI/i, "HDMI"], [/DVI/i, "DVI"], [/\bDP\b|DisplayPort/i, "DP"],
  [/VGA/i, "VGA"], [/\bEXT\b/i, "EXT"], [/SDI/i, "SDI"], [/CVBS/i, "CVBS"],
  [/Type[\s-]?C/i, "Type-C"], [/\bUSB/i, "USB"],
  [/TRS|3\.5mm|音频|audio/i, "音频"],
  [/RS[\s-]?232/i, "RS232"], [/RS[\s-]?485/i, "RS485"],
  [/继电器|Relay/i, "继电器"], [/传感器|sensor/i, "传感器"], [/GPS/i, "GPS"]
];
function canonicalPort(name) {
  for (const [re, label] of PORT_ALIASES) if (re.test(name)) return label;
  return null;
}
// 从一句话里抽 “类型(版本)×数量”。HDMI/DP/USB 保留 x.y 版本，按 类型+版本 分别计数
// （VP2060 原文“HDMI 2.0、DP 1.2、HDMI 1.3×4” -> HDMI(2.0)×1、DP(1.2)×1、HDMI(1.3)×4，正好6路）
const VER_PORTS = new Set(["HDMI", "DP", "USB"]); // 仅这三类常见 x.y 接口版本
function extractPortsFromSentence(sentence) {
  const text = String(sentence);
  const out = new Map(); // 复合键 “类型|版本” -> 数量（版本为空串表示原文未标注版本）
  const bump = (key, n) => out.set(key, Math.max(out.get(key) || 0, n));
  const TYPE_RE = /HDMI|DVI|DisplayPort|\bDP\b|VGA|\bEXT\b|SDI|CVBS|Type[\s-]?C|\bUSB\b|HUB\s?75E?|HUB\s?320|HUB\s?12|HUB\s?08|HUB\s?40|千兆网口|百兆网口|网口|TRS|3\.5mm|音频|audio|RS[\s-]?232|RS[\s-]?485|继电器|传感器|GPS/gi;
  let m;
  while ((m = TYPE_RE.exec(text))) {
    const name = canonicalPort(m[0]);
    if (!name) continue;
    const rest = text.slice(m.index + m[0].length);
    // 版本：仅 VER_PORTS，且紧跟类型词（≤2空格）的 数字.数字
    let ver = "", verLen = 0;
    if (VER_PORTS.has(name)) {
      const vm = rest.match(/^\s{0,2}(\d\.\d{1,2})(?![\d.])/);
      if (vm) { ver = vm[1]; verLen = vm[0].length; }
    }
    const afterVer = rest.slice(verLen);
    let n = 0;
    const back = afterVer.match(/^\s{0,3}[×x*]\s*(\d+)/);                    // 类型[版本]×N
    const before = text.slice(0, m.index)
      .match(/(\d+)\s*(?:路|个|channels?|ways?|[\*×x])[^\nA-Za-z0-9]{0,8}?$/i); // N×/N路 类型
    if (back) n = +back[1];
    else if (before) n = +before[1];
    else n = 1;                                                            // 纯枚举（无数量词）按1路
    bump(name + "|" + ver, n);
  }
  // 中文兜底：“20网口 / 4路网口 / 6-way Gigabit”（网口量词可省略，数量直接相邻）
  const reC = /(?<![A-Za-z0-9])(\d{1,3})\s*(?:路)?\s*(千兆网口|百兆网口|网口)/g;
  while ((m = reC.exec(text))) {
    const n = +m[1];
    if (n < 1 || n > 128) continue; // 真实网口数上限，滤掉型号尾巴(DCS4000 网口)、分辨率等误匹配
    const label = /百兆/.test(m[2]) ? "百兆网口" : /千兆/.test(m[2]) ? "千兆网口" : (/Gigabit/i.test(text) ? "千兆网口" : "网口");
    bump(label + "|", n);
  }
  return out;
}
function mergePortMap(target, src) {
  for (const [k, v] of src) target.set(k, Math.max(target.get(k) || 0, v));
}
function formatPorts(map) {
  // 展示顺序：视频信号输入在前，网口/HUB/其他在后
  const order = ["HDMI", "DVI", "DP", "VGA", "CVBS", "EXT", "SDI", "USB", "Type-C", "千兆网口", "百兆网口", "网口", "HUB75E", "HUB320", "HUB12", "HUB08", "HUB40", "输入子卡", "输出子卡", "音频", "RS232", "RS485", "继电器", "传感器", "GPS"];
  // 复合键 “类型|版本” 按类型聚合
  const groups = new Map();
  for (const [key, n] of map) {
    const i = key.indexOf("|");
    const name = key.slice(0, i), ver = key.slice(i + 1);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ ver, n });
  }
  const parts = [];
  const names = [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const name of names) {
    let arr = groups.get(name);
    // 该类型一旦有带版本项，丢弃无版本提及（多为“HDMI/DP音频输入”这类顺带描述，避免重复出一个裸 HDMI×1）
    if (arr.some((x) => x.ver)) arr = arr.filter((x) => x.ver);
    arr.sort((a, b) => (parseFloat(b.ver) || -1) - (parseFloat(a.ver) || -1)); // 高版本在前
    for (const x of arr) parts.push(x.ver ? `${name}(${x.ver})×${x.n}` : `${name}×${x.n}`);
  }
  return parts.join("、");
}
function extractInterfaces(kp, quick, extraLines) {
  const inMap = new Map(), outMap = new Map();
  // 选型速查：信号输入接口 / 输出（统一走解析器，自动保留 HDMI/DP/USB 的 x.y 版本）
  if (quick) {
    if (quick["信号输入接口"]) mergePortMap(inMap, extractPortsFromSentence(quick["信号输入接口"]));
    if (quick["输出"]) {
      const m = String(quick["输出"]).match(/(\d+)\s*网口/);
      if (m) outMap.set("千兆网口|", +m[1]);
    }
    // 模块化拼接器：输入/输出子卡数量
    const inCard = quick["最大输入子卡"] || quick["输入子卡"];
    if (inCard && /\d/.test(inCard)) inMap.set("输入子卡|", +(String(inCard).match(/\d+/) || [0])[0]);
    const outCard = quick["最多输出子卡"] || quick["输出子卡"];
    if (outCard && /\d/.test(outCard)) outMap.set("输出子卡|", +(String(outCard).match(/\d+/) || [0])[0]);
    // 多媒体服务器等：输出接口字段（如 Mini DP 1.2×2，保留版本号）
    if (quick["输出接口"]) mergePortMap(outMap, extractPortsFromSentence(quick["输出接口"]));
    if (quick["信号输出接口"]) mergePortMap(outMap, extractPortsFromSentence(quick["信号输出接口"]));
  }
  const all = []
    .concat(fieldSentences(kp, "interfaces"), fieldSentences(kp, "syncSupport"), fieldSentences(kp, "support"))
    .concat(extraLines || []);
  for (const s of all) {
    const ports = extractPortsFromSentence(s);
    if (!ports.size) continue;
    const isOut = /输出|网口|级联|HUB|Gigabit|output|receiving card/i.test(s);
    const isIn = /输入|input|signal/i.test(s);
    for (const [key, n] of ports) {
      const pname = key.slice(0, key.indexOf("|"));
      const outish = /网口|HUB/.test(pname);
      if (outish || (isOut && !isIn)) outMap.set(key, Math.max(outMap.get(key) || 0, n));
      else inMap.set(key, Math.max(inMap.get(key) || 0, n));
    }
  }
  // 已识别出千兆/百兆网口时删掉裸“网口”，避免重复计数
  for (const mp of [inMap, outMap]) {
    if (mp.has("千兆网口|") || mp.has("百兆网口|")) mp.delete("网口|");
  }
  return { inputs: formatPorts(inMap), outputs: formatPorts(outMap) };
}

// ---------- 差异化卖点 ----------
// 原则：只收“人有我优/人无我有”，不复述上面已列的带载/接口参数；品类人人有的标配不写。
// 规则：[key, 正则, 固定文案(空=动态生成), 允许的品类簇, 权重(越大越靠前)]
// 只在“该品类真会有此能力”时才允许出现，从根上杜绝跨品类误匹配。
const HIGHLIGHT_RULES = [
  // ===== 视频处理器/拼接器/服务器：比图像处理与集成度 =====
  ["modular", /模块化|子卡|插卡|modular|input card|output card/i, "模块化插卡设计，输入输出子卡灵活配置", ["vp", "ms"], 3],
  ["allinone", /二合一|三合一|集成.{0,4}发送卡|integrat\w*\s*(sending|tradition)|同步一体机/i, "处理器+发送卡一体，无需另配发送卡", ["vp"], 3],
  ["ipdecode", /IP解码|网络解码|IP\s*decode|decode card/i, "支持IP网络解码输入", ["vp"], 3],
  ["multi4k", /3×4K|2×4K|多.*4K窗口|4K\s*window/i, "单屏支持多路4K窗口", ["vp", "ms"], 3],
  ["p2p4k", /4K@60|4K.*点对点|点对点.*显示|point[\s-]to[\s-]point/i, "4K@60Hz点对点显示", ["vp", "ms", "tx"], 3],
  ["dvisrc", /DVI|HDMI|数字视频(源|输入)|视频源输入/i, "数字视频输入，直连电脑同步带屏", ["tx"], 1],
  ["genlock", /Genlock|帧同步|gen\s*lock/i, "Genlock帧同步，多机级联不撕裂", ["vp"], 3],
  ["edid", /EDID/i, "EDID智能管理", ["vp"], 2],
  ["seamless", /无缝切换|seamless\s*switch/i, "多路信号无缝切换", ["vp"], 3],
  ["hdr", /HDR/i, "支持HDR高动态范围", ["vp"], 3],
  ["redundant", /双备份|冗余|热备份|redundan/i, "双备份冗余设计，运行更可靠", ["vp", "rx", "async"], 3],
  ["lowlat", /低延迟|零延迟|low\s*latency/i, "低延迟实时处理", ["vp", "rx"], 2],
  ["multiwin", /free\s*layout|多画面任意|任意显示|六画面|多画面|多窗口|画中画|picture[\s-]in[\s-]picture|PIP|画外画|POP|双画面|两画面|windows?\b|two[\s-]screen|layers?\b/i, "多画面任意布局，画中画/画外画与窗口漫游", ["vp", "ms", "async"], 2],
  ["videowall", /拼接|屏体拼接|任意拼接|video\s*wall/i, "支持屏体任意拼接", ["vp", "ms", "async", "tx"], 2],
  ["scene", /场景预设|场景.*调用|预设.*调用|模板参数|scene\s*preset/i, "多场景/模板预设，一键调用", ["vp", "async"], 2],
  ["wifi", /Wi-?Fi|手机\s*APP|APP\s*(无线|控制|操控)|无线操控|无线控制|wireless|LedArt|掌控/i, "Wi-Fi，手机APP无线操控", ["vp", "async", "mono"], 2],
  ["cloud", /小灰云|云管理|云平台|互联网远程|4G|远程集群|远程机器管理|remote/i, "支持小灰云/4G远程集群管理", ["vp", "async", "mono"], 2],
  ["rs232", /RS232|RS-232|中控|central\s*control|serial\s*port\s*protocol/i, "RS232串口协议，可对接中控系统", ["vp", "ct", "tx", "async"], 2],
  ["udisk", /U\s?盘|USB.*(播放|playback)|即插即播/i, "U盘即插即播", ["vp", "async", "ms"], 1],
  // ===== 异步全彩卡/播放盒：比集成度、解码能力与控电 =====
  ["aio3", /集.{0,3}发送.{0,6}接收.{0,6}播放|integrates sending, receiving|发送.{0,3}接收.{0,3}播放.{0,3}一体/i, "集发送、接收、播放于一体，单卡直驱屏体", ["async"], 3],
  ["dualplayer", /双模播放|双模播放器|同步.{0,3}异步.{0,3}双模/i, "同步/异步双模播放，断网也能本地播", ["async"], 3],
  ["videocap", /(?:1\s*[-\s](?:way|channel|路)[^；;。]{0,8}4K)|(?:[2-9]\s*[-\s](?:way|channel|路)[^；;。]{0,8}1080P)|多路4K|4K\s*(?:解码|播放|output|decod)/i, "", ["async"], 3],
  ["cellular", /4G\s*[/／和、与]?\s*5G|支持\s*4G|5G\s*(?:模块|联网)|4G\s*模块|4G\/5G/i, "支持4G/5G移动联网，无宽带也能远程发布", ["async", "mono"], 2],
  ["storage", /(\d+)\s*GB/i, "", ["async", "mono"], 2],
  ["richcontent", /直播流|HTML|二维码|WPS|多种节目内容/i, "支持视频/文档/直播流/二维码等丰富节目", ["async"], 1],
  ["voice", /语音播报|中英文语音|voice\s*broadcast/i, "中英文语音播报", ["async"], 2],
  ["relay", /继电器|远程控制电源|远程控电|relay/i, "继电器远程控制电源，定时开关屏", ["async", "ct"], 2],
  ["highfps", /帧频|60Hz.*走字|走字平稳|高刷.{0,3}走字|smooth/i, "60Hz高帧频，走字平稳无拖影", ["async", "mono"], 2],
  ["brightlock", /亮度调节|按键锁定|锁定功能|brightness|key\s*lock/i, "亮度可调、按键锁定防误触", ["vp", "async", "mono"], 1],
  // ===== 接收卡：比同异步双模、RGB组数、接口代际、特殊屏、体积 =====
  ["dualmode", /同时支持同步[^。；]{0,12}异步|同异步双模|supports both synchronous[^.]{0,30}asynchronous/i, "同异步双模，同步/异步系统都能带", ["rx"], 3],
  ["rgbgroup", /(\d+)\s*groups?\s*of\s*RGB|(\d+)\s*组\s*(RGB|并行数据)/i, "", ["rx"], 3],
  ["hub320", /HUB\s?320/i, "搭载HUB320高速接口，带载更强", ["rx"], 3],
  ["transparent", /透明屏|贴膜屏|transparent\s*screen/i, "适配透明屏/贴膜屏等特殊应用", ["rx"], 3],
  ["mini", /mini\s*receiv|ultra[\s-]small|fine\s*pixel\s*pitch|小间距|小尺寸接收卡|高密度接插/i, "小尺寸mini接收卡，高密接插、体积小巧", ["rx"], 2],
  ["rotate", /90\s*度.{0,4}(旋转|图像)|image rotation|rotate in multiples of 90/i, "支持画面90°旋转安装", ["rx"], 2],
  ["gray16", /65536|16\s*bit\s*gray|灰度.{0,6}65536/i, "256~65536级高灰度，低灰过渡细腻", ["rx"], 3],
  ["scanwide", /静态.{0,3}1\s*\/\s*128|1\s*\/\s*128[^。；;]{0,6}(scan|扫)|any scanning|任意扫描/i, "支持静态到1/128扫任意扫描方式，抽点空点均可", ["rx"], 2],
  ["nanosync", /纳秒|nano[\s-]?second|任意排序/i, "多卡任意排序、纳秒级同步，拼屏不错位", ["rx"], 3],
  ["pwmmod", /PWM|常规芯片|regular chip/i, "兼容常规芯片与主流PWM芯片模组", ["rx"], 2],
  ["cable80", /80\s*(?:米|meters?|m\b)|Cat\s*[56]|超五|六类/i, "超五/六类网线80米内稳定传输", ["rx"], 2],
  ["finefull", /P1\.25|P1\.538|P1\.667|fully loaded|8\s*口?满载/i, "小间距P1.25等可8口满载，带载余量足", ["rx"], 3],
  // ===== 单双色门头卡：比内存、节目丰富度、传感器、联网方式 =====
  ["sensor", /外接.{0,10}传感器|温度.{0,3}湿度.{0,3}亮度|温湿度|烟雾传感|亮度传感|环境监测/i, "可外接温湿度/亮度/烟雾传感器，自动调光", ["mono", "async"], 2],
  ["memory", /(\d+)\s*M\s*Byte|内存[:：]\s*(\d+)\s*M/i, "", ["mono"], 2]
];
// 簇内“标配基线”：这些能力在该品类绝大多数型号都有，属行业标配，不作为差异化卖点展示。
const HIGHLIGHT_BASELINE = {
  rx: new Set(["scan", "pwm"]),
  vp: new Set(["multiwin", "udisk", "rs232"]),
  async: new Set(["udisk", "wifi", "cloud", "multiwin"]),
  tx: new Set(["videowall"]),
  mono: new Set(["sensor"]) // 门头卡 82% 都支持外接传感器，属标配
};
// 型号本身决定的专属特征（结构化资料未写、但由产品定义确知），key 为去 HD- 大写型号
const MODEL_HIGHLIGHT = {
  RB6: "专为透明屏/贴膜屏设计，84PIN高密接口"
};
// 动态卖点：规则自身不带固定文案（fixed 为空）时，按捕获值生成专业短句
function labelForRule(key, mm) {
  if (key === "rgbgroup") { const n = mm[1] || mm[2] || mm[3]; return n ? `${n}组RGB并行数据` : ""; }
  if (key === "memory") { const n = mm[1] || mm[2]; return n ? `${n}M大内存，可存更多节目` : ""; }
  if (key === "storage") { const n = mm[1] || mm[2] || mm[3]; return n ? `板载${n}GB大存储，节目无忧` : ""; }
  if (key === "videocap") return /4K/i.test(mm[0]) ? "支持4K解码，多路1080P视频窗口" : "支持多路1080P视频窗口并行播放";
  return "";
}
function buildHighlightPool(kp, quick, facts) {
  let pool = "";
  ["support", "syncSupport", "operation", "interfaces", "resolution"].forEach((k) => { pool += " " + fieldSentences(kp, k).join(" "); });
  if (quick && quick["支持"]) pool += " " + quick["支持"];
  pool += " " + (facts || []).join(" ");
  return pool;
}
function extractHighlights(kp, quick, facts, cluster, productName) {
  const pool = buildHighlightPool(kp, quick, facts);
  const pinned = []; // 公司手写总结/硬件配置，固定置顶
  // 0) 公司现成“功能特点：”总结最权威，优先采用（去掉开头纯带载参数）
  const featLine = (facts || []).find((f) => f.includes("功能特点"));
  if (featLine) {
    let t = featLine.split("功能特点")[1].replace(/^[:：]/, "").trim()
      .replace(/^[^；;]*控制范围[^；;]*[；;]/, "").replace(/[。.\s]*$/, "");
    // 按标点切段，剔除“接口枚举段”和“簇标配套话段”，置顶句只留差异化描述，不复述参数
    const IFACE = /HDMI|DVI|\bDP\b|VGA|CVBS|SDI|USB|网口|音频|视频|解码卡|输入|输出|接口|信号/gi;
    const isIface = (s) => s.replace(IFACE, "").replace(/[支持等、，,；;.\s]/g, "").length < 3;
    const isCliche = (s) => /多画面|画中画|画外画|窗口漫游|任意显示|U盘|即插即播|RS232|中控|任意拼接|外接.{0,4}传感器|Wi-?Fi|手机APP/.test(s);
    const kept = t.split(/[；;，,、]/).map((s) => s.trim())
      .filter((s) => s.length >= 4 && !isIface(s) && !isCliche(s));
    t = kept.join("；");
    if (t) pinned.push(t.slice(0, 80));
  }
  // 多媒体服务器：CPU/内存/显存就是核心卖点
  if (cluster === "ms" && quick) {
    const cfg = [];
    const valid = (v) => v && String(v).trim() && !/^[-—–]+$/.test(String(v).trim());
    if (valid(quick["CPU"])) cfg.push(quick["CPU"]);
    if (valid(quick["运行内存"])) cfg.push(quick["运行内存"] + "内存");
    if (valid(quick["显存"])) cfg.push(quick["显存"] + "显存");
    if (cfg.length) pinned.push("高配硬件：" + cfg.join("、"));
  }
  const baseline = HIGHLIGHT_BASELINE[cluster] || new Set();
  const ruleHits = [];
  // 型号专属特征（如 RB6 透明/贴膜专用），按高权重参与排序
  const bareKey = String(productName || kp.product || "").replace(/^HD-/, "").toUpperCase();
  if (MODEL_HIGHLIGHT[bareKey]) ruleHits.push({ label: MODEL_HIGHLIGHT[bareKey], w: 3 });
  for (const [key, re, fixed, clusters, weight] of HIGHLIGHT_RULES) {
    if (clusters && !clusters.includes(cluster)) continue;   // 品类白名单
    if (baseline.has(key)) continue;                         // 簇内标配，不当卖点
    const mm = pool.match(re);
    if (!mm) continue;
    const label = fixed || labelForRule(key, mm);
    if (!label) continue;
    const core = label.slice(0, 4);
    if (ruleHits.some((h) => h.label.includes(core))) continue;
    ruleHits.push({ label, w: weight || 1 });
  }
  // 差异化卖点按权重（硬能力优先）排序，与置顶项合计最多 3 条
  ruleHits.sort((a, b) => b.w - a.w);
  const out = [...pinned, ...ruleHits.map((x) => x.label)];
  // 去重（置顶句已含某关键词时跳过同义规则项）
  const final = [];
  for (const s of out) {
    const head = s.slice(0, 3);
    if (final.some((x) => x.includes(head) || s.includes(x.slice(0, 3)))) continue;
    final.push(s);
    if (final.length >= 3) break;
  }
  return final.join("；");
}

// ---------- 解析“选型速查”浓缩行 ----------
function parseQuickLine(lines) {
  const line = (lines || []).find((f) => String(f).includes("选型速查"));
  if (!line) return null;
  const body = String(line).split("选型速查")[1] || "";
  const obj = {};
  body.split(/[；;]/).forEach((seg) => {
    const m = seg.match(/^\s*([^:：]{2,10})[:：]\s*(.+)$/);
    if (m) obj[m[1].trim()] = m[2].trim();
  });
  return Object.keys(obj).length ? obj : null;
}
// 选型速查可能在 product-index.facts，也可能在规格书 keyParameters 某个字段里
function findQuick(prod, kp) {
  let line = (prod && prod.facts || []).find((f) => f.includes("选型速查"));
  if (!line) {
    const all = Object.values(kp || {}).filter(Boolean).join(" ? ");
    const m = all.match(/[^?？]*选型速查[^?？]*/);
    if (m) line = m[0];
  }
  return line ? parseQuickLine([line]) : null;
}
// 品类名清洗：从概述句里只取标准品类词
function cleanSeries(raw) {
  if (!raw) return "";
  let s = String(raw);
  const qm = s.match(/产品系列[:：]\s*([^，,。；;、?？\s][^，,。；;、?？]*)/);
  if (qm) s = qm[1];
  const t = stripName(s).replace(/^产品系列[:：]\s*/, "").trim();
  const SERIES_RE = /(?:中小屏|小屏|大屏|全彩|单双色|单色|双色|异步|同步)?(?:二合一|三合一)?(?:异步全彩|异步)?(?:视频拼接器|视频处理器|多媒体服务器|异步全彩控制[卡板]|异步控制[卡板]|异步播放[卡盒]|Wi-?Fi\s*控制卡|无线控制卡|网口控制卡|接收卡|发送卡|中央控制器|播放盒|主控|控制器)/ig;
  const hits = t.match(SERIES_RE);
  // 一句里出现≥2个品类（如“支持播放盒、发送卡、处理器”）是兼容列举，不是自身品类
  if (hits && hits.length >= 2) return "";
  const m = t.match(SERIES_RE);
  if (m) return m[0];
  const cand = t.split(/[，,。；;、?？]/)[0].slice(0, 14);
  return /(卡|器|盒|服务器)$/.test(cand) ? cand : ""; // 不像品类名就返回空，交给上层兜底
}

// 品类兜底推断（规格书 productSeries 为空时，从全部文本中英文关键词判断）
function inferSeries(kp, facts) {
  const t = Object.values(kp || {}).join(" ") + " " + (facts || []).join(" ");
  const rules = [
    [/三合一|3[\s-]{0,2}in[\s-]{0,2}1/, "三合一视频处理器"],
    [/二合一|2[\s-]{0,2}in[\s-]{0,2}1|two[\s-]in[\s-]one/, "二合一视频处理器"],
    [/多媒体服务器|multimedia\s*server/, "多媒体服务器"],
    [/视频拼接器|拼接器|video\s*splicer|splicing\s*processor/i, "视频拼接器"],
    [/视频处理器|video\s*processor/, "视频处理器"],
    [/异步全彩控制|asynchronous.*(control|controller)/i, "异步全彩控制卡"],
    [/异步控制|异步播放|asynchronous/i, "异步控制卡"],
    [/接收卡|receiving\s*card/i, "接收卡"],
    [/发送卡|sending\s*card/i, "发送卡"],
    [/中央控制器|central\s*controller/i, "中央控制器"],
    [/播放盒|player\s*box/i, "播放盒"]
  ];
  for (const [re, label] of rules) if (re.test(t)) return label;
  return "";
}

// 分簇纠正表：前缀推断与资料自述品类冲突时，以逐一核实过的此表为准（可审计、可回退）。
// 起因：K08/K12、B6/B17~B24 实为接收卡，H6/H8/B6L/H4K 实为多媒体播放盒，
// S232/H264/H265/D6196C 实为二合一视频处理器——按字母前缀会被错分，卖点白名单随之对错对象。
const CLUSTER_OVERRIDE = {
  K08: "rx", K12: "rx", B6: "rx",
  B17: "rx", B18: "rx", B19: "rx", B20: "rx", B21: "rx", B22: "rx", B23: "rx", B24: "rx",
  H6: "async", H8: "async", B6L: "async", H4K: "async",
  S232: "vp", H264: "vp", H265: "vp", D6196C: "vp"
};
// 型号前缀 -> 品类簇（决定“允许出现哪些卖点”，防止跨品类误匹配）
function clusterOf(name) {
  const bare = String(name).replace(/^HD-/, "").toUpperCase();
  const key = bare.match(/^[A-Z]+\d?[A-Z]*/);
  const head = key ? key[0] : "";
  if (CLUSTER_OVERRIDE[bare]) return CLUSTER_OVERRIDE[bare]; // 显式纠正优先
  if (/^(VP|KV|VM)/.test(head)) return "vp";    // 视频处理器/拼接器
  if (/^MS/.test(head)) return "ms";            // 多媒体服务器
  if (/^CT/.test(head)) return "ct";            // 中央控制器
  if (/^R/.test(head)) return "rx";             // 接收卡
  if (/^T/.test(head)) return "tx";             // 发送卡/主控
  if (/^A/.test(head)) return "async";          // 异步全彩 A
  if (/^(C|D|K)/.test(head)) return "async";    // 异步全彩 C/D/K
  if (/^(W|E|U|S|B|H)/.test(head)) return "mono"; // 单双色 Wi-Fi 卡
  return "other";
}
// 品类簇 -> 兜底标准品类名
const CLUSTER_SERIES = {
  vp: "视频处理器", ms: "多媒体服务器", ct: "中央控制器",
  rx: "接收卡", tx: "发送卡", async: "异步全彩控制卡", mono: "单双色Wi-Fi控制卡"
};
// 色彩系列：单双色卡区分单色/双色，其余为全彩
function colorSeries(cluster, text) {
  if (cluster === "mono") {
    const dual = /dual\s*color|双色/i.test(text);
    const single = /single\s*color|单色/i.test(text);
    if (dual && single) return "单色/双色";
    if (dual) return "双色";
    return "单色";
  }
  return "全彩";
}

// ---------- 主入口 ----------
function buildProductFeatures(productName) {
  const spec = specsMap()[productName];
  const prod = indexList().find((p) => (p.displayName || p.product) === productName);
  // 仅挂规格书、未结构化参数的型号（minimal）：不按型号字母前缀臆造品类/带载/卖点，
  // 产品卡只显示型号与规格书按钮，参数一律以规格书原文为准，宁缺毋滥。
  if (prod && prod.minimal) {
    return { cluster: clusterOf(productName), series: "", color: "", load: "", resolution: "", inputs: "", outputs: "", highlights: "", minimal: true };
  }
  const kp = (spec && spec.keyParameters) || {};
  const factsArr = (prod && prod.facts) || [];
  const quick = findQuick(prod, kp);
  const cluster = clusterOf(productName);
  let rawSeries = (quick && quick["产品系列"]) || (pickCN(fieldSentences(kp, "productSeries"))[0] || "");
  // productSeries 字段可能错填，若不像品类名，回 facts 找“产品系列：X”
  if (!/控制卡|处理器|拼接器|服务器|接收卡|发送卡|控制器|播放盒|主控/.test(rawSeries)) {
    const fm = factsArr.map((f) => String(f).match(/产品系列[:：]\s*([^，,。；;?？]+)/)).find(Boolean);
    if (fm) rawSeries = fm[1];
  }
  // 型号前缀簇是强信号，优先于文本推断（避免 R 卡文本里出现 player 被误判成播放盒）
  const series = cleanSeries(rawSeries) || CLUSTER_SERIES[cluster] || inferSeries(kp, factsArr) || "";
  const allText = Object.values(kp).join(" ") + " " + factsArr.join(" ");
  const { inputs, outputs } = extractInterfaces(kp, quick, factsArr);
  return {
    cluster,
    series,
    color: colorSeries(cluster, allText),
    load: extractLoad(kp, quick, factsArr, cluster),
    resolution: extractResolution(kp, quick),
    inputs,
    outputs,
    highlights: extractHighlights(kp, quick, factsArr, cluster, productName)
  };
}

// 诊断：返回某型号构造卖点用的原始上下文（供命中率分析/调试）
function inspectContext(productName) {
  const spec = specsMap()[productName];
  const prod = indexList().find((p) => (p.displayName || p.product) === productName);
  const kp = (spec && spec.keyParameters) || {};
  const factsArr = (prod && prod.facts) || [];
  const quick = findQuick(prod, kp);
  const cluster = clusterOf(productName);
  return { kp, quick, facts: factsArr, cluster, pool: buildHighlightPool(kp, quick, factsArr) };
}

// 品类“本职能力”通性句：是该品类定义级、对所有型号都成立的事实，不涉及型号专属参数、不吹嘘；
// 仅当差异化规则点不足（0~1 条）时用于补位，避免出现“详细规格见上方参数”这种空话。
const CLUSTER_GENERIC = {
  vp: "单机完成视频处理与屏体带载，适配现场同步显示",
  ms: "集中解码多路输出，稳定带载大屏",
  ct: "作为中控核心统一调度播放、外设与电源",
  rx: "安装于屏体侧驱动LED模组，经网线与发送卡级联协同显示",
  tx: "对接视频源向接收卡分发信号，是同步系统的发送端",
  async: "节目提前编辑、脱机循环播放，联网即可远程更新，无需电脑常驻",
  mono: "面向单/双色门头走字屏，节目脱机循环播放，支持联网或U盘更新",
  other: ""
};
// 真实“适用场景”必须命中这些场景词，且不能是规格表碎片（接口/速率/参数等）
const SCENE_WORDS = /酒店|商场|会议|演播|展览|展示|展馆|大厅|舞台|户外|室内|门头|店铺|商用|工程|现场|机场|车站|学校|医院|银行|地产|传媒|租赁|大屏|走字/;
const SCENE_NOISE = /序号|技术参数|接口\s*[:：]|速率|规格|型号\s*[:：]|参数\s*[:：]|分辨率\s*[:：]/;
// “竞品没有 / 比竞品强”的稀缺、代际级能力 key：命中才在结尾点一行，不硬凑、不喊空口号
const ADVANTAGE_KEYS = new Set([
  "finefull", "nanosync", "hub320", "transparent", "redundant",   // 接收卡：小间距满载/纳秒同步/HUB320代际/特殊屏/冗余
  "allinone", "modular", "ipdecode", "genlock", "multi4k", "hdr",  // 处理器：一体/模块化/IP解码/帧同步/多4K/HDR
  "aio3", "dualplayer", "cellular"                                 // 异步：三合一/双模/4G5G
]);
// ---------- 小灰机专用：把快查站压成标签的产品特点，扩写成一段专业介绍（全品类通用，只用真实素材） ----------
function buildProductDetail(productName) {
  const feat = buildProductFeatures(productName);
  if (feat.minimal) return { detail: "", adv: "", points: [], scene: "", minimal: true };
  const { pool, quick } = inspectContext(productName);
  const cluster = feat.cluster;
  const baseline = HIGHLIGHT_BASELINE[cluster] || new Set();
  // 规则命中（保留 key 以便分类/挑亮点）：差异化能力优先、品类标配靠后补位
  const diff = [], base = [], seen = new Set();
  for (const [key, re, fixed, clusters, weight] of HIGHLIGHT_RULES) {
    if (clusters && !clusters.includes(cluster)) continue;
    const mm = pool.match(re);
    if (!mm) continue;
    const label = fixed || labelForRule(key, mm);
    if (!label) continue;
    const head = label.slice(0, 3);
    if (seen.has(head)) continue;
    seen.add(head);
    (baseline.has(key) ? base : diff).push({ key, label, w: weight || 1 });
  }
  diff.sort((a, b) => b.w - a.w);
  base.sort((a, b) => b.w - a.w);
  const allHits = [...diff, ...base];
  // 多媒体服务器：CPU/内存/显存是核心硬指标，置顶
  if (cluster === "ms" && quick) {
    const cfg = [];
    const valid = (v) => v && String(v).trim() && !/^[-—–]+$/.test(String(v).trim());
    if (valid(quick.CPU)) cfg.push(quick.CPU);
    if (valid(quick["运行内存"])) cfg.push(quick["运行内存"] + "内存");
    if (valid(quick.显存)) cfg.push(quick.显存 + "显存");
    if (cfg.length) allHits.unshift({ key: "_cfg", label: "高配硬件：" + cfg.join("、"), w: 99 });
  }
  // 适用场景：必须含真实场景词、且不是规格表碎片
  let scene = "";
  const sm = String(pool).match(/(?:可)?用于[^。；;]{4,38}?(?:场合|场景)|适用(?:于|范围)[^。；;]{4,38}/);
  if (sm) {
    const cand = sm[0].replace(/\s+/g, "");
    if (SCENE_WORDS.test(cand) && !SCENE_NOISE.test(cand) && cand.length <= 44) {
      scene = /[。！？]$/.test(cand) ? cand : cand + "。";
    }
  }
  const lead = `${feat.series || "该产品"}${cluster === "mono" && feat.color ? `（${feat.color}）` : ""}`;
  // 去叠词：resolution 常自带“最高”前缀；load 已含相同分辨率核心时不重复
  const reso = String(feat.resolution || "").replace(/^最高\s*/, "").trim();
  const load = String(feat.load || "");
  const norm = (s) => s.replace(/[()（）\s×x*]/g, "");
  const resoDup = reso && norm(load).includes(norm(reso).slice(0, 5));
  // 结尾“亮点”：竞品级稀缺/代际能力，最多 2 个，单独成行、不在前面重复
  const advHits = allHits.filter((h) => ADVANTAGE_KEYS.has(h.key)).sort((a, b) => b.w - a.w).slice(0, 2);
  const advKeySet = new Set(advHits.map((h) => h.key));
  // 核心短语=逗号前的能力本身（逗号后的解释不展开）；含数字=量化硬指标(前置)，否则=定性能力(压成一句“支持…”)
  const coreOf = (lab) => String(lab).split(/[，,]/)[0].trim();
  // 真正的“量化硬指标”：带量值单位/分辨率/灰度区间等；RS232、4G、HUB75 这类命名不算
  const isQuant = (s) => /(\d+\s*(组|路|个|口|片|块|核|线程|级|帧|位|万|米|GB|MB|TB|%))|(\d+\s*M\b)|(\d+\s*[×x*]\s*\d+)|(\d{2,5}\s*[~～-]\s*\d)|(P\d\.\d+)|(\d+K\b)|(1080P|2160P)|(@\d+\s*Hz)|(1\s*\/\s*128)|(\d+\s*口?满载)/i.test(s);
  const numeric = [], qual = [], seenCore = new Set();
  for (const h of allHits) {
    if (advKeySet.has(h.key)) continue;
    const c = coreOf(h.label);
    if (!c || seenCore.has(c)) continue;
    seenCore.add(c);
    const toNumeric = !/^支持/.test(c) && isQuant(c); // “支持…”一律是定性能力
    (toNumeric ? numeric : qual).push({ core: c, w: h.w });
  }
  numeric.sort((a, b) => b.w - a.w);
  qual.sort((a, b) => b.w - a.w);
  const numCore = numeric.slice(0, 6).map((x) => x.core);
  const qualCore = qual.slice(0, 6).map((x) => x.core.replace(/^支持/, ""));
  // 命中点太少：处理器/发送/服务器补真实硬参数，所有品类补一句本职能力
  const hitN = numCore.length + qualCore.length;
  const extraNum = [];
  if (hitN <= 1 && ["vp", "ms", "tx"].includes(cluster)) {
    const m = String(feat.outputs || "").match(/千兆网口[×x](\d+)/);
    if (m) extraNum.push(`${m[1]}路千兆网口直连接收卡`);
    if (load) extraNum.push(`最大带载${load}`);
    if (reso && !resoDup) extraNum.push(`最高支持${reso}`);
  }
  const seg = [];
  if (extraNum.length + numCore.length) seg.push([...extraNum, ...numCore].join("，"));
  if (qualCore.length) seg.push("支持" + qualCore.join("、"));
  if (hitN <= 1 && CLUSTER_GENERIC[cluster]) seg.push(CLUSTER_GENERIC[cluster]);
  if (!seg.length) return { detail: "", adv: "", points: allHits.map((h) => h.label), scene };
  let detail = `${lead}，${seg.join("；")}。`;
  // 亮点（竞品级稀缺能力）从介绍段拆出单独返回，由上层渲染成独立的“· 亮点：”行、标签左置顶，不再挤在产品特点长句末尾
  const adv = advHits.length ? advHits.map((h) => coreOf(h.label)).join("、") : "";
  if (scene) detail += scene;
  return { detail, adv, points: allHits.map((h) => h.label), scene };
}

module.exports = { buildProductFeatures, buildProductDetail, HIGHLIGHT_RULES, buildHighlightPool, inspectContext };
