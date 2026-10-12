// ============================================================================
// ordering-multiscreen.cjs —— 多屏 / 超大工程识别（只检测、不计算）
//
// 口径（用户拍板）：客户一段话里塞了多块彼此独立的屏（一主两副 / 宴会厅 + 门口
//   竖屏 / “3块屏分别是…”/ 罗列多个分辨率等），或单块屏分辨率大到超出在线自动
//   配单能力时，自动配单要么把几块屏算混、要么超出拼接机箱带载，硬算必错。这类
//   需求【不自动配】，确定性识别后由上层直接回复“请联系人工客服”，并引导拆成单块
//   屏逐块估算。
//
// 抓“本质信号”而非堆具体措辞：多组整屏像素、多个点间距、≥2 的数量词、并列罗列、
//   主屏/副屏等强结构词、分离写法的宽高、米数换算超大。本文件纯确定性、零模型、零
//   失败面；模型语义兜底在 specialist 层做，失败回退本文件结果。
// ============================================================================

"use strict";

// 在线自动配单能力上限，取自 ordering-engine.cjs 防呆常量（最大拼接机箱 VP8000E-12U）：
// 总点数 199,229,440（约 1.99 亿）/ 单轴 194,560。超过它任何单机箱都盖不住。
const MAX_TOTAL_PX = 199229440;
const MAX_AXIS_PX = 194560;

// 场景 / 位置词（只作佐证；单独出现、无尺寸时不判多屏，避免“给展厅做一块屏”误伤）
const SCENE_LEX = /主屏|副屏|主屏幕|一主|两副|二副|会议厅|宴会厅|大厅|展厅|展馆|走廊|门口|前台|舞台|背景屏|左侧屏|右侧屏|左边屏|右边屏|侧屏|立柱|柱屏|竖屏|横屏|条屏|环屏|弧形屏|拼接墙|电视墙|监控墙|各一|左右.{0,6}屏|第[一二三四1-4][块面]屏|[两二2][块面]屏/;

// “无尺寸也能确定是多屏”的强结构词（主屏/副屏天然相对存在；多屏/分屏即多套）
const STRONG_NO_DIM_LEX = /主屏|副屏|主屏幕|一主两副|一主一|多屏|分屏|多[块面台套个]屏|多个屏|好几[块面台个]屏/;

// ≥2 的数量词 + 屏类名词：3块屏 / 两台显示屏 / 5面屏 / 三个屏 / 4个屏幕 / 几块屏 / 多个屏
// 刻意不含“一”（“一块屏 / 单个屏”是单屏反例）
const QTY_SCREEN_RE = /[两俩二三四五六七八九十\d几多数]\s*[块面台套个]\s*[屏显示幕]/;

// 并列 / 罗列连接词（配合 ≥2 组尺寸佐证多屏）
const CONNECT_RE = /另外|还有|再加|分别是|分别为|各自|每[块面台个]|一[块面台个][^，。；]{0,28}另[一外]|各\s*\d/;

// 遮蔽“模组/单元板 NxN”和“NxN mm”这类【单块屏内部】尺寸，剩下的才是整屏级像素
function maskInnerDims(t) {
  return String(t || "")
    .replace(/\d{1,4}\s*[×x*]\s*\d{1,4}\s*(?:mm|毫米)/gi, " ")
    .replace(/(?:模组|单元板)[^\d]{0,8}\d{2,5}\s*[×x*]\s*\d{2,5}[^，。；;]*?/gi, " ");
}

// 去重整屏级像素尺寸【NxN 相邻写法】（两维 3~6 位、非 mm）。放宽到 6 位覆盖超大整屏。
function screenPixelDims(text) {
  const masked = maskInnerDims(text);
  const dims = masked.match(/\d{3,6}\s*[×x*]\s*\d{3,6}/g) || [];
  return new Set(dims.map((d) => d.replace(/\s/g, "").toLowerCase()));
}

// 不同点间距个数（P2.5 与 P3.076 同时出现 = 至少两类屏）
function distinctPitches(text) {
  const ps = String(text || "").match(/P\s*\d(?:\.\d{1,2})?/gi) || [];
  return new Set(ps.map((x) => x.replace(/\s/g, "").toUpperCase()));
}

// 是否疑似多屏工程：
//  ① 遮蔽模组/mm 后整屏像素尺寸 ≥3 组（单块屏不会列三个分辨率，强结构信号）；
//  ② ≥2 组整屏像素，且出现场景词 / ≥2数量词 / 并列词 / 多个点间距之一；
//  ③ ≥2 个点间距且至少 1 组整屏像素；
//  ④ 没给尺寸但出现主屏副屏 / 多屏分屏 / “N(≥2)块屏”等强结构词（转人工引导逐块给尺寸）。
function detectMultiScreenHint(text) {
  const t = String(text || "");
  const dims = screenPixelDims(t).size;
  const pitches = distinctPitches(t).size;
  if (dims >= 3) return true;
  if (dims >= 2 && (SCENE_LEX.test(t) || QTY_SCREEN_RE.test(t) || CONNECT_RE.test(t) || pitches >= 2)) return true;
  if (pitches >= 2 && dims >= 1) return true;
  if (STRONG_NO_DIM_LEX.test(t) || QTY_SCREEN_RE.test(t)) return true;
  return false;
}

// NxN 相邻写法解析为 {w,h,total}
function parsePixelDims(text) {
  const out = [];
  for (const d of screenPixelDims(text)) {
    const m = d.match(/(\d{3,6})\s*[×x*]\s*(\d{3,6})/);
    if (!m) continue;
    const w = Number(m[1]);
    const h = Number(m[2]);
    out.push({ w, h, total: w * h });
  }
  return out;
}

// 分离写法的整屏宽高：“宽40000点高8000点 / 高1920 宽1080”。两维都 3~6 位，
// 天然排除“每卡宽12高12 / 模组64×64”这类 2 位数；模组 3 位数像素总量也远低于超大阈值。
function extractSeparatedWH(text) {
  const masked = maskInnerDims(text);
  const out = [];
  let m = masked.match(/宽\s*(\d{3,6})\s*点?[^，。；\n]{0,10}?高\s*(\d{3,6})\s*点?/);
  if (m) out.push({ w: Number(m[1]), h: Number(m[2]) });
  m = masked.match(/高\s*(\d{3,6})\s*点?[^，。；\n]{0,10}?宽\s*(\d{3,6})\s*点?/);
  if (m) out.push({ w: Number(m[2]), h: Number(m[1]) }); // 反序：第二组才是宽
  return out.map((d) => ({ w: d.w, h: d.h, total: d.w * d.h }));
}

// 进引擎前的超大单屏判定（像素写法，含 NxN 与分离宽高）。独立于引擎输入解析器——
// 它会把超大数字当噪声丢弃导致悄悄回退半成品还催补料，这里直接从原文抓。
function detectOversizedPixels(text) {
  const cands = parsePixelDims(text).concat(extractSeparatedWH(text));
  for (const d of cands) {
    if (d.total > MAX_TOTAL_PX || d.w > MAX_AXIS_PX || d.h > MAX_AXIS_PX) return d;
  }
  return null;
}

// 米数写法的超大判定：需同时有 P 间距 + 宽/长米数 + 高米数，按 像素=米×1000/间距 换算。
// m 后用负向前瞻排除 mm（模组毫米），避免把 320mm 误当 320 米。
function detectOversizedMeters(text) {
  const t = String(text || "");
  const pm = t.match(/P\s*(\d(?:\.\d{1,2})?)/i);
  if (!pm) return null;
  const pitch = Number(pm[1]);
  if (!(pitch > 0)) return null;
  const wm = t.match(/(?:宽|长)\s*(\d+(?:\.\d+)?)\s*(?:米|公尺|m)(?![a-zA-Z])/);
  const hm = t.match(/高\s*(\d+(?:\.\d+)?)\s*(?:米|公尺|m)(?![a-zA-Z])/);
  if (!wm || !hm) return null;
  const w = (Number(wm[1]) * 1000) / pitch;
  const h = (Number(hm[1]) * 1000) / pitch;
  const total = w * h;
  if (total > MAX_TOTAL_PX || w > MAX_AXIS_PX || h > MAX_AXIS_PX) {
    return { w: Math.round(w), h: Math.round(h), total: Math.round(total), meters: { w: Number(wm[1]), h: Number(hm[1]), pitch } };
  }
  return null;
}

// 引擎结果里“超出在线自动配单能力”的信号（米数换算等引擎能解析的路径，由它自己报超限）
const OVERSIZED_RE = /超出.{0,40}(?:带载范围|拼接机箱)|请拆分系统|人工确认设备组合|已超出单台同步处理器及最大拼接机箱/;
function isOversizedResult(result, replyText) {
  const r = result || {};
  const hay = [].concat(r.missing || []).join(" ") + " " + String(replyText || "");
  return OVERSIZED_RE.test(hay);
}

// 异形 / 造型屏（非规则矩形）：弧形、折角、曲面、L/U 形、圆柱、球形、波浪、柔性等。
// 这类屏涉及弯折走线、多面组网与定制钢结构，规则矩形引擎算出的模组数 / 网口分布 / 连屏图都不适用；
// 客户只要明说形状非矩形就是强信号（无需尺寸佐证），直接转人工，避免硬配给错设备。
// 刻意不收裸“形 / 角 / 环 / 球”，以免误伤“矩形 / 长方形 / 角度 / 环境 / 全球”；
// L/U 形要求字母与“形/型”紧邻（L形、U型），避开“A5L 型号”这类设备型号被空格隔开的写法。
const IRREGULAR_SHAPE_RE = /异形|造型屏|弧|曲面|弯曲|折角|折屏|弯折|拼角|转角|拐角|[LUluＬＵ][形型]|环屏|环形|环绕|圆柱|圆锥|球形|球幕|波浪|飘带|丝带|柔性屏|软模组|魔方|立方体|立体屏/;
function detectIrregularShapeHint(text) {
  return IRREGULAR_SHAPE_RE.test(String(text || ""));
}

module.exports = {
  detectMultiScreenHint,
  detectIrregularShapeHint,
  detectOversizedPixels,
  detectOversizedMeters,
  isOversizedResult,
  screenPixelDims,
  distinctPitches,
  parsePixelDims,
  extractSeparatedWH,
  MAX_TOTAL_PX,
  MAX_AXIS_PX,
};
