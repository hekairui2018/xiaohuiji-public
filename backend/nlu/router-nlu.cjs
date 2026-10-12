// ============================================================================
// router-nlu.cjs —— 路由层结构化 NLU：模型输出契约 + 确定性校验/规整 + 能力边界探测
//
// 定位（铁律，和 llm-client.cjs 注释一致）：
//   · 大模型在路由层只判断四件事——客户要什么(intent)、字面给了哪些槽位(slots)、
//     缺什么(needs_clarify)、是否超出小灰机自动能力(boundary)；
//   · 模型【绝不】返回型号、芯片、案例号、参数、带载、BOM、拓扑坐标——这些一律由
//     本地确定性检索/计算产出；
//   · 模型输出必须过本文件的确定性校验（枚举/类型/白名单/回原文找证据），不合规返回
//     null，由调用方回退硬规则与正则，保证大模型永远不是单点故障；
//   · 能力边界以【确定性硬证据】为权威：模型自报 boundary 但原文无证据，一律不采信
//     （宁可放给本地，不可乱拦正常客户）。
//
// 边界分两类：
//   · HUMAN（escalate=true，路由前置直接转人工/引导）：友商控制系统、招投标控标标书、
//     非 LED 控制系统；
//   · 配单 specialist 已自带精细转人工流程的多屏/超大/异形：这里只记录 kind、
//     escalate=false，仍交 ordering-specialist 处理，避免双重话术。
// ============================================================================

"use strict";

const multiScreen = require("../ordering/ordering-multiscreen.cjs");

const INTENTS = ["presales", "aftersales", "ordering", "software", "unknown"];

// 需在路由前置直接转人工的边界（其余如多屏/超大/异形交配单 specialist）
const HUMAN_BOUNDARY = new Set(["competitor-product", "bidding-doc", "non-led"]);
const BOUNDARY_KINDS = [
  "normal",
  "competitor-product", // 其他控制系统品牌（诺瓦/卡莱特/仰邦/灵信/凯视达…）
  "bidding-doc",         // 招投标控标参数 / 技术应答偏离表 / 标书 / 方案PPT / 国产化参数
  "non-led",             // 非 LED 控制系统（H4K、液晶/LCD/DLP 拼接、投影）
  "multi-screen",        // 多块独立屏（specialist 处理）
  "oversized",           // 单屏超大点数（specialist 处理）
  "irregular-shape",     // 弧形/折角/L·U 异形（specialist 处理）
];
// 边界落回哪个业务意图（即使前置闸门因故没拦，也落到最接近的人工/售前通道）
const BOUNDARY_INTENT = {
  "competitor-product": "presales",
  "bidding-doc": "presales",
  "non-led": "presales",
  "multi-screen": "ordering",
  oversized: "ordering",
  "irregular-shape": "ordering",
};

// --- 确定性边界词表（保守、窄口径，避免误杀正常售前/配单） ---------------------

// 控制系统友商品牌（只收控制卡/盒/处理器品牌，不收屏厂/模组厂——客户用别家模组配灰度卡是正常生意）
// 刻意不收裸 "LS"（那是灰度 LS99 系列芯片丝印前缀，≠灵信 Linsn）
const COMPETITOR_RE = /(?:诺瓦(?:星云|科技)?|nova\s?star|卡莱特|colorlight|仰邦|onbon|灵信(?:视觉)?|linsn|摩西尔|凯视达|kystar)/i;

// 招投标控标 / 技术应答 / 标书 / 方案PPT / 国产化参数（普通“技术参数/规格书”咨询不命中）
const BIDDING_HARD_RE =
  /控标|应标|围标|陪标|投标文件|招投标?|招标参数|招标技术|技术(?:规格|参数)应答|参数应答|应答(?:文件|参数|偏离)|偏离表|标书|做标书|写标书|投标方案|应标方案|方案\s?PPT|分布式图像综合管理系统|龙芯|飞腾|鲲鹏|申威|国产(?:化)?(?:操作系统|芯片|CPU|处理器|平台)|麒麟(?:操作系统|软件)?|信创/;

// 非 LED 控制系统（H4K 经用户确认不是 LED；液晶/LCD/DLP 拼接、投影）
const H4K_RE = /\bH\s?4K\b/i;
const LCD_WALL_RE = /液晶拼接|LCD\s*拼接|DLP\s*拼接|液晶拼接墙|背投/i;
const PROJECTOR_RE = /投影仪|投影机|投影融合/;
const GRAY_LCD_SOFTWARE_RE = /LCD\s?Player/i; // 灰度自家软件，绝不能判成 non-led
const LED_CONTEXT_RE = /LED|显示屏|模组|单元板|接收卡|发送卡|控制卡|点间距|P\s*\d|箱体/;

// 长条屏（strip）口语强信号（仅用于回填模型 slots.shape，不做边界拦截）
const STRIP_RE = /长条|条形|走字屏|横幅|楣屏|长屏|高(?:度)?.{0,3}(?:只有|才|不到|没几|1|2|一|二)\s*(?:块|张|排|行)/;

// --- 能力边界硬探测：返回 {kind, reason, evidence} 或 null（权威，模型不得推翻） ---
function detectHardBoundary(message, opts) {
  const t = String(message || "");
  const o = opts || {};

  // 1) 招投标控标 / 标书 / 国产化参数：无论是否带型号，都转人工出方案（普通参数咨询不含这些窄词）
  if (BIDDING_HARD_RE.test(t)) {
    return { kind: "bidding-doc", reason: "招投标控标/技术应答/标书/国产化参数，需人工按项目定制" };
  }

  // 2) 非 LED：H4K、液晶/LCD/DLP 拼接（排除灰度 LCD Player 软件）、投影（无 LED 语境）
  if (H4K_RE.test(t)) {
    return { kind: "non-led", reason: "H4K 非 LED 控制系统产品线" };
  }
  if (!GRAY_LCD_SOFTWARE_RE.test(t) && LCD_WALL_RE.test(t)) {
    return { kind: "non-led", reason: "液晶/LCD/DLP 拼接或背投，非 LED 控制系统" };
  }
  if (PROJECTOR_RE.test(t) && !LED_CONTEXT_RE.test(t) && !GRAY_LCD_SOFTWARE_RE.test(t)) {
    return { kind: "non-led", reason: "投影类设备，非 LED 控制系统" };
  }

  // 3) 友商控制系统品牌：必须【没有】灰度自家实体（型号/芯片/灰度/HD 软件），避免“灰度C16L和诺瓦对比”被拦
  if (COMPETITOR_RE.test(t) && !o.hasHuiduEntity) {
    return { kind: "competitor-product", reason: "询问其他控制系统品牌且无灰度自家产品实体" };
  }

  // 4) 以下仅记录（escalate=false，交 ordering-specialist 自带流程）
  if (multiScreen.detectIrregularShapeHint(t)) {
    return { kind: "irregular-shape", reason: "弧形/折角/L·U 等异形屏，规则矩形引擎不适用" };
  }
  if (multiScreen.detectMultiScreenHint(t)) {
    return { kind: "multi-screen", reason: "多块彼此独立的屏体工程" };
  }
  const overPx = multiScreen.detectOversizedPixels(t);
  if (overPx) return { kind: "oversized", reason: "单屏像素超出在线自动配单上限" };
  const overM = multiScreen.detectOversizedMeters(t);
  if (overM) return { kind: "oversized", reason: "米数换算后单屏超大" };

  return null;
}

// --- 小工具：回原文找证据（模型自报槽位必须能在客户原话里找到，否则置空） ---------
function clampNum(v, lo, hi) {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || Number.isNaN(n)) return null;
  if (n < lo || n > hi) return null;
  return n;
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function normalizeSlots(rawSlots, message, opts) {
  const t = String(message || "");
  const s = (rawSlots && typeof rawSlots === "object") ? rawSlots : {};
  const out = { pitch: null, sync: null, screen_count: null, has_screen_spec: false, shape: null };

  // pitch：0.5–50，且原文真有 “P<数字>”
  const pitch = clampNum(s.pitch, 0.5, 50);
  if (pitch != null && new RegExp("P\\s*" + escRe(pitch), "i").test(t)) out.pitch = pitch;

  // sync：白名单 + 原文须真有同步/异步语义
  if (s.sync === "sync" && /同步|视频处理器|处理器|\bVP\b/i.test(t)) out.sync = "sync";
  else if (s.sync === "async" && /异步|播放盒|异步卡/i.test(t)) out.sync = "async";

  // screen_count：2–99 整数，且原文有多块屏/主副屏/分屏等结构证据（单块或没提=null）
  const sc = clampNum(s.screen_count, 2, 99);
  const multiEvidence = /[两俩二三四五六七八九十\d]\s*[块面台套个]\s*[屏显示幕]|主屏|副屏|多屏|分屏|多[块面台套个]屏/.test(t);
  if (sc != null && Number.isInteger(sc) && multiEvidence) out.screen_count = sc;

  // has_screen_spec：以确定性检测为权威（注入优先，用 server 的 SCREEN_SIZE_RE；否则用内置轻量正则）
  const lightSpec = /\d{2,5}\s*[×x*]\s*\d{2,5}|\d+(?:\.\d+)?\s*(?:米|m)(?![a-zA-Z])|\d{1,3}\s*(?:宽|列)\s*\d{1,3}\s*(?:高|行)|\d{1,3}\s*(?:张|块)\s*(?:模组|单元板|箱体)|(?:整点|总点|总像素|整屏)\s*\d{5,}/;
  out.has_screen_spec = opts.hasScreenSpec ? !!opts.hasScreenSpec(t) : lightSpec.test(t);

  // shape：异形/长条必须有原文证据
  if (s.shape === "irregular" && multiScreen.detectIrregularShapeHint(t)) out.shape = "irregular";
  else if (s.shape === "strip" && STRIP_RE.test(t)) out.shape = "strip";

  return out;
}

function normalizeEntities(rawEntities) {
  if (!Array.isArray(rawEntities)) return [];
  const seen = new Set();
  const out = [];
  for (const e of rawEntities) {
    if (e === null || e === undefined) continue;
    const x = String(e).trim().replace(/\s+/g, " ").slice(0, 32);
    if (!x || seen.has(x.toUpperCase())) continue;
    seen.add(x.toUpperCase());
    out.push(x);
    if (out.length >= 8) break; // 实体只作提示，最多 8 个，防模型堆砌
  }
  return out;
}

function detectLanguage(message) {
  const t = String(message || "");
  if (/[一-龥]/.test(t)) return "zh";
  if (/[A-Za-z]/.test(t)) return "en";
  return "other";
}

// 干净的默认 detail（硬规则/缓存/兜底路径用）
function blankDetail(intent, source) {
  return {
    intent,
    confidence: source === "fallback" ? 0.5 : 0.95,
    needs_clarify: false,
    clarify_question: "",
    entities: [],
    slots: { pitch: null, sync: null, screen_count: null, has_screen_spec: false, shape: null },
    boundary: { kind: "normal", escalate: false, reason: "" },
    language: "zh",
    source: source || "hard",
  };
}

// 校验/规整模型原始 JSON：不合规返回 null（调用方回退硬规则）；合规返回干净 detail
function normalizeRoute(raw, message, opts) {
  if (!raw || typeof raw !== "object") return null;
  const intent = String(raw.intent || "").trim();
  if (!INTENTS.includes(intent)) return null; // 意图非法 → 整单作废（沿用历史契约）
  const o = opts || {};
  const t = String(message || "");

  let confidence = Number(raw.confidence);
  if (Number.isNaN(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  const needs_clarify = raw.needs_clarify === true;
  let clarify_question = "";
  if (needs_clarify && typeof raw.clarify_question === "string") {
    clarify_question = raw.clarify_question.trim().replace(/\s+/g, " ").slice(0, 80);
  }

  const entities = normalizeEntities(raw.entities);
  const slots = normalizeSlots(raw.slots, t, o);

  // boundary 以确定性硬证据为权威；模型自报但无证据 → normal（不拦）
  const hard = detectHardBoundary(t, { hasHuiduEntity: !!o.hasHuiduEntity });
  let boundary = { kind: "normal", escalate: false, reason: "" };
  if (hard) {
    boundary = { kind: hard.kind, escalate: HUMAN_BOUNDARY.has(hard.kind), reason: hard.reason };
  } else if (raw.boundary && raw.boundary.out_of_scope === true) {
    const k = BOUNDARY_KINDS.includes(raw.boundary.kind) ? raw.boundary.kind : null;
    // 无硬证据时，只有 specialist 自处理类也不前置拦；HUMAN 类无证据一律不采信
    if (k && !HUMAN_BOUNDARY.has(k)) boundary = { kind: k, escalate: false, reason: "模型提示(无硬证据)" };
  }

  return {
    intent,
    confidence,
    needs_clarify: needs_clarify && !!clarify_question,
    clarify_question,
    entities,
    slots,
    boundary,
    language: detectLanguage(t),
    source: "llm",
  };
}

// 硬边界直接构造 detail（路由前置闸门用）
function hardBoundaryDetail(hit) {
  const intent = BOUNDARY_INTENT[hit.kind] || "presales";
  const d = blankDetail(intent, "hard-boundary");
  d.confidence = 1;
  d.boundary = { kind: hit.kind, escalate: HUMAN_BOUNDARY.has(hit.kind), reason: hit.reason };
  return d;
}

// --- 前置转人工的客户话术：只给结论和行动，不暴露识别过程/内部术语 ---------------
function buildBoundaryReply(kind) {
  switch (kind) {
    case "competitor-product":
      return [
        "你提到的是其他品牌的控制系统，我这边只对灰度（Huidu）自家的发送卡、接收卡、播放盒和视频处理器做参数查询和配单。",
        "如果想换成灰度方案，把整屏宽×高（或模组张数/米数）、点间距、同步还是异步发我，我直接给型号和数量；需要品牌替换对照或报价，我帮你转销售人工对接。",
      ].join("\n");
    case "bidding-doc":
      return [
        "招投标的控标参数、技术应答/偏离表和方案 PPT 要按项目逐项定制，我帮你转销售或技术支持人工来出，避免参数项对不上影响应标。",
        "如果只是要某款产品的标准规格书或常规参数，直接发型号（如 VP2430、R712），我马上发你。",
      ].join("\n");
    case "non-led":
      return "小灰机目前只支持 LED 显示屏控制系统（发送卡、接收卡、播放盒、视频处理器）的配单、参数和售后。你问的液晶/LCD/DLP 拼接或投影不在这条产品线，我帮你转对应人工客服。";
    default:
      return "这个需求需要人工帮你处理，请稍等，我帮你转接人工客服。";
  }
}

module.exports = {
  INTENTS,
  BOUNDARY_KINDS,
  HUMAN_BOUNDARY,
  BOUNDARY_INTENT,
  detectHardBoundary,
  normalizeRoute,
  normalizeSlots,
  blankDetail,
  hardBoundaryDetail,
  buildBoundaryReply,
};
