// ============================================================================
// ordering-specialist.cjs —— 配单（BOM 选型）业务层【薄适配器，单一职责】
//
// 分层：计算内核不写在这里。真正的选型/带载/组网算法在 ordering-engine.cjs
//   （从旧项目原样迁入，算法不改，只改数据路径）。本文件只做三件事：
//     1) 判断一句话里有没有足够的屏体尺寸（没有就一次性反问，不空算）；
//     2) 适配两种输入：聊天/企微自然语言 → engine.answer(WithContext)；
//        网页结构化表单 → handleStructuredOrdering(values)（预留，前端落地即用）；
//     3) 把引擎结果整理成 /api/ai/chat 的统一 payload（顶层 reply 供企微取用）。
// 不掺售后检索、不掺售前参数。
// ============================================================================

"use strict";

const engine = require("./ordering-engine.cjs");
const { renderTopoOnly } = require("./topo-hdset.cjs"); // 纯拓扑（无HDSet外壳），失败回退引擎旧图
const llm = require("../llm-client.cjs"); // 大模型只做配单口语补抽（窄口子）：失败回退正则、选型算法零改动
const multiScreen = require("./ordering-multiscreen.cjs");
const ssmGenerator = require("./ssm-generator.cjs"); // 配单成功→HDSet 可导入连屏文件（仅真机验证过的 standard 模板口数，见 buildSsmDownload）
const stripFolding = require("./ordering-strip-folding.cjs"); // 长条屏异步打折：独立确定性模块（CX6/C16L/A系列/B8L/A8/同步VPX），不改引擎
const multiScreenLLM = require("./ordering-multiscreen-llm.cjs"); // 多屏语义兜底：模型只切分几块屏，高置信+证据才采纳，失败回退单屏 // 多屏/超大工程确定性识别：命中不自动配，引导联系人工

// 配单末尾的一句引导（用户规则：售前/配单带一句，售后不带）
const FAULT_HOOK = "如果现场其实是花屏、闪屏、连不上等故障，直接把现象发我，走售后历史案例更快。";

// ---------------------------------------------------------------------------
// 1. 从一句话抽取屏体规格（只用于判断“够不够起步计算”，不臆造默认值）
// ---------------------------------------------------------------------------
// 整屏排列说法检测：词表须与 ordering-engine.parseGridCount 对齐（数字在前/方向词在前、个|张|块|排量词、横向/纵向/横/纵/宽方向/高方向、每排…共…排）
const GRID_WORD_W = "(?:横向排|横着|横向|横排|横|宽着|宽方向|宽度|宽|长方向|长度|长|列)";
const GRID_WORD_H = "(?:纵向排|竖着|竖向|纵向|纵排|纵|高着|高方向|高度|高|排|行)";
const GRID_Q = "(?:个|张|块|排)?";
const GRID_D = "(\\d{1,3})";
const GRID_SEP = "[^0-9]{0,6}";
const GRID_TW = `(?:个|张|块|排|${GRID_WORD_W})?`;
const GRID_TH = `(?:个|张|块|排|${GRID_WORD_H})?`;
const GRID_DETECT_REGEX = new RegExp([
  `${GRID_D}\\s*${GRID_Q}\\s*${GRID_WORD_W}\\s*${GRID_SEP}\\s*${GRID_D}\\s*${GRID_Q}\\s*${GRID_WORD_H}`,
  `${GRID_D}\\s*${GRID_Q}\\s*${GRID_WORD_H}\\s*${GRID_SEP}\\s*${GRID_D}\\s*${GRID_Q}\\s*${GRID_WORD_W}`,
  `${GRID_WORD_W}\\s*${GRID_D}\\s*${GRID_TW}\\s*${GRID_SEP}\\s*${GRID_WORD_H}\\s*${GRID_D}\\s*${GRID_TH}`,
  `${GRID_WORD_H}\\s*${GRID_D}\\s*${GRID_TH}\\s*${GRID_SEP}\\s*${GRID_WORD_W}\\s*${GRID_D}\\s*${GRID_TW}`,
  `${GRID_D}\\s*(?:个|张|块|排)\\s*[,;xX×*]\\s*${GRID_D}\\s*(?:个|张|块|排)`,
  `(?:每排|一排)[^0-9]{0,6}${GRID_D}[^0-9]{0,14}?\\d{1,3}\\s*排`,
  "模组.{0,4}\\d+\\s*[×x*]\\s*\\d+"
].join("|"));
const GRID_STRIP_REGEX = new RegExp(GRID_DETECT_REGEX.source, "g");

// 维度词确定性归一（不经过大模型、零失败）：进抽取/选型前把客户口语统一成引擎认识的标准语序——
//  ① 汉字“乘”→×（与引擎 parseRequest 一致，否则“1920乘1080”被误判没给尺寸而提前反问）；
//  ② 中文用“长×宽”描述矩形屏、且“长”在“宽”前又没提“高”时：长=横向(宽向)、宽=竖向(高向)，
//     “长10宽6/长6米宽3米”改写成“宽10高6/宽6米高3米”；常规“宽…高…”“长…高…”语序不动。
// 用占位分两步替换，避免“长→宽”新产生的宽被第二步又改成高。
function normalizeAxisText(text) {
  let t = String(text || "").replace(/(\d)\s*乘\s*(\d)/g, "$1×$2");
  const li = t.search(/长/), wi = t.search(/宽/);
  if (li >= 0 && wi >= 0 && li < wi && !/高/.test(t)) {
    t = t.replace(/长度|长/g, "").replace(/宽度|宽/g, "高").replace(//g, "宽"); // 私用区占位，避免连锁替换误伤原文 W（WiFi/型号）
  }
    // ③ 排列方向词与数字之间的口语填充词清掉（横着摆10张/宽着有10个 → 横10/宽10），下游排列正则统一可认；对像素/米数同样中性无害
  t = t.replace(/(横向排|纵向排|横向|纵向|横着|竖着|横排|纵排|宽方向|高方向|长方向|宽度|高度|长度|宽|高|长|横|竖|列|行|排)(?:着|的)?(?:摆|放|做|要|想|是|有|为|约|大概|估计|预计|的|改成|改为|改到|调整成|调整为|调到|调成|调整|改|设成|设为|设置成|设置为|设|换成|换为|换)?\s*(\d)/g, "$1$2");
return t;
}

// 解析物理尺寸（米/m）：以句中第一个尺寸数字的方向词位置确定语序（“6米宽”=后置 / “宽6米”=前置），
// 整句按同一语序解析，避免“6米宽3米高”混排时把上个维度的方向词误配给下一数字；按 宽|长 / 高 归位。
function parseMeters(t) {
  let meterW = null, meterH = null;
  const DIR = "(?:宽度|长度|高度|宽|长|高)"; // 方向词兼容“宽度/长度/高度”，长词在前避免被单字截断
  const ip = t.search(new RegExp(DIR + "\\s*\\d+(?:\\.\\d+)?\\s*(?:米|m)"));
  const io = t.search(new RegExp("\\d+(?:\\.\\d+)?\\s*(?:米|m)\\s*" + DIR));
  const usePost = io >= 0 && (ip < 0 || io < ip); // 先出现“数字米方向词”→后置语序
  const re = usePost
    ? new RegExp("(\\d+(?:\\.\\d+)?)\\s*(?:米|m)\\s*(" + DIR + ")", "gi")
    : new RegExp("(" + DIR + ")\\s*(\\d+(?:\\.\\d+)?)\\s*(?:米|m)", "gi");
  let m;
  while ((m = re.exec(t))) {
    const dir = (usePost ? m[2] : m[1])[0]; // 宽度/长度/高度 取首字归一为 宽/长/高
    const num = usePost ? m[1] : m[2];
    if (dir === "宽" || dir === "长") { if (meterW == null) meterW = num; }
    else if (dir === "高") { if (meterH == null) meterH = num; }
  }
  // 无方向词的乘号物理尺寸“6m×3m / 3m*2米”（前宽后高）兜底；方向词已解析出的成对值不覆盖
  if (meterW == null || meterH == null) {
    const mm = t.match(/(\d+(?:\.\d+)?)\s*(?:米|m(?![mA-Za-z]))\s*[×x*]\s*(\d+(?:\.\d+)?)\s*(?:米|m(?![mA-Za-z]))/i);
    if (mm) { if (meterW == null) meterW = mm[1]; if (meterH == null) meterH = mm[2]; }
  }
  return { meterW, meterH };
}
function extractSpec(text) {
  const t = normalizeAxisText(text);
  // 整屏像素相乘：先遮蔽“模组/单元板 … NxN”（那是单模组分辨率/尺寸，不是整屏）；整屏两维≥3位（模组点数多为2位），且不接 mm
  const screenDimProbe = t.replace(/(?:模组|单元板)[^\d]{0,6}\d{2,5}\s*[×x*]\s*\d{2,5}\s*(?:mm|毫米|点|像素)?/gi, " ");
  // 宽维≥3位；高维允许2位——矮长条整屏高度常只有1块模组（64/80点），但单模组分辨率（128×64、320×160）不能误当整屏：
  // 高维为2位时，宽必须明显是多块模组拼出的整屏量级（>320，即超过单块模组宽上限）且横屏宽≥高才采信。
  const dimRaw = screenDimProbe.match(/(\d{3,5})\s*[×x*]\s*(\d{2,5})\s*(?:px|像素|点)?(?!\s*(?:mm|毫米))/i);
  let dim = dimRaw;                                                                                          // 宽×高（整屏点数/像素）
  if (dim) { const _w = Number(dim[1]), _h = Number(dim[2]); if (_h < 100 && !(_w > 320 && _w >= _h)) dim = null; }
  const pitch = (t.match(/P\s*(\d(?:\.\d{1,2})?)/i) || [])[1] || null;  // P几
  const scan = (t.match(/(?:1\s*[\/／]\s*)?(\d{1,3})\s*扫/) || [])[1] || null;
  const area = (t.match(/([\d.]+)\s*(?:平米|平方|㎡|m2)/i) || [])[1] || null;
  const { meterW, meterH } = parseMeters(t);
  // 模组排列检测要先剔除物理尺寸：NxN mm 是模组物理尺寸、N米/Nm 是整屏物理尺寸，
  // 二者都不是“几宽几高张”的排列；否则会被排列清理正则删残，跨片段误判整屏像素（如 P2 320x160mm+6米×3米 报 P18.75 冲突）
  const gridProbeText = t
    .replace(/\d{1,4}\s*[×x*]\s*\d{1,4}\s*(?:mm|毫米)/gi, " ")
    .replace(/\d+(?:\.\d+)?\s*(?:米|公尺|m(?![A-Za-z]))/gi, " ");
  const moduleGrid = GRID_DETECT_REGEX.test(gridProbeText); // 模组/整屏排列（词表与引擎 parseGridCount 对齐）
  // #48 确定性回填排列数（复用引擎同一套 parseGridCount，不再只靠大模型）；仅在已判定为排列时取，像素/尺寸不被吞
  let gridW = null, gridH = null;
  if (moduleGrid && engine.parseGridCount) {
    try {
      const _gh = engine.parseGridCount(gridProbeText);
      if (Array.isArray(_gh) && _gh[0] >= 1 && _gh[1] >= 1 && _gh[0] <= 999 && _gh[1] <= 999) { gridW = _gh[0]; gridH = _gh[1]; }
    } catch { gridW = null; gridH = null; }
  }
  // 汉字“宽/高（=长）”引导的整屏像素点数（没有乘号也认），宽、高谁先说都按关键字归位（高1920宽1080→宽1080高1920）。
  // 排列说法(GRID，数字≤3位)优先；数字带 米/m 走物理尺寸、带 张/块/排/列/行 等走模组排列，均不在此抓，避免互相抢。
  let axisW = null, axisH = null;
  if (!moduleGrid) {
    const mW = t.match(/(?:宽度|长度|宽|长)\s*(\d{3,5})(?!\s*(?:米|[mM]|张|块|排|个|列|行|组|片|模组))(?:\s*(?:点|像素|px))?/i);
    const mH = t.match(/(?:高度|高)\s*(\d{2,5})(?!\s*(?:米|[mM]|张|块|排|个|列|行|组|片|模组))(?:\s*(?:点|像素|px))?/i); // 高放宽到2位（矮长条1块模组高）
    axisW = mW ? Number(mW[1]) : null;
    axisH = mH ? Number(mH[1]) : null;
    // 2位高度只可能是1块模组高：须伴随多块模组拼出的大宽（>320）横屏才采信，否则按单模组值丢弃
    if (axisH != null && axisH < 100 && !(axisW > 320 && axisW >= axisH)) axisH = null;
  }
  const side = /异步|播放盒|异步卡/.test(t) ? "async"
    : /同步|视频处理器|处理器|\bVP\b/.test(t) ? "sync" : null;
  return {
    width: dim ? Number(dim[1]) : axisW,
    height: dim ? Number(dim[2]) : axisH,
    pitch, scan, area, meterW, meterH, moduleGrid, gridW, gridH, side,
  };
}

// 是否有任一可起步的尺寸口径（宽高点数 / 面积 / 宽高米数 / 模组排列）
function enoughToEstimate(spec) {
  return Boolean(
    (spec.width && spec.height) || spec.area
    || (spec.meterW && spec.meterH) || spec.moduleGrid
  );
}

// ---------------------------------------------------------------------------
// 1.5 配单口语补抽（大模型窄口子）：确定性正则抽不全时，模型只抽结构化数值，且每个数值必须能在
//     客户原话里原样找到（guardSpec 回原文校验），再归一成引擎认识的标准措辞补进文本。
//     选型/带载/拓扑/BOM 仍 100% 走 ordering-engine，模型绝不参与计算。
// ---------------------------------------------------------------------------
const SPEC_EXTRACT_SYSTEM = [
  "你是配单信息抽取器，只从客户这句话抽取下列字段，原文没写的一律 null，绝不脑补、不推算、不做选型。",
  "三类尺寸互斥，不要混填：",
  "1) meterW/meterH=整屏物理宽/高米数，仅当数字带“米/m/公尺”单位才填；",
  "2) pixelsW/pixelsH=整屏宽/高像素点数，百级以上、带“点/像素/分辨率”或纯大数相乘(如1920x1080)才填；",
  "3) gridW/gridH=整屏由多少张模组拼出来（宽几张、高几张），1–999整数，带“张/块/排/列/行/个”，或“宽/高/长/横向/纵向+个位两位数”且无“米/m”时填这里。",
  "判别示例：“10宽9高/横向10张纵向9张/10列9行/长10宽6(长在前=横向、句中无高字)”→gridW10 gridH9，其余尺寸null；“宽6米高3米/6m×3m”→meterW6 meterH3，“十米宽六米高”→meterW10 meterH6；“1920x1080/宽1920高1080”→pixelsW1920 pixelsH1080。",
  "严禁把无“米”的个位/两位数张数当成米数（否则算成巨型屏）。pitch=点间距只给数字(P2.5→2.5)；sync只取sync/async/null；area=平方米数字；scan=扫描只给数字(1/16扫→16)。",
  "只输出 JSON：{\"meterW\":null,\"meterH\":null,\"pixelsW\":null,\"pixelsH\":null,\"gridW\":null,\"gridH\":null,\"pitch\":null,\"sync\":null,\"area\":null,\"scan\":null}",
].join("\n");

const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function numberInOriginal(num, raw) {
  if (num == null || String(num) === "") return false;
  if (String(raw).includes(String(num))) return true; // 阿拉伯数字原样命中
  const n = Number(num); // 中文数字：六米→6、三米→3（仅 0–10 整数）
  return Number.isInteger(n) && n >= 0 && n <= 10 && Object.keys(CN_NUM).some((c) => CN_NUM[c] === n && String(raw).includes(c));
}
// 米数回原文校验：模型给的物理米数，该数字在原话里必须真带“米/m/公尺”长度单位；
// 只写“长度10/宽10/高9”而无单位的是模组张数排列或像素，绝不能当 10 米（防巨型屏误算）
function numberHasMeterUnit(num, raw) {
  if (num == null) return false;
  const text = String(raw || "");
  const ns = String(num).replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
  if (new RegExp(ns + "\\s*(?:米|公尺|m(?![a-zA-Z]))", "i").test(text)) return true;
  const cnN = Number(num); // 兼容“十米/六米”中文数字紧跟单位（仅0–10整数）
  if (Number.isInteger(cnN) && cnN >= 0 && cnN <= 10) {
    const cn = Object.keys(CN_NUM).find((c) => CN_NUM[c] === cnN);
    if (cn && new RegExp(cn + "\\s*(?:米|公尺)").test(text)) return true;
  }
  return false;
}
// 数字回原文校验：模型给的数值字符串必须原样出现在客户原话里，否则置 null（防“全彩异步”被脑补成 1920/P3）
function guardSpec(spec, raw) {
  for (const k of ["meterW", "meterH", "width", "height", "pitch", "area", "scan"]) {
    if (spec[k] != null && !numberInOriginal(spec[k], raw)) spec[k] = null;
  }
  // 米数额外要求长度单位；像素单边不足一个模组（16点）的整屏不可能成立，置 null
  for (const k of ["meterW", "meterH"]) {
    if (spec[k] != null && !numberHasMeterUnit(spec[k], raw)) spec[k] = null;
  }
  for (const k of ["width", "height"]) {
    if (spec[k] != null && Number(spec[k]) < 16) spec[k] = null;
  }
  for (const k of ["gridW", "gridH"]) {
    if (spec[k] != null) {
      const gn = Number(spec[k]);
      if (!Number.isInteger(gn) || gn < 1 || gn > 999 || !numberInOriginal(spec[k], raw) || numberHasMeterUnit(spec[k], raw)) spec[k] = null;
    }
  }
  if (spec.side !== "sync" && spec.side !== "async") spec.side = null; // 值白名单
  if (spec.side === "sync" && !/同步|视频处理器|处理器|VP/i.test(raw)) spec.side = null; // 原文须真有同步语义
  if (spec.side === "async" && !/异步|播放盒|异步卡/i.test(raw)) spec.side = null;       // 原文须真有异步语义
  return spec;
}
// 模型补抽：返回与 extractSpec 同形的 spec（模型用 pixelsW/pixelsH/sync 友好名，这里映射回内部 width/height/side）；任何失败返回 null
async function extractSpecLLM(rawText) {
  const r = await llm.chat({ system: SPEC_EXTRACT_SYSTEM, user: String(rawText || ""), json: true, temperature: 0, maxTokens: 150 });
  if (!r || typeof r !== "object") return null;
  const toNum = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
  const spec = {
    meterW: toNum(r.meterW), meterH: toNum(r.meterH),
    width: toNum(r.pixelsW), height: toNum(r.pixelsH),
    pitch: toNum(r.pitch), area: toNum(r.area), scan: toNum(r.scan),
    gridW: toNum(r.gridW), gridH: toNum(r.gridH),
    side: r.sync === "sync" ? "sync" : r.sync === "async" ? "async" : null,
    moduleGrid: false,
  };
  return guardSpec(spec, String(rawText || ""));
}
// 抹掉原句里各种语序的物理尺寸碎片（6米宽 / 宽6米 / 3m高 …），便于用模型归一后的规范尺寸替换，避免两种语序互相抢
function stripMeterPhrase(text) {
  return String(text)
    .replace(/\d+(?:\.\d+)?\s*[×x*]\s*\d+(?:\.\d+)?\s*(?:米|m)\s*(?:宽|高|长)?/gi, " ") // 先整体抹“6×3米”连乘尺寸
    .replace(/(?:宽|高|长)?\s*\d+(?:\.\d+)?\s*(?:米|m)\s*(?:宽|高|长)?/gi, " ");          // 再抹单个“宽6米/6米宽”
}
// 正则两种语序仍抽不全时，用模型补抽结果重建“引擎认识的规范计算文本”：
//  · 完整尺寸对（物理米数 / 像素点数，且已双双通过原文校验）→ 抹掉原错位尺寸、换成规范“宽w米高h米 / 整屏W×H点”；
//  · pitch/scan/area/同异步等单值只补确定性 base 缺失的，绝不覆盖；
//  · 末道保险：重建后仍不够起步尺寸就原样返回（回退反问），绝不把半吊子文本喂给引擎。
// 正则已够 / 未配模型 / 模型超时失败 → 原样返回，现状零影响。
async function augmentSpecText(text) {
  text = normalizeAxisText(text);
  const base = extractSpec(text);
  if (enoughToEstimate(base)) return text;
  if (!llm.enabled()) return text;
  let add = null;
  try { add = await extractSpecLLM(text); } catch { add = null; }
  if (!add) return text;
  let out = text;
  if (add.meterW && add.meterH) out = `${stripMeterPhrase(out)} 宽${add.meterW}米高${add.meterH}米`;
  else if (add.width && add.height) out = `${stripMeterPhrase(out)} 整屏${add.width}×${add.height}点`;
  else if (add.gridW && add.gridH) out = `${out} 宽${add.gridW}高${add.gridH}`;
  const rest = [];
  if (!base.pitch && add.pitch) rest.push(`P${add.pitch}`);
  if (!base.scan && add.scan) rest.push(`${add.scan}扫`);
  if (!base.area && add.area) rest.push(`${add.area}平米`);
  if (!base.side && add.side === "sync") rest.push("同步视频处理器");
  if (!base.side && add.side === "async") rest.push("异步播放盒");
  out = `${out} ${rest.join(" ")}`.replace(/\s+/g, " ").trim();
  const after = extractSpec(out);
  return enoughToEstimate(after) ? out : text;
}

function describeSpec(spec) {
  return [
    spec.gridW && spec.gridH ? `整屏 ${spec.gridW}列×${spec.gridH}行模组（共${spec.gridW * spec.gridH}张）` : "",
    spec.width && spec.height ? `整屏 ${spec.width}×${spec.height} 点` : "",
    spec.area ? `约 ${spec.area} 平米` : "",
    spec.meterW && spec.meterH ? `宽${spec.meterW}m×高${spec.meterH}m` : "",
    spec.pitch ? `P${spec.pitch}` : "",
    spec.scan ? `${spec.scan}扫` : "",
    spec.side === "async" ? "异步方案" : spec.side === "sync" ? "同步方案" : "",
  ].filter(Boolean).join("、");
}

// 把历史消息归一为引擎要的“纯文本字符串数组”。只取用户说过的话（含此前给的宽高/P几/同异步），
// 不把助手自己上一轮的方案文本回灌，否则引擎会把已输出的数量再解析一遍、误判数据冲突
function historyToTexts(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((h) => {
      if (h && typeof h === "object") {
        if (h.role && h.role !== "user") return ""; // 只保留用户消息
        return String(h.content || h.message || h.text || "");
      }
      return String(h || ""); // 兼容纯字符串历史（企微等老格式）
    })
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(-6); // 只取最近6轮，避免无关旧话干扰
}

// ---------------------------------------------------------------------------
// 多轮续算只继承“配单规格”（尺寸/P几/米数/排列/同异步等）。售前裸型号/裸芯片/纯故障现象
// 这类不含任何配单规格信号的历史消息不并入选型文本——否则上一轮售前查过 R708，下一轮配单
// 会被当成“客户指定 R708”，导致同一面屏随聊天历史配出不同接收卡（BOM 不可复现）。当前轮消息永远保留。
function hasOrderingSpecSignal(text) {
  const s = normalizeAxisText(normalizeOrderText(String(text || "")));
  return (
    /\d{2,5}\s*[×x*]\s*\d{2,5}/.test(s) || // 像素/模组分辨率相乘（1920x1080、模组64x64）
    /(?:宽|高|长|横向|纵向|横|竖|列|行|排)\s*\d/.test(s) || // 方向词+数字（10宽9高 / 宽6米）
    /米|公尺|\d+(?:\.\d+)?\s*m(?![A-Za-z])/.test(s) || // 物理尺寸（米/m）
    /P\s*\d/i.test(s) || // 点间距 P几
    /\d\s*扫/.test(s) || // 扫描方式（1/16扫）
    /平米|平方|㎡|m2/i.test(s) || // 面积
    /\d+\s*(?:张|块|排|列|行|组|片|个)/.test(s) || // 模组排列量词（10列6行、几张卡）
    /同步|异步|播放盒|视频处理器|处理器/.test(s) || // 方案类型（含流程按钮归一后的“同步视频处理器”）
    /分辨率|像素|\d{3,5}\s*点/.test(s) || // 像素点数
    /怎么配|配单|配屏|选型|几张卡|多少张|整屏|屏体/.test(s) // 明确配单意图
  );
}
function orderingHistoryTexts(history) {
  return historyToTexts(history).filter(hasOrderingSpecSignal);
}

// ---------------------------------------------------------------------------
// 2-a. 自然语言入口（企业微信 / AI 框）：对齐 handleOrdering(message, history)
// ---------------------------------------------------------------------------
// 点选续问的内部流程标记（前端/企微点按钮回传；界面只显示中文 label，不展示标记本身）
// ADD_MODULE=补型号/P值；ACCEPT_PROVISIONAL=按暂定；PICK_ASYNC/SYNC=首轮选同异步；ADJUST=调整已出方案
const ORDER_TAG_RE = /\[(ORDER_ADD_MODULE|ORDER_ACCEPT_PROVISIONAL|ORDER_PICK_ASYNC|ORDER_PICK_SYNC|ORDER_ADJUST)\]/;
// 长条异步播放盒「场景切换」：通用A系列(默认)/会议屏(H6,H8)/海报屏(B6L,A6L,B8L)，1:1 复刻官网场景过滤；点按钮带上文尺寸重算
const SCENE_TAG_RE = /\[(SCENE_OFFICIAL|SCENE_GENERIC|SCENE_MEETING|SCENE_POSTER)\]/;
const SCENE_TAG_TO_KEY = { SCENE_OFFICIAL: "official", SCENE_GENERIC: "generic", SCENE_MEETING: "meeting", SCENE_POSTER: "poster" };
// 常见点间距快捷项：点了等于客户补了一个 P 值，合并上文已有条件后直接重算转正式
const PITCH_QUICK_OPTIONS = ["P2", "P2.5", "P3", "P4", "P5"]
  .map((p) => ({ label: p, value: `[ORDER_ADD_MODULE] ${p}` }));
// 客户自由输入里是否像一个模组型号（字母+数字组合），用来判断点“补充型号”时是否真的补到了料
function looksLikeModuleModel(text) {
  const s = String(text || "")
    .replace(/P\s*\d(?:\.\d{1,2})?/gi, "") // 先去掉点间距 P2/P3，避免它和宽高数字黏成“P2105”被误判成型号
    .replace(
      /整屏|宽|高|点|像素|异步|同步|播放盒|视频处理器|处理器|模组|型号|完整|补充|转正式|按暂|定方案|即可|的|了|用|是|，|。|\s/g,
      "",
    );
  return /[A-Za-z][A-Za-z0-9-]{1,}\d|\d{2,}[A-Za-z]/.test(s);
}
// 历史文本里可能残留内部流程标记：选边标记翻译成中文（供规格解析继承同/异步），其余标记清掉，
// 保证进入规格解析与选型引擎的文本是干净自然语言（加载时归一，内部标记不外泄到计算/回答）
function normalizeOrderText(text) {
  return String(text || "")
    .replace(/\[ORDER_PICK_ASYNC\]/g, " 异步播放盒 ")
    .replace(/\[ORDER_PICK_SYNC\]/g, " 同步视频处理器 ")
    .replace(/\[[A-Z_]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// “调整方案”时，本轮明确改的维度（同/异步、P几、宽高）要覆盖历史里的旧值，其余条件保留；
// 先从合并文本剔除被改维度的旧措辞、再补回本轮新值，避免“历史异步 + 本轮同步”同时存在导致解析回旧值
function applyDeltaToMerged(merged, delta, cleanMessage, appendText) {
  let text = String(merged || "");
  if (delta.side === "sync") text = text.replace(/异步播放盒|异步卡|异步/g, " ");
  if (delta.side === "async") text = text.replace(/同步视频处理器|视频处理器|同步处理器|同步/g, " ");
  if (delta.pitch) text = text.replace(/P\s*\d(?:\.\d{1,2})?/gi, " ");
  if (delta.width && delta.height) text = text.replace(/\d{2,5}\s*[×x*]\s*\d{2,5}/g, " ");
  if (delta.moduleGrid) text = text.replace(GRID_STRIP_REGEX, " "); // 本轮给了排列，剔除历史旧排列（各种语序）
  text = `${text} ${normalizeOrderText(appendText !== undefined ? appendText : cleanMessage)}`.replace(/\s+/g, " ").trim();
  return text;
}

// 本轮只改宽/高中一维（像素点）时，沿用历史另一维、补成完整整屏像素；先剔除历史旧整屏像素表述，避免新旧两套尺寸共存。
// 仅当历史确有完整像素双维时生效；历史只有米数/排列（无像素双维）则不混用，交回原流程澄清或换算。
function applySingleAxis(merged, delta, histSpec) {
  const hasW = Boolean(delta.width), hasH = Boolean(delta.height);
  if (hasW === hasH) return null; // 两维都给走双维覆盖；两维都没给不适用
  const keepW = hasW ? delta.width : (histSpec && histSpec.width);
  const keepH = hasH ? delta.height : (histSpec && histSpec.height);
  if (!keepW || !keepH) return null;
  let t = String(merged || "");
  t = t.replace(/\d{3,5}\s*[×x*]\s*\d{3,5}\s*(?:px|像素|点)?/g, " "); // 旧整屏双维像素（模组点数多为2位，不匹配，保留）
  t = t.replace(/(?:宽度|宽|长)\s*\d{3,5}(?!\s*(?:米|[mM]|张|块|排|列|行|组|片|模组))\s*(?:点|像素|px)?/g, " ");
  t = t.replace(/(?:高度|高)\s*\d{3,5}(?!\s*(?:米|[mM]|张|块|排|列|行|组|片|模组))\s*(?:点|像素|px)?/g, " ");
  t = `${t} 整屏 ${keepW}×${keepH} 点`;
  return t.replace(/\s+/g, " ").trim();
}

async function handleOrdering(message, history) {
  const raw = String(message || "");
  const tagM = raw.match(ORDER_TAG_RE);
  const orderTag = tagM ? tagM[1] : "";
  const cleanMessage = normalizeAxisText(raw.replace(/\[[A-Z_]+\]/g, "").trim()); // 入口先维度归一，后续剔除/合并/引擎全程见标准语序
  // 多轮续算：把最近历史里用户给过的宽高/P几/同异步与本轮合并后再解析（点按钮的残句靠上文续上）
  const allTexts = historyToTexts(history); // 全量原始用户历史，仅“调整方案”分支做原文剔除用
  const texts = orderingHistoryTexts(history); // 合并选型只取含配单规格信号的历史，售前/售后裸型号不污染选型
  const merged = [...texts, cleanMessage].filter(Boolean).map((x) => normalizeAxisText(normalizeOrderText(x))).join(" ");
  const spec = extractSpec(merged);
  // 多屏工程（一主两副/会议厅+门口竖屏等多块独立屏）：本轮话里识别命中即转人工，不进单屏引擎；
  // 只看本轮 cleanMessage——客户按引导单独补发某一块屏时不被旧多屏历史误拦，可逐块正常估算
  if (multiScreen.detectMultiScreenHint(cleanMessage)) return escalateMultiScreen();
  // 超大单屏：原文整屏像素超过最大拼接机箱带载（含引擎解析器会丢弃超大数字的情况）→ 直接转人工，不进引擎出半成品
  if (multiScreen.detectOversizedPixels(cleanMessage)) return escalateOversized();
  // 异形 / 造型屏（弧形、折角、曲面、圆柱等非规则矩形）：规则矩形引擎不适用，直接转人工
  if (multiScreen.detectIrregularShapeHint(cleanMessage)) return escalateIrregular();
  // 第三道·大模型语义兜底：确定性没判出但措辞像多屏工程时，让模型只切分几块屏（不选型/不写数字结论）；
  // 高置信且数出≥2块并有位置/原文尺寸佐证才采纳，模型失败或证据不足自动回退单屏
  const llmMulti = await multiScreenLLM.detectMultiScreenLLM(cleanMessage);
  if (llmMulti === "multi-screen") return escalateMultiScreen();

  // —— 场景切换（长条异步播放盒）：只取上文已给尺寸重算；本轮“会议屏/海报屏”中文无尺寸意义，不并进引擎文本 ——
  const sceneTagM = raw.match(SCENE_TAG_RE);
  if (sceneTagM) {
    const sceneKey = SCENE_TAG_TO_KEY[sceneTagM[1]] || "generic";
    const histMerged = texts.length
      ? texts.map((x) => normalizeAxisText(normalizeOrderText(x))).join(" ")
      : merged;
    const sceneSpec = extractSpec(histMerged);
    if (!enoughToEstimate(sceneSpec)) return needSizeClarify(sceneSpec);
    return computeOrdering(histMerged, sceneSpec, { acceptedProvisional: false, scene: sceneKey });
  }

  // —— 流程按钮：首轮选定同/异步（方案类型确定，只差整屏大小，递进式追问而不是重问一遍）——
  if (orderTag === "ORDER_PICK_ASYNC" || orderTag === "ORDER_PICK_SYNC") {
    const pickedSide = orderTag === "ORDER_PICK_ASYNC" ? "async" : "sync";
    spec.side = pickedSide;
    if (enoughToEstimate(spec)) {
      // 整屏尺寸/排列已在上下文里：剔除对侧旧措辞、补入所选边，直接定型重算（点一下就出最终方案）
      const sideText = pickedSide === "async" ? "异步播放盒" : "同步视频处理器";
      const mergedSide = applyDeltaToMerged(merged, { side: pickedSide }, cleanMessage, sideText);
      return computeOrdering(mergedSide, extractSpec(mergedSide), { acceptedProvisional: false });
    }
    return needSizeClarify(spec);
  }

  // —— 流程按钮①：补充模组型号转正式 ——
  if (orderTag === "ORDER_ADD_MODULE") {
    // 本轮文本里出现的点间距（网页会把原问题拼回，可能同时含旧P与新P）；与历史不同的那个才是这轮新补的
    const histSpec = extractSpec(historyToTexts(history).map(normalizeOrderText).join(" "));
    const pList = (normalizeOrderText(cleanMessage).match(/P\s*\d(?:\.\d{1,2})?/gi) || [])
      .map((x) => x.replace(/\s+/g, "").toUpperCase());
    const histP = histSpec.pitch ? ("P" + String(histSpec.pitch).toUpperCase()) : ""; // extractSpec 的 pitch 不带 P，比较前补齐口径
    const newPitch = pList.find((p) => !histP || p !== histP) || "";
    const gotNewPitch = Boolean(newPitch);
    const gotNewModule = looksLikeModuleModel(cleanMessage);
    // 只是点了“补型号转正式”、本轮没附新料 → 只做一次简短引导，不重算、不把上一轮方案原样重复
    if (!gotNewPitch && !gotNewModule) {
      const have = describeSpec(spec);
      const pitchAsk = spec.pitch ? "" : "，或点间距（也可直接点下面的 P 值）";
      const q = [
        have ? `已记住你前面给的条件（${have}），这些不用重发。` : "好的，已有条件我先记住了。",
        `现在只需要发我模组完整型号 / 配置文件名${pitchAsk}；知道模组分辨率、物理尺寸、接口也可以一并发。`,
        "拿到后我直接锁定正式带载、接收卡/处理器数量和组网拓扑。",
      ].join("\n");
      return {
        status: "clarify",
        needClarify: true,
        model: "local-ordering",
        clarifyQuestion: q,
        reply: q,
        quickOptions: spec.pitch ? [] : PITCH_QUICK_OPTIONS,
        extracted: spec,
      };
    }
    // 本轮改了点间距：把合并文本里旧 P 值统一换成新 P，避免新旧共存又解析回旧值；其余条件沿用
    let mergedCalc = merged;
    if (gotNewPitch) {
      mergedCalc = (merged.replace(/P\s*\d(?:\.\d{1,2})?/gi, " ") + " " + newPitch).replace(/\s+/g, " ").trim();
    }
    return computeOrdering(mergedCalc, extractSpec(mergedCalc), { acceptedProvisional: false });
  }

  // —— 流程按钮②：就按暂定方案（不再补料，直接出方案）——
  if (orderTag === "ORDER_ACCEPT_PROVISIONAL") {
    if (!enoughToEstimate(spec)) return needSizeClarify(spec);
    // 有整屏大小但缺点间距/模组型号时，带载表匹配不出接收卡，“按暂定”也给不出可交付选型，先补这一项
    if (!spec.pitch && !looksLikeModuleModel(merged)) return needPitchClarify(spec, merged);
    return computeOrdering(merged, spec, { acceptedProvisional: true });
  }

  // —— 流程按钮③：调整已出方案。只说“要调整”→问清改哪项；带了具体改动（换同异步/P几/尺寸）→合并上文重算 ——
  // —— 流程按钮③：调整已出方案。只说“要调整”→问清改哪项；带了具体改动（换同异步/P几/尺寸）→合并上文重算 ——
  if (orderTag === "ORDER_ADJUST") {
    // “改没改、改什么”只看本轮指令：网页会把历史原问题拼回本句，先把这些历史原问题剔除，
    // 剩下的才是这次新点的换边/P几/尺寸，避免把原问题自带参数误判成新改动而把同一方案重算一遍
    let instruction = normalizeOrderText(cleanMessage);
    allTexts.forEach((h) => {
      const hn = normalizeOrderText(h);
      if (hn && hn.length >= 6) instruction = instruction.split(hn).join(" "); // 过短历史碎片不参与剔除，防止误删指令字符
    });
    instruction = instruction.replace(/\s+/g, " ").trim();
    const delta = extractSpec(instruction);
    const histSpecAdj = texts.length ? extractSpec(texts.map((x) => normalizeAxisText(normalizeOrderText(x))).join(" ")) : null;
    const singleAdj = (Boolean(delta.width) !== Boolean(delta.height)) ? applySingleAxis(merged, delta, histSpecAdj) : null;
    const hasDelta = Boolean(
      delta.side || delta.pitch || (delta.width && delta.height) || delta.area || delta.moduleGrid || singleAdj,
    ) || looksLikeModuleModel(instruction);
    if (!hasDelta) return needAdjustClarify(spec);
    // 本轮改的维度覆盖旧值、其余条件沿用，再用无冲突文本重算（保证引擎解析到的是新选择）
    const fixedMerged = singleAdj || applyDeltaToMerged(merged, delta, cleanMessage, instruction);
    return computeOrdering(fixedMerged, extractSpec(fixedMerged), { acceptedProvisional: false });
  }

  // —— 普通自然语言配单 ——
  // 通用规则：本轮明确给出的维度（同/异步、P几、宽高、面积、模组排列）一律覆盖历史同维度旧值，其余沿用；
  // 不要求“换成/改成”关键词——客户直接报一组新参数时以最新说的为准，避免被上一轮旧值盖过
  const delta = extractSpec(normalizeOrderText(cleanMessage));
  const histSpecOnly = texts.length ? extractSpec(texts.map((x) => normalizeAxisText(normalizeOrderText(x))).join(" ")) : null;
  const singleAxisMerged = (texts.length > 0 && Boolean(delta.width) !== Boolean(delta.height))
    ? applySingleAxis(merged, delta, histSpecOnly) : null;
  const hasDelta = Boolean(
    delta.side || delta.pitch || (delta.width && delta.height) || delta.area || delta.moduleGrid || singleAxisMerged,
  );
  // 单轮（无历史规格）没有旧值要覆盖：直接用归一后的完整当前消息；对它删数字再追加只会造出残缺引导词+重复片段，
  // 让引擎把裸“整屏/模组”引导词跨片段错配到别的数字（如“模组64x64 整屏1920x1080”被误当成整屏64x64）。多轮改尺寸才走 applyDelta。
  let mergedCalc = singleAxisMerged
    || ((hasDelta && texts.length > 0) ? applyDeltaToMerged(merged, delta, cleanMessage) : merged);
  // 确定性正则抽不全（数字说在方向词前、口语/错字）时，模型把缺失维度补成引擎认识的标准措辞；
  // 正则已够 / 未配模型 / 模型失败 → augmentSpecText 原样返回，结果与现状逐字一致
  mergedCalc = await augmentSpecText(mergedCalc);
  const specCalc = extractSpec(mergedCalc);
  if (!enoughToEstimate(specCalc)) return needSizeClarify(specCalc);
  return computeOrdering(mergedCalc, specCalc, { acceptedProvisional: false });
}

// 缺起步尺寸时一次性说清要补什么；已选同/异步时只追问尺寸并确认所选，递进不重问
function needSizeClarify(spec) {
  const sidePicked = spec && spec.side;
  const head = sidePicked === "async" ? "好的，已按异步（播放盒/异步卡）方案。"
    : sidePicked === "sync" ? "好的，已按同步（视频处理器）方案。"
    : "配单先要有整屏大小。";
  const ask = sidePicked
    ? "现在只差整屏大小：发 ① 宽×高的像素点数（如 1920×1080 点），或屏幕尺寸+点间距（如宽6米×高3米、P3），我立刻出接收卡/处理器数量、网口分配和选型。"
    : "请发：① 整屏宽×高的像素点数（如 1920×1080 点），或屏幕尺寸+点间距（如宽6米×高3米、P3）；② 用异步卡还是视频处理器（可直接点下面）。信息齐了我直接给接收卡/处理器数量、网口分配和选型清单。";
  const q = `${head}\n${ask}`;
  return {
    status: "clarify",
    needClarify: true,
    model: "local-ordering",
    clarifyQuestion: q,
    reply: q,
    quickOptions: sidePicked ? [] : [
      { label: "异步（播放盒/异步卡）", value: "[ORDER_PICK_ASYNC]" },
      { label: "同步（视频处理器）", value: "[ORDER_PICK_SYNC]" },
    ],
    extracted: spec,
  };
}

// 客户点“调整方案”但还没说改哪项：复述当前条件、给出可直接点的改动方向，不重算一遍旧方案
function needAdjustClarify(spec) {
  const have = describeSpec(spec);
  const q = [
    have ? `当前方案是按（${have}）算的，没提到的条件保持不变。` : "好的，我们来调整方案。",
    "直接说要改哪一项即可，例如“改成 P4”“换成同步处理器”“宽改成 2560 点”“加 10% 备用接收卡”；也可以点下面快速切换，我立刻重算清单和拓扑。",
  ].join("\n");
  return {
    status: "clarify",
    needClarify: true,
    model: "local-ordering",
    clarifyQuestion: q,
    reply: q,
    quickOptions: [
      { label: "换成同步处理器", value: "[ORDER_ADJUST] 换成同步视频处理器" },
      { label: "换成异步播放盒", value: "[ORDER_ADJUST] 换成异步播放盒" },
    ],
    extracted: spec,
  };
}

// 已有整屏大小、只差一个点间距/模组型号时的简短补料引导（不把上一轮方案原样重复）
// 仅用于“缺料追问”时复述客户已点名的接收卡/主控（不参与选型、不进 BOM，避免裸数字误判）：
// 接收卡须“数量+张 + 可选R + 卡型号 + 卡”或显式 R 型号（型号白名单与引擎 preferredCard 对齐，不含播放盒 B6）；
// 主控须带 VP/KV 前缀——裸“620”有 VP620/其它歧义，不猜（ pitch 补齐后引擎按带载推荐，客户坚持再点名）。
function detectNamedDevices(text) {
  const t = String(text || "");
  // 型号为捕获组 CARD_CAP（长型号在前，避免 500S/5S 截胡）；数量组=1、型号组=2
  const CARD_CAP = "(5S\\s*PLUS|500S|3210|507T|708|712|716|732|5S)";
  const named = [];
  const cardNum = t.match(new RegExp("(\\d{1,3})\\s*张?\\s*(?:R\\s*)?" + CARD_CAP + "\\s*(?:接收卡|控制卡|卡)", "i"));
  const cardPlain = t.match(new RegExp("\\bR\\s*" + CARD_CAP + "\\b", "i"));
  const cm = cardNum || cardPlain;
  if (cm) {
    const card = String(cm[2] || "").toUpperCase().replace(/\s+/g, "");
    if (card) {
      const cardName = "R" + card;
      const qty = cardNum ? Number(cardNum[1]) : 0;
      named.push(qty > 0 ? `${cardName} 接收卡 ${qty} 张` : `${cardName} 接收卡`);
    }
  }
  const proc = t.match(/\b(VP|KV)\s?(\d{3,4}[A-Z]?)\b/i);
  if (proc) named.push(`${proc[1].toUpperCase()}${proc[2].toUpperCase()} 主控`);
  return named;
}

// 已有起步尺寸、只差一个点间距/模组型号时的补料引导：精准复述已听懂的排列与点名设备，只追问 P几（拍板：缺点间距必须问）
function needPitchClarify(spec, text) {
  const have = describeSpec(spec);
  const named = detectNamedDevices(text || "");
  const known = [have, named.length ? `你点名的 ${named.join("、")}` : ""].filter(Boolean).join("；");
  const gridKnown = Boolean(spec.gridW && spec.gridH);
  const head = known ? `你给的${known}我都记下了，这些不用重发。` : "已有条件我先记住了。";
  const ask = gridKnown
    ? "现在只差一个点间距 P 几（可直接点下面），或发单张模组的分辨率 / 完整型号——知道每张模组多少点，才能算每张接收卡带几列几行、把接线图画准。"
    : "要出方案还差最关键的一项：点间距 P 几（可直接点下面），或模组完整型号 / 配置文件名。";
  const q = [
    head,
    ask,
    "给到后我立刻出接收卡/处理器数量、网口分配和组网拓扑。",
  ].join("\n");
  return {
    status: "clarify",
    needClarify: true,
    model: "local-ordering",
    clarifyQuestion: q,
    reply: q,
    quickOptions: PITCH_QUICK_OPTIONS,
    extracted: spec,
  };
}

// 多屏 / 超大工程：在线不自动配，大方引导联系人工，并给“拆成单块屏逐块估算”的退路（网页走 escalate 气泡、企微走 reply）
function escalateHuman(kind, msg) {
  return { status: "escalate", model: "local-ordering", needClarify: false, message: msg, reply: msg, meta: { route: "ordering", escalate: kind } };
}
function escalateMultiScreen() {
  const msg = [
    "你发来的是多块独立屏的工程（如一主两副、会议厅屏、门口竖屏等），涉及多套控制系统分别组网；在线自动配单容易把几块屏的尺寸算混、把整屏分辨率误当模组，反而给错设备。为保证准确，这类多屏工程请联系人工客服配单。",
    "你也可以把其中【一块屏】的“宽×高像素（或宽高米数）+ 点间距 P 几 + 同步/异步”单独发我，我先逐块帮你估算接收卡和主控数量。",
  ].join("\n");
  return escalateHuman("multi-screen", msg);
}
function escalateOversized() {
  const msg = [
    "这块屏整屏分辨率较大，已超出在线自动配单中单台处理器 / 最大拼接机箱的带载范围，需要多机或拼接机箱组网，自动计算容易出错。为避免给错设备，这种超大分辨率工程请联系人工客服配单。",
    "如要先做初步估算，可把这一块屏的宽×高像素、点间距 P 几、同步/异步发我，我先帮你估算接收卡数量，正式组网由人工确认。",
  ].join("\n");
  return escalateHuman("oversized", msg);
}
function escalateIrregular() {
  const msg = [
    "你描述的是弧形、折角、曲面或圆柱 / 球形等非规则矩形的造型屏，涉及弯折走线、多面组网和定制钢结构；在线按规则矩形自动配单会把模组数量、网口分布和连屏方式算错。为保证设备和连接图准确，这类异形 / 造型屏请联系人工客服配单。",
    "如要先做初步估算，可把每一个直面的宽×高、点间距 P 几、同步/异步分别发我，我先按各直面帮你估算接收卡数量，弯折与组网由人工出正式方案。",
  ].join("\n");
  return escalateHuman("irregular-shape", msg);
}

// 官方选型工具「拼接处理器」场景总点数硬上限（reference/official-selection-tool/official-scene-limits.json: splicer.maxPoints=174800000）。
// 官方能在该场景自动出 VP8000M/E 拼接方案，我们同口径自动配；超过这个点（需多机箱、官方也不自动出）才转人工。
const OFFICIAL_SPLICER_MAX_POINTS = 174800000;
// 拼接方案网口明细超过该条数时，文字回复只保留汇总+头尾几口，完整逐口走线交给连接拓扑图 / HDSet 连屏文件（避免企微纯文本刷屏）。
const PORT_LIST_FULL_LINES = 12;
function collapseSplicerPorts(replyText) {
  const lines = String(replyText || "").split(/\r?\n/);
  const detailIdx = [];
  lines.forEach((l, i) => { if (/^\s*-\s*网口\d+[：:]/.test(l)) detailIdx.push(i); });
  if (detailIdx.length <= PORT_LIST_FULL_LINES) return replyText;
  const head = detailIdx[0];
  const tail = detailIdx[detailIdx.length - 1];
  const KEEP_HEAD = 6, KEEP_TAIL = 3;
  const headLines = lines.slice(0, head).concat(lines.slice(head, head + KEEP_HEAD));
  const omitted = detailIdx.length - KEEP_HEAD - KEEP_TAIL;
  const ellipsis = `- …（其余 ${omitted} 路网口按蛇形级联、每口≤65.536万点；完整分区与逐口走线见连接拓扑图，正式施工以 HDSet 连屏文件 / 人工复核为准）`;
  const tailLines = lines.slice(tail - KEEP_TAIL + 1); // 含最后 KEEP_TAIL 条明细及其后的模组尺寸/规格/FAULT_HOOK
  return headLines.concat(ellipsis, tailLines).join("\n");
}

// 计算内核适配：merged 为已合并最近上下文的完整文本；acceptedProvisional=客户已确认按暂定，不再催补
function computeOrdering(merged, spec, { acceptedProvisional = false, scene = "official" } = {}) {
  let calcText = normalizeAxisText(merged);
  // 分离宽高口语（“宽N点高M点 / 高N点宽M点”，整屏像素）确定性归一为引擎认识的“整屏N×M点”：
  // 正则抽不到这种语序、引擎解析器还会把超大数字当噪声丢弃，统一在内核入口补齐（仅当原解析没拿到完整宽高对）
  {
    const _seps = multiScreen.extractSeparatedWH(calcText);
    const _sep = Array.isArray(_seps) && _seps.length ? _seps[_seps.length - 1] : null;
    if (_sep && _sep.w && _sep.h && !(spec && spec.width && spec.height)) {
      calcText = `${calcText} 整屏${_sep.w}×${_sep.h}点`;
    }
  }
  const out = engine.answerWithContext([calcText]);
  const result = out.result || {};
  const state = result.resultState || result.status || "provisional";

  // 引擎正文（含方案/暂定条件/网口分配）；客户确认按暂定时加一句承接，说明后续仍可转正式
  let reply = String(out.reply || "").trim();
  if (acceptedProvisional && state !== "formal") {
    reply = "好的，先按当前已知条件给你方案，后续拿到完整型号或整屏尺寸随时发我更新：\n" + reply;
  }
  // 正式配单答案后不再机械追加“花屏闪屏发我走售后”尾巴（已给确定答案不硬塞引导）；故障入口仍保留在 followUp 选项中。

  // ① 拼接机箱（VP8000M/E 输出板网格组网）：以官方选型工具「拼接处理器」场景上限 1.748 亿点为准——
  //    总点 ≤ 上限（官方能自动出 VP8000 拼接方案）则照常自动配，仅把超长逐网口文字清单收敛（完整走线看拓扑图/连屏文件）；
  //    总点 > 上限（需多机箱级联、官方也不自动出）才转人工，避免把输出板分组/级联算错。
  if (result.ok && result.isSplicer) {
    const splicerTotal = Number(result.totalPx) || 0;
    if (splicerTotal > OFFICIAL_SPLICER_MAX_POINTS) {
      return escalateHuman("splicer-oversized", [
        "这块屏整屏点数已超出在线自动配单中拼接处理器场景的上限（约 1.75 亿点），需要多台拼接机箱级联组网，自动计算容易把输出板分组和网线级联算错。为避免给错设备，这种超大规模拼接工程请联系人工客服出正式连屏方案。",
        "如只要先估接收卡数量，可把这一块屏的宽×高像素、点间距 P 几、同步/异步发我，我先帮你估卡数，正式组网由人工确认。",
      ].join("\n"));
    }
    reply = collapseSplicerPorts(reply);
  }

  // ② 长条（条形/门头/横幅/货架/橱窗）屏：命中走独立“屏幕打折”异步选型（CX6/C16L/A系列/B8L/A8/同步VPX），
  //    不改 19 万行引擎；盖不住或要多机时模块自行返回转人工。规整矩阵屏 match:false，原样落回下面常规逻辑。
  const strip = stripFolding.tryStrip(result, calcText, { scene });
  if (strip.match) {
    if (!strip.covered) {
      if ((strip.escalateKind || "") === "scene-oversized") {
        // 该场景系列盖不住：把其它盖得住的场景给客户一键切换，都盖不住才只剩调整/人工
        const av0 = strip.sceneAvail || {};
        const SCENE_BTN0 = {
          official: { label: "按官方默认配", value: "[SCENE_OFFICIAL] 官方默认" },
          generic: { label: "按通用A系列配", value: "[SCENE_GENERIC] 通用A系列" },
          meeting: { label: "按会议屏配(H6/H8)", value: "[SCENE_MEETING] 会议屏" },
          poster: { label: "按海报屏配(B6L/A6L/B8L)", value: "[SCENE_POSTER] 海报屏" },
        };
        const altSceneOptions = ["official", "generic", "meeting", "poster"]
          .filter((k) => k !== scene && av0[k]).map((k) => SCENE_BTN0[k]);
        return {
          status: "escalate",
          needClarify: false,
          model: "local-ordering",
          reply: strip.message,
          message: strip.message,
          followUp: {
            tip: altSceneOptions.length ? "也可以换一个场景重算，看更大机型能否带得动：" : "该尺寸建议联系人工拆段、多机级联：",
            options: [
              ...altSceneOptions,
              { label: "调整方案", value: "[ORDER_ADJUST] 调整方案" },
            ],
          },
          extracted: spec,
          meta: { route: "ordering", escalate: "scene-oversized", scene, spec: describeSpec(spec) },
        };
      }
      return escalateHuman(strip.escalateKind || "strip-oversized", strip.message);
    }
    let stripReply = String(strip.reply || "").trim();
    // 长条正式方案不追加售后尾巴；故障分流入口仅在"缺整屏信息、意图不明"时保留。
    const stripScene = (strip.ordering && strip.ordering.strip && strip.ordering.strip.scene) || scene || "official";
    const SCENE_NAME = { official: "官方默认", generic: "通用 A 系列", meeting: "会议屏", poster: "海报屏" };
    // 场景按钮只给「该场景池确实盖得住」的，盖不住的不显示（避免客户点了才提示超限）；播放盒类方案才有
    const avail = (strip.ordering && strip.ordering.strip && strip.ordering.strip.sceneAvail) || {};
    const SCENE_BTN = {
      official: { label: "按官方默认配", value: "[SCENE_OFFICIAL] 官方默认" },
      generic: { label: "按通用A系列配", value: "[SCENE_GENERIC] 通用A系列" },
      meeting: { label: "按会议屏配(H6/H8)", value: "[SCENE_MEETING] 会议屏" },
      poster: { label: "按海报屏配(B6L/A6L/B8L)", value: "[SCENE_POSTER] 海报屏" },
    };
    const sceneOptions = ["official", "generic", "meeting", "poster"]
      .filter((k) => k !== stripScene && avail[k]).map((k) => SCENE_BTN[k]);
    return {
      status: "answer",
      needClarify: false,
      model: "local-ordering",
      reply: stripReply,
      followUp: {
        tip: sceneOptions.length
          ? `已按${SCENE_NAME[stripScene] || "通用 A 系列"}算出长条方案；若这块屏用于会议屏 / 海报屏，可一键切换成对应机型重算：`
          : "长条方案已按屏幕打折算出，需要调整参数可点下方：",
        options: [
          ...sceneOptions,
          { label: "调整方案", value: "[ORDER_ADJUST] 调整方案" },
        ],
      },
      extracted: spec,
      ordering: Object.assign({}, strip.ordering, { screen: buildScreenSummary(result) }),
      meta: { route: "ordering", state: "formal", strip: strip.family, scene: stripScene, spec: describeSpec(spec) },
    };
  }

  // 超大分辨率：引擎判定超出单台处理器/最大拼接机箱带载范围 → 不硬算、不追问补料，直接引导人工
  if (multiScreen.isOversizedResult(result, reply)) return escalateOversized();
  // #48 有起步尺寸但缺点间距、引擎未能按 P 假设模组、给不出 BOM：不把引擎“补点间距和整屏宽×高（含模组排数）”的泛问原样抛出
  // （排数客户已给，会显得没听懂）；改为精准复述已知、只追问 P几/单模组分辨率（拍板：缺点间距必须问，否则算不出单卡宽高、画不准拓扑）
  {
    const _hasStart = Boolean((spec.gridW && spec.gridH) || spec.moduleGrid || (spec.width && spec.height) || (spec.meterW && spec.meterH) || spec.area);
    const _assumed = Boolean(result.input && result.input.modulePixelsAssumed);
    const _hasBom = Boolean(result.bom && Array.isArray(result.bom.items) && result.bom.items.length);
    if (state !== "formal" && _hasStart && !spec.pitch && !looksLikeModuleModel(calcText) && !_assumed && !_hasBom) {
      return needPitchClarify(spec, calcText);
    }
  }
  // 按钮逻辑：正式→微调/转故障；已确认暂定→补到型号可转正式/转故障（不再重复“补料·按暂定”那对，避免原地打转）；
  // 普通暂定→补型号转正式 / 按暂定即可。value 带内部标记，点一下即可续问，客户界面只见中文
  let followUp;
  // 客户未说同步/异步：正文已并列给出同步、异步两套（如 VP410C / A6L），不再主动催二选一；
  // 按真实状态走通用引导（formal→微调/故障，暂定→补料/故障）。客户想定型某一侧，走“调整方案→换成同步/异步”或直接打字。
  if (state === "formal") {
    // 方案已正式给出（确定答案）：不再用问号催客户，只把“调整 / 转故障”作为可选下一步入口陈述出来
    followUp = {
      tip: "方案已正式算出，需要调整参数可点下方：",
      options: [
        { label: "调整方案", value: "[ORDER_ADJUST] 调整方案" },
      ],
    };
  } else if (acceptedProvisional) {
    // 客户已确认按暂定：不再反问要不要补料；补料转正式、转故障都作为可选入口陈述
    followUp = {
      tip: "后续补全模组型号或整屏尺寸即可更新为正式方案：",
      options: [
        { label: "补模组型号转正式", value: "[ORDER_ADD_MODULE] 补充模组型号" },
      ],
    };
  } else {
    const missingText = (result.missing || []).join("、");
    // 整屏尺寸客户已给、仅模组完整型号未给（按点间距从带载表预配模组点数，modulePixelsAssumed）：
    // 主动作是“补模组型号转正式”，常规屏与拼接屏通用，不能只给“转故障”。
    const moduleAssumed = Boolean(result.input && result.input.modulePixelsAssumed);
    // 真缺的是整屏尺寸/排列（且不是模组预配）：主动作是打字补整屏（正文已引导），按钮只保留“转故障”分流。
    const trulyNeedScreen = !moduleAssumed
      && /排列|像素宽高|物理尺寸|整屏|宽×高|宽x高/.test(missingText);
    followUp = moduleAssumed
      ? {
        tip: "已按点间距预配模组给出暂定方案，补全模组完整型号 / 配置文件即可转正式：",
        options: [
          { label: "补模组型号转正式", value: "[ORDER_ADD_MODULE] 补充模组型号" },
        ],
      }
      : trulyNeedScreen
        ? {
          tip: "如果这其实是现场故障（花屏/闪屏/连不上），点这里：",
          options: [
            { label: "其实是故障", value: "现场有花屏闪屏等故障现象" },
          ],
        }
        : {
          tip: result.confirmationQuestion || "补齐信息即可出正式方案；也可以先按当前方案。",
          options: [
            { label: "补充信息转正式", value: "[ORDER_ADD_MODULE] 补充模组型号" },
            { label: "按当前方案即可", value: "[ORDER_ACCEPT_PROVISIONAL] 按暂定方案" },
          ],
        };
  }

  return {
    status: "answer",
    needClarify: false,
    model: "local-ordering",
    reply,
    followUp,
    extracted: spec,
    // 结构化结果留给前端/拓扑使用；SVG 暂不下发到企微文本
    ordering: {
      state,
      assumptions: result.assumptions || [],
      bom: result.bom || null,
      screen: buildScreenSummary(result),
      hasTopology: Boolean(renderTopoOnly(result) || out.topologySvg),
      topologySvg: renderTopoOnly(result) || out.topologySvg || null,
      ssm: buildSsmDownload(result),
    },
    meta: { route: "ordering", state, spec: describeSpec(spec) },
  };
}

// ---------------------------------------------------------------------------
// 2-b. 网页结构化表单入口（预留：专业配单页字段一次填齐 → 正式结果）
//   values 字段同旧引擎 createStructuredInput；字段不合法时引擎抛 TypeError，
//   由调用方把 message 转成“请补全某字段”。前端配单页落地后直接调用本函数。
// ---------------------------------------------------------------------------
function handleStructuredOrdering(values = {}) {
  const input = engine.createStructuredInput(values); // 可能 throw TypeError（缺字段/超上限）
  const result = engine.calculate(input);
  return {
    status: "answer",
    needClarify: false,
    model: "local-ordering",
    state: result.resultState || result.status,
    reply: engine.formatReply(result),
    assumptions: result.assumptions || [],
    bom: result.bom || null,
    topologySvg: renderTopoOnly(result) || engine.renderTopologySvg(result) || null,
    result,
  };
}

// 选型清单顶部的屏体摘要（分辨率 / 万点 / 物理尺寸），供前端清单卡片与“下载清单PNG”使用。
// 物理尺寸统一由最终 screenW/H 与点间距反算，保证与分辨率、拓扑自洽（不直接用客户口述米数，避免取整/打折后不一致）。
function buildScreenSummary(result) {
  try {
    if (!result) return null;
    const w = result.screenW, h = result.screenH;
    if (!w || !h) return null;
    const px = result.totalPx || w * h;
    const pitch = result.input && result.input.pitch;
    let mw = null, mh = null;
    if (pitch && isFinite(Number(pitch))) { mw = w * Number(pitch) / 1000; mh = h * Number(pitch) / 1000; }
    const segs = [`${w}×${h}`, `约${(px / 10000).toFixed(2)}万点`];
    if (mw && mh) segs.push(`约${mw.toFixed(3)}m×${mh.toFixed(3)}m`);
    return { text: `屏体：${segs.join("，")}`, w, h, px, meterW: mw ? +mw.toFixed(3) : null, meterH: mh ? +mh.toFixed(3) : null };
  } catch (e) { return null; }
}

// 可导入 HDSet 的连屏文件：只下发「已真机导入验证」的标准模板口数（以 ssm-generator 注释为准）。
// 当前 standard-* 模板仅覆盖 2 口；1/4 口为未真机验证的几何帧模板、3 口及以上无模板，一律返回 null（前端不显示下载），避免给客户导入坏文件。
function buildSsmDownload(result) {
  try {
    const g = ssmGenerator.generate(result);
    const tpl = g && g.ssmMeta && g.ssmMeta.tpl;
    if (!g || !g.ok || !g.ssmXml || !tpl || !String(tpl).startsWith("standard-") || g.ssmMeta.crcBad !== 0) return null;
    const ports = g.summary && g.summary.portCount;
    const cardCount = g.summary && g.summary.cardCount;
    return {
      ssmXml: g.ssmXml,
      fileName: `HDSet连屏_${result.screenW}x${result.screenH}_${ports}口${cardCount}卡.ssm`,
      ports, cardCount
    };
  } catch (e) { return null; }
}

module.exports = {
  handleOrdering,
  handleStructuredOrdering,
  extractSpec,
  enoughToEstimate,
  extractSpecLLM,
  augmentSpecText,
};
