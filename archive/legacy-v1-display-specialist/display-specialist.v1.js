/**
 * 小灰机 · 花屏/闪烁/显示异常 专精快速通道
 * --------------------------------------------------
 * 独立模块，不依赖 server.js 内部函数，风险隔离。
 * 职责：
 *   1. 判断一条提问是否属于"花屏/闪烁/显示异常"专精范围
 *   2. 识别细分现象类型、产品型号、芯片
 *   3. 信息不足时只反问一个最关键问题（混合模式）
 *   4. 从专精库检索高相关案例并评分排序
 *   5. 按"金字塔结构"组织回答：结论 → 最多3步排查 → 兜底
 * 数据：项目知识库交接文档/专精库_花屏闪烁显示异常.json（只读）
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SPECIALIST_FILE = path.join(ROOT, "..", "..", "data", "specialist-cases.json");

// ============ 1. 现象类型识别 ============
// 顺序即优先级：越具体越靠前
const CATEGORY_DEFS = [
  ["波纹摩尔纹", /摩尔纹|水波纹|波纹|干涉纹|网纹/],
  ["闪烁抖动", /闪屏|闪烁|一闪一闪|闪点|闪色|闪一下|一直闪|老闪|老是闪|总闪|闪个不停|屏幕闪|画面闪|闪了|频繁闪|抖屏|抖动|跳屏|晃动|频闪|忽明忽暗|一闪一/],
  ["花屏乱码", /花屏|屏幕花|画面花|屏花|花了|花花的|色块|乱码|画面乱|画面错乱|画面断裂|画面破碎|马赛克|雪花|杂点|噪点|碎屏/],
  ["偏色缺色", /偏色|色差|颜色异常|颜色不对|颜色不一致|颜色不均|变色|颜色变了|发红|发绿|发蓝|发黄|缺色|纯色|色偏|白平衡|色温|底色不均|绿底|红底|蓝底/],
  ["横竖线条", /横线|竖线|横条|竖条|横纹|竖纹|亮线|暗线|亮暗线|斜扫|隔行|错行|一条线|行线|列线|绿色竖线|绿色横线/],
  ["鬼影拖影", /鬼影|拖影|重影|残影|虚影|阴影|暗影|烧屏|图像残留|文字残留|历史文字|灯珠老化/],
  ["显示不全异常", /显示不全|显示不完整|画面缺失|缺行|缺列|局部不显示|局部黑|黑屏|不亮|点不亮|低灰|灰度0|光斑|显示异常|画面异常/],
];
const DISPLAY_REGEX = new RegExp(CATEGORY_DEFS.map((d) => d[1].source).join("|"));

function detectCategories(text) {
  const t = String(text || "");
  const hits = [];
  for (const [name, re] of CATEGORY_DEFS) if (re.test(t)) hits.push(name);
  return hits;
}
function isDisplayFault(text) {
  return DISPLAY_REGEX.test(String(text || ""));
}

// ============ 2. 产品型号 / 芯片识别 ============
// 产品型号：处理器VP/KV/H/X/T，控制卡A/C/D/B，接收卡R/K，W系列等
const PRODUCT_REGEX =
  /\b(?:HD[-\s]?)?(VP\d{3,4}[A-Z]?|KV\d{3,4}[A-Z]?|VX\d{3,4}[A-Z]?|H4K|X\d{1,3}[A-Z]?|T\d{1,3}[A-Z]?|A\d{1,2}L?|C\d{1,2}[A-Z]?|D\d{1,2}[A-Z]?|B\d{1,2}L?|W\d{1,3}[A-Z]?|R\d{3,4}[A-Z]?|K\d{2}[A-Z]?)\b/gi;
// 芯片前缀（与 intent-router 保持一致）
const CHIP_REGEX =
  /\b(?:SM|HX|ICND?|DP|FM|LS|CNS|MBI|MB|TC|RUC|RUL|LYD|GC|MY|TL|RT)\d{2,5}[A-Z]{0,3}\b/gi;
// 点间距
const PITCH_REGEX = /\bP\d(?:\.\d{1,2})?\b/gi;
// 软件
const SOFTWARE_REGEX = /HDSet|HDPlayer|HDShow|小灰云/gi;

function canonical(v) {
  return String(v || "").toUpperCase().replace(/^HD[-\s]?/, "").replace(/[^A-Z0-9]/g, "");
}
function extractProducts(text) {
  const out = new Set();
  let m;
  PRODUCT_REGEX.lastIndex = 0;
  while ((m = PRODUCT_REGEX.exec(String(text || "")))) out.add(m[1].toUpperCase());
  return [...out];
}
function extractChips(text) {
  const out = new Set();
  let m;
  CHIP_REGEX.lastIndex = 0;
  while ((m = CHIP_REGEX.exec(String(text || "")))) out.add(m[0].toUpperCase());
  return [...out];
}
function extractPitches(text) {
  const out = new Set();
  let m;
  PITCH_REGEX.lastIndex = 0;
  while ((m = PITCH_REGEX.exec(String(text || "")))) out.add(m[0].toUpperCase());
  return [...out];
}
function extractSoftware(text) {
  const out = new Set();
  let m;
  SOFTWARE_REGEX.lastIndex = 0;
  while ((m = SOFTWARE_REGEX.exec(String(text || "")))) out.add(m[0]);
  return [...out];
}

// ============ 3. 专精库加载（带缓存） ============
let _cache = null;
let _cacheMtime = 0;
function loadSpecialist() {
  const stat = fs.statSync(SPECIALIST_FILE);
  if (_cache && _cacheMtime === stat.mtimeMs) return _cache;
  const raw = JSON.parse(fs.readFileSync(SPECIALIST_FILE, "utf8").replace(/^\uFEFF/, ""));
  _cache = raw;
  _cacheMtime = stat.mtimeMs;
  return _cache;
}

const QUALITY_WEIGHT = { A: 30, B: 18, C: 8, D: 0 };

// 案例与查询的相关性评分
function scoreCase(c, query) {
  const q = String(query || "").toUpperCase();
  const blob = [
    c.title,
    c.customerWording,
    c.phenomenon,
    c.finalCause,
    c.solution,
    (c.products || []).join(" "),
    (c.chips || []).join(" "),
    (c.pitches || []).join(" "),
    (c.keywords || []).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  let score = QUALITY_WEIGHT[c.quality] || 0;

  // 类型匹配
  const qCats = detectCategories(query);
  if (qCats.length && (c.categories || []).some((x) => qCats.includes(x))) score += 40;

  // 产品型号匹配（权重最高）
  const qProducts = extractProducts(query).map(canonical);
  let productHit = 0;
  for (const p of qProducts) {
    const cProducts = (c.products || []).map(canonical);
    if (cProducts.some((cp) => cp === p || cp.includes(p) || p.includes(cp))) productHit += 2;
    // 标题/现象里出现型号也算
    const headBlob = [c.title, c.customerWording, c.phenomenon].filter(Boolean).join(" ").toUpperCase();
    if (headBlob.includes(p)) productHit += 1;
  }
  score += Math.min(productHit, 6) * 12;

  // 芯片匹配
  const qChips = extractChips(query).map(canonical);
  let chipHit = 0;
  for (const ch of qChips) {
    const cChips = (c.chips || []).map(canonical);
    if (cChips.some((cc) => cc === ch || cc.includes(ch) || ch.includes(cc))) chipHit += 2;
    if (blob.includes(ch)) chipHit += 1;
  }
  score += Math.min(chipHit, 4) * 8;

  // 点间距匹配
  const qPitches = extractPitches(query);
  if (qPitches.length) {
    const cPitches = (c.pitches || []).map((x) => String(x).toUpperCase());
    if (qPitches.some((p) => cPitches.includes(p))) score += 10;
  }

  // 现象关键词重合
  const kwPool = (c.keywords || []).map((k) => String(k).toUpperCase());
  const qTokens = q.split(/[\s,，。、；;:：？?！!的了吗呢啊和与及]+/).filter((s) => s.length >= 2);
  let kwHit = 0;
  for (const tok of qTokens) {
    if (kwPool.some((k) => k.includes(tok) || tok.includes(k))) kwHit++;
    else if (blob.includes(tok)) kwHit += 0.5;
  }
  score += Math.min(kwHit, 8) * 3;

  return score;
}

function retrieve(query, limit = 8) {
  const db = loadSpecialist();
  const cases = db.cases || [];
  const scored = cases
    .map((c) => ({ c, s: scoreCase(c, query) }))
    .filter((x) => x.s > 18)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  return scored;
}

// 过程叙述型内容（不是给客户的可执行动作，应过滤）
const NARRATIVE_REGEX = /寄回|返厂|研发|远程分析|远程调试|复现|现场有人|已返回|对接|沟通|怀疑是硬件|焊接|DDR颗粒|硬件异常|需返厂|等待|等现场|待验证|推测|问题\d|不确定|出现.{0,10}现象|的时候|出现闪点|案例描述/;
// 占位符/空方案（原表没填的不能当步骤给客户）
const PLACEHOLDER_STEP = /【|未填写|未明确|未单列|暂无|无(?:明确)?(?:解决|处理)方案|^\s*$/;
// 动作型步骤：去掉引导词后，句首必须是可执行动词（剔除"户外P10…"这类第三人称场景描述）
const ACTION_HEAD = /^[请先再然后可需应建议您你]*[改换调升级关开重启检查设置进入勾选降低提高切换更换拔插拔下重新导入导出选确认核对备份断电下载刷新重置恢复加载使用将把]/;

// 面向客户：去掉内部口吻（微盘/临时版本/PPT等客户无感的内部来源词）
function clientFacing(s) {
  return String(s || "")
    .replace(/微盘上?(?:的)?(?:这个|那个|对应)?固件/g, "对应固件")
    .replace(/升级到?PPT[^，,。；;]*?给出的?/g, "升级到")
    .replace(/临时固件/g, "固件")
    .replace(/临时版本/g, "版本")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanStepText(s) {
  return clientFacing(String(s || "")
    .replace(/^\s*(?:方案)?\d+\s*[、.．:：)）]\s*/, "") // 去残留编号 "1：" "方案2："
    .replace(/^第[一二三四五]步\s*[:：]?\s*/, "")
    .replace(/[；;]\s*$/, ""))
    .trim();
}

// ============ 4. 解决方案切分为步骤 ============
function splitSteps(text) {
  let s = String(text || "").trim();
  if (!s) return [];
  s = s.replace(/^(解决方法|解决方案|处理方法|处理方案)\s*[:：]?\s*/, "");
  const parts = s.split(/(?:^|[\n；;])\s*(?:\d+\s*[、.．)）]|[①②③④⑤⑥⑦⑧⑨]|第[一二三四五]步\s*[:：]?)/);
  let steps = parts
    .map(cleanStepText)
    .filter((p) => p.length >= 4);
  if (steps.length <= 1) {
    steps = s
      .split(/[。\n]/)
      .map(cleanStepText)
      .filter((x) => x.length >= 6);
  }
  // 只保留“句首即动作动词”的可执行步骤，剔除占位符、过程叙述与场景描述
  return steps.filter((st) => !PLACEHOLDER_STEP.test(st) && !NARRATIVE_REGEX.test(st) && ACTION_HEAD.test(st));
}

const CAUSE_PLACEHOLDER = /【(?:原文|原表|原文档)[^】]*】|未单列|暂无|^$/;
// 不确定的根因（怀疑/未验证/待确认）不能当确定结论抛给客户
const CAUSE_UNCERTAIN = /怀疑|未确认|未能确认|未记录|无法确认|不能作为|待定|尚未|暂未|没记录|有待|需进一步/;
// 从根因文本提炼一句结论（去掉前缀和占位符，取短而明确的一句）
function summarizeCause(text) {
  let s = clientFacing(String(text || "").trim());
  if (!s || CAUSE_PLACEHOLDER.test(s)) return "";
  s = s
    .replace(/^(原因|根本原因|最终原因|故障原因|结论)\s*[:：]?\s*/, "")
    .replace(/^定性为[，,]?/, "");
  // 优先取第一句
  let first = s.split(/[。\n；;]/)[0].trim();
  if (CAUSE_PLACEHOLDER.test(first) || CAUSE_UNCERTAIN.test(first)) return "";
  // 过长说明不是精炼结论，截断
  if (first.length > 70) first = first.slice(0, 68) + "…";
  return first;
}

// ============ 5. 混合模式：判断信息是否充分、生成反问 ============
function assessSituation(query, history = []) {
  const cats = detectCategories(query);
  const products = extractProducts(query);
  const chips = extractChips(query);
  // 结合最近一轮历史里已确认的型号
  const recent = history.slice(-4).map((h) => String(h.content || h.message || "")).join(" ");
  const histProducts = extractProducts(recent);
  const allProducts = [...new Set([...products, ...histProducts])];

  return {
    categories: cats,
    products: allProducts,
    chips,
    hasPhenomenon: cats.length > 0,
    hasProduct: allProducts.length > 0,
  };
}

// 只反问一个最关键问题
function buildClarifyQuestion(sit) {
  if (!sit.hasPhenomenon) {
    return "方便描述一下具体的显示现象吗？比如是花屏、闪烁、偏色、出现横竖线，还是鬼影拖影？";
  }
  if (!sit.hasProduct) {
    return "为了给你最准确的处理步骤，请问用的是哪款设备？（比如异步卡A6L/C16L、视频处理器VP620A/VP410H，或接收卡R712等）";
  }
  return "";
}

// ============ 6. 金字塔回答组装 ============
function sameProduct(c, products) {
  if (!products.length) return true;
  const cProds = (c.products || []).map(canonical);
  const head = [c.title, c.customerWording, c.phenomenon].filter(Boolean).join(" ").toUpperCase();
  return products.some((p) => cProds.some((cp) => cp === p || cp.includes(p) || p.includes(cp)) || head.includes(p));
}

function buildPyramidReply(query, ranked, sit) {
  const all = ranked.map((r) => r.c);
  // 优先同产品案例，不足时再用其他案例补
  const same = all.filter((c) => sameProduct(c, sit.products));
  const top = same.length ? same : all;
  const lines = [];

  // —— 第一层：结论（优先同产品、短而明确的根因） ——
  const catText = sit.categories[0] || "显示异常";
  const prodText = sit.products[0] ? `${sit.products[0]} ` : "";
  let conclusion = "";
  for (const c of top) {
    const cause = summarizeCause(c.finalCause);
    if (cause) { conclusion = cause; break; }
  }
  if (conclusion) {
    lines.push(`【判断】${prodText}这类${catText}，最常见的原因是：${conclusion}`);
  } else {
    lines.push(`【判断】${prodText}${catText}通常由信号、参数配置、排线/硬件或固件几个方向引起，按下面顺序排查，成功率从高到低。`);
  }

  // —— 第二层：最多3步（按"同产品+同类型"优先级取动作型步骤，不足不硬凑） ——
  const qCats = sit.categories;
  const caseRank = (c) => {
    let r = 0;
    if ((c.categories || []).some((x) => qCats.includes(x))) r += 2;
    r += (QUALITY_WEIGHT[c.quality] || 0) / 100;
    return r;
  };
  // 有明确型号时，步骤只从同型号案例取，不足也不跨型号硬凑（避免串味）
  const sameProd = all.filter((c) => sameProduct(c, sit.products));
  const stepPool = sit.products.length && sameProd.length ? sameProd : all;
  const ordered = [...stepPool].sort((a, b) => caseRank(b) - caseRank(a));
  const stepBucket = [];
  const seenStep = new Set();
  for (const c of ordered) {
    const steps = splitSteps(c.solution);
    for (const st of steps) {
      const key = st.slice(0, 14);
      if (seenStep.has(key)) continue;
      seenStep.add(key);
      stepBucket.push(st);
    }
    if (stepBucket.length >= 3) break;
  }
  const finalSteps = stepBucket.slice(0, 3);
  if (finalSteps.length) {
    lines.push("\n【请按顺序尝试】");
    finalSteps.forEach((st, i) => {
      const clean = st.replace(/[。\s]+$/, "");
      lines.push(`${i + 1}. ${clean}（做完观察画面是否恢复正常，恢复即可停在此步）`);
    });
  } else {
    // 切不出动作步骤时，从最相关案例方案里按句挑“可执行、非内部叙述”的内容，宁缺毋滥
    const raw = top[0]?.solution || "";
    const INTERNAL_LINE = /客户说|先不管|疑似|还在现场|没有影响|待定|待观察|跟进中|尚未/;
    const cleaned = String(raw).split(/[。\n；;]/).map(clientFacing)
      .map((s) => s.trim())
      .filter((s) => s.length >= 6 && !NARRATIVE_REGEX.test(s) && !INTERNAL_LINE.test(s) && ACTION_HEAD.test(s));
    if (cleaned.length) lines.push(`\n【参考处理】${cleaned.slice(0, 3).join("；").slice(0, 260)}`);
  }

  // —— 第三层：兜底 ——
  lines.push(
    "\n【兜底】如果以上步骤做完仍未恢复，请拍一段屏幕异常的短视频，连同设备背面的型号/SN发我，我帮你判断是参数、固件还是硬件问题，少走弯路。"
  );

  // —— 参考案例（可溯源，精简一行） ——
  const refs = top.slice(0, 3).filter((c) => c.id);
  if (refs.length) {
    lines.push("\n— 参考案例：" + refs.map((c) => `${c.id} ${c.title}`.slice(0, 40)).join("；"));
  }
  return lines.join("\n");
}

// ============ 7. 主入口 ============
/**
 * @returns {null|{matched:boolean, needClarify:boolean, reply:string, sources:array, meta:object}}
 */
function handle(query, history = []) {
  const text = String(query || "").trim();
  if (!text) return null;
  // 反问后续轮可能只补型号（如点"C16系列"），本轮无现象词，需继承近期对话里的现象
  const recentText = (Array.isArray(history) ? history.slice(-4) : [])
    .map((h) => String(h.content || h.message || "")).join(" ");
  const combined = `${recentText} ${text}`.trim();
  // 本轮或近期历史命中显示故障，都算专精范围，避免多轮被入口挡掉
  if (!isDisplayFault(combined)) return { matched: false };

  const sit = assessSituation(combined, []);
  const textProducts = extractProducts(text);
  // 本轮明确给了型号就以本轮为准（避免问完C16再问R712时旧型号串味）；本轮没给型号才沿用历史型号
  sit.products = textProducts.length ? textProducts : sit.products;
  const ranked = retrieve(combined, 8);
  const noEvidence = ranked.length === 0;
  const clarify = buildClarifyQuestion(sit);

  // 混合模式①：没有设备型号时，不硬套具体案例，先给通用排查+只反问型号
  if (!sit.hasProduct) {
    return {
      matched: true,
      needClarify: true,
      reply:
        `你描述的是${sit.categories[0] || "显示异常"}类问题，这类现象和具体设备型号关系很大，不同设备处理方式不同。\n\n` +
        `先做两个通用检查：\n` +
        `1. 重新插拔或更换信号线/排线，排除接触不良（做完看画面是否恢复）\n` +
        `2. 核对输出分辨率、刷新率是否在设备支持范围内，必要时降一档刷新率测试\n\n` +
        `${clarify}`,
      sources: [],
      meta: { specialist: "display", intent: "fault", categories: sit.categories, stage: "clarify_model" },
    };
  }

  // 混合模式②：有型号但没命中案例 → 通用排查+反问现象细节
  if (noEvidence) {
    // 有型号但没命中案例：给通用排查 + 反问现象细节
    return {
      matched: true,
      needClarify: true,
      reply:
        `暂未在${sit.products[0] || "该设备"}的历史案例中检索到完全一致的记录。先按通用方向排查：\n` +
        `1. 检查并重新插拔信号线、排线，排除接触不良（做完看画面是否恢复）\n` +
        `2. 核对输出分辨率/刷新率是否在设备支持范围内（超出会导致花屏闪烁）\n` +
        `3. 用HDSet/HDPlayer重新加载一次配置并发送\n\n` +
        `${clarify}`,
      sources: [],
      meta: { specialist: "display", intent: "fault", categories: sit.categories, stage: "clarify_generic" },
    };
  }

  const reply = buildPyramidReply(text, ranked, sit);
  const sources = ranked.slice(0, 5).map((r) => ({
    id: r.c.id,
    title: r.c.title,
    score: Math.round(r.s),
    quality: r.c.quality,
    sourceFile: r.c.sourceFile,
    source: r.c.source,
  }));
  return {
    matched: true,
    needClarify: false,
    reply,
    sources,
    meta: {
      specialist: "display",
      intent: "fault",
      categories: sit.categories,
      products: sit.products,
      chips: sit.chips,
      stage: "answer",
      hitCount: ranked.length,
    },
  };
}

module.exports = {
  handle,
  isDisplayFault,
  detectCategories,
  extractProducts,
  extractChips,
  retrieve,
  splitSteps,
  loadSpecialist,
};
