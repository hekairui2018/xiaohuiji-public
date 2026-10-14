'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadProductData}=require('./product-data.cjs');
const {createSpecCatalog}=require('./product-documents.cjs');
const {buildProductFeatures,buildProductDetail}=require('./product-features.cjs');
const {isGhostProduct,isHardHidden,isOfficialSelectable}=require('./product-catalog.cjs');
const docCategory=require('./doc-category.cjs');
function createCatalogService({publicBase='',orderEng=require('./ordering/ordering-engine.cjs')}={}) {
const {extractSpecParams,extractSpecFiles}=createSpecCatalog({publicBase});
// ============ 产品资料搜索 ============
const loadProductIndex = () => loadProductData().products;
const FIRMWARE_MANIFEST_FILE = path.join(__dirname, "..", "data", "firmware-manifest.json");
let firmwareManifestCache = null;
function loadFirmwareManifest() {
  if (firmwareManifestCache) return firmwareManifestCache;
  try {
    const raw = JSON.parse(fs.readFileSync(FIRMWARE_MANIFEST_FILE, "utf8").replace(/^﻿/, ""));
    firmwareManifestCache = Array.isArray(raw.items) ? raw.items : (Array.isArray(raw) ? raw : []);
  } catch (err) {
    console.error("[firmware-manifest load error]", err.message);
    firmwareManifestCache = [];
  }
  return firmwareManifestCache;
}

const loadProductSpecs = () => loadProductData().specs;

// ============ 接收卡固件：产品卡「固件」标签（与规格书按钮同构；数据全部来自 firmware-manifest，绝不生成文件名） ============
const FW_CHIP_LABEL = { "63": "ICN1063", "65": "ICN2065", "97": "LS9937", "99": "LS99" };
const FW_CHIP_ORDER = ["65", "63", "99", "97"]; // 新平台在前，固定顺序保证同卡同序、不随机
function fwFpgaVersion(file) {
  const m = String(file || "").match(/FPGA[_\s-]?(V\d+\.\d+)/i) || String(file || "").match(/(V\d+\.\d+)/);
  return m ? m[1].toUpperCase() : "";
}
function fwVerScore(v) {
  const m = String(v || "").match(/(\d+)\.(\d+)/);
  return m ? (+m[1]) * 1000 + (+m[2]) : 0;
}
function firmwareGroupFor(productName) {
  const want = String(productName || "").toUpperCase().replace(/^HD[-_]?/, "").replace(/\s+/g, "");
  if (!want) return null;
  const items = loadFirmwareManifest().filter((it) => {
    if (it.status && it.status !== "uploaded") return false;
    if (!it.publicUrl) return false;
    return String(it.card || "").toUpperCase().replace(/\s+/g, "") === want;
  });
  if (!items.length) return null;
  const verOf = (it) => fwFpgaVersion(it.file);
  const newest = (arr) => arr.slice().sort((a, b) => fwVerScore(verOf(b)) - fwVerScore(verOf(a)))[0];
  const mkBtn = (it, label) => ({ name: it.file, url: it.publicUrl, clean: label, btn: label, kind: "firmware", ver: verOf(it) });
  const out = [];
  // 1) 通用固件：只给最新 1 个并置顶推荐（旧通用版不列出，避免客户选错）
  const common = newest(items.filter((it) => it.commonCode));
  if (common) out.push(mkBtn(common, ("通用固件 " + verOf(common) + " · 推荐").replace(/\s+/g, " ").trim()));
  // 2) 芯片系列：63/65/97/99 各取最新 1 个；E#/D# 硬件批次后缀挂在名后
  for (const ser of FW_CHIP_ORDER) {
    const cand = items.filter((it) => !it.commonCode && !it.specialCode && String(it.series) === ser);
    const it = newest(cand);
    if (it) {
      const vh = String(it.variant || "").trim();
      let label = FW_CHIP_LABEL[ser] + " 固件";
      if (/^[ED]\d+$/i.test(vh)) label += " " + vh.toUpperCase();
      if (verOf(it)) label += " · " + verOf(it);
      out.push(mkBtn(it, label.trim()));
    }
  }
  // 3) 专用固件：specialCode 或无法归入通用/四大系列（84/18 等未知系列按专用处理，绝不编芯片名）；
  //    中文变体（贴膜屏/透明屏）直接用其名；同名按钮用版本号区分
  const special = items.filter((it) => {
    if (it.commonCode) return false;
    if (FW_CHIP_LABEL[String(it.series)] && !it.specialCode) return false;
    return true;
  }).sort((a, b) => fwVerScore(verOf(b)) - fwVerScore(verOf(a)));
  const spSeen = new Set();
  for (const it of special) {
    const vh = String(it.variant || "").trim();
    let label;
    if (/[一-龥]/.test(vh)) label = vh + "固件";
    else if (/^[ED]\d+$/i.test(vh)) label = "专用固件 " + vh.toUpperCase();
    else if (vh) label = "固件 " + vh; // 老版下划线固件（如异步卡 C16L 的 V9_16_13_0 / V9_16_13_63）：忠实文件名版本串区分，对照表无此卡型、不套芯片标签
    else label = "专用固件";
    if (verOf(it)) label += " · " + verOf(it);
    const dedup = label + "|" + it.file;
    if (spSeen.has(dedup)) continue;
    spSeen.add(dedup);
    out.push(mkBtn(it, label.trim()));
  }
  if (!out.length) return null;
  return { key: "firmware", label: "固件", items: out };
}
// 企微等纯文本通道：产品固件组降级为一行可点 markdown 链接，插到产品块规格书行之后（无规格书行则挂标题行下）
function wecomFirmwareLine(p) {
  const fg = p && p.firmwareGroup;
  if (!fg || !Array.isArray(fg.items) || !fg.items.length) return "";
  const links = fg.items.map((it) => "[" + it.clean + "](" + it.url + ")").join("、");
  return "· 固件：" + links;
}
function injectFirmwareLine(text, p) {
  const line = wecomFirmwareLine(p);
  if (!line || /· 固件：/.test(text)) return text;
  const spec = text.match(/^· 规格书：[^\n]*/m);
  if (spec) return text.slice(0, spec.index + spec[0].length) + "\n" + line + text.slice(spec.index + spec[0].length);
  const head = text.match(/^【[^\n】]+】/m);
  if (head) return text.slice(0, head.index + head[0].length) + "\n" + line + text.slice(head.index + head[0].length);
  return line + "\n" + text;
}

// ============ 搜芯片：主驱动系列 → 每款接收卡“该系列最新固件”下载（与卡型页同源 manifest，绝不编文件名） ============
const CHIP_FW_FAMILY_LABEL = { "63": "ICN1063系列", "65": "ICN2065系列", "97": "LS9937系列", "99": "LS99系列", common: "通用" };
function chipFirmwareDownloads(family) {
  if (!family) return [];
  const all = loadFirmwareManifest();
  // 与卡型页 firmwareGroupFor 完全同口径：通用=commonCode；四大系列=series 命中且非专用
  const inFamily = (it) => family === "common"
    ? !!it.commonCode
    : !it.commonCode && !it.specialCode && String(it.series) === String(family);
  const byCard = new Map();
  for (const it of all) {
    if (it.status && it.status !== "uploaded") continue;
    if (!it.publicUrl || !inFamily(it)) continue;
    const card = String(it.card || "").trim();
    if (!card) continue;
    const cur = byCard.get(card);
    if (!cur || fwVerScore(fwFpgaVersion(it.file)) > fwVerScore(fwFpgaVersion(cur.file))) byCard.set(card, it);
  }
  return [...byCard.values()]
    .sort((a, b) => String(a.card).localeCompare(String(b.card), "zh-Hans-CN"))
    .map((it) => {
      const cardShort = String(it.card).replace(/^HD[-_]?/i, "");
      const label = (cardShort + " · " + fwFpgaVersion(it.file)).replace(/\s+/g, " ").trim();
      return { card: it.card, name: it.file, clean: label, btn: label, url: it.publicUrl, kind: "firmware", ver: fwFpgaVersion(it.file) };
    });
}
// 给芯片速查结果挂“按卡型下载固件”：仅主驱动芯片（primary.firmwareFamily 非空）；译码/借用芯片为 null、自动不挂
function enrichChipFirmware(cf) {
  if (!cf || !cf.hitCount || !cf.primary) return cf;
  const fam = cf.primary.firmwareFamily;
  if (fam) {
    cf.firmwareItems = chipFirmwareDownloads(fam);
    cf.firmwareFamily = fam;
    cf.firmwareSeriesLabel = CHIP_FW_FAMILY_LABEL[fam] || "";
  }
  return cf;
}
// 企微纯文本通道：搜芯片给固件时不堆十几个链接，引导客户回接收卡型号、走卡型页固件闭环（injectFirmwareLine）
function wecomChipFwLine(cf) {
  const items = cf && Array.isArray(cf.firmwareItems) ? cf.firmwareItems : [];
  if (!items.length) return "";
  const label = cf.firmwareSeriesLabel || "对应";
  return `· 固件下载：该芯片对应 ${items.length} 款接收卡的${label}固件，回复你的接收卡型号（如 R708）即可直接获取下载；也可在产品速查页「固件」分类按卡型下载。`;
}

// ============ 资料分类浏览（快查站空词分组：规格书/说明书按产品大类、固件按接收卡型号，与视频分类同构） ============
// 资料分类组内排序：视频处理器/拼接器按官网网口档位（ports→带载点数）从小到大，拼接器 VP8000 沉底；
// KV 二合一与 VP 同档，自然序 K<V 使 KV 居档首；型号→档位取配单引擎设备目录（仅 sync-processor，排除 sender）。
const DOC_PROC_RANK = (() => {
  const m = new Map();
  for (const d of (orderEng.PROCESSORS || [])) {
    if (d.deviceClass !== "sync-processor") continue;
    m.set(String(d.name).toUpperCase(), { ports: Number(d.ports) || 0, max: Number(d.max) || 0 });
  }
  return m;
})();
function docNaturalCmp(a, b) {
  const ta = String(a).toUpperCase().split(/(\d+)/).filter(Boolean);
  const tb = String(b).toUpperCase().split(/(\d+)/).filter(Boolean);
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const na = /^\d+$/.test(ta[i]); const nb = /^\d+$/.test(tb[i]);
    let c;
    if (na && nb) c = Number(ta[i]) - Number(tb[i]);
    else if (na !== nb) c = na ? -1 : 1;
    else c = ta[i].localeCompare(tb[i], "zh-Hans-CN");
    if (c) return c;
  }
  return ta.length - tb.length;
}
function docRankOf(model) {
  const m = String(model).toUpperCase();
  if (DOC_PROC_RANK.has(m)) return { group: 0, ...DOC_PROC_RANK.get(m) };
  if (/^VP8000/.test(m)) return { group: 2, ports: 0, max: 0 };
  return { group: 1, ports: 0, max: 0 };
}
function docBucketSorter(key) {
  if (key !== "processor") return (a, b) => String(a.model).localeCompare(String(b.model), "zh-Hans-CN");
  return (a, b) => {
    const ra = docRankOf(a.model); const rb = docRankOf(b.model);
    if (ra.group !== rb.group) return ra.group - rb.group;
    if (ra.group === 0) {
      if (ra.ports !== rb.ports) return ra.ports - rb.ports;
      if (ra.max !== rb.max) return ra.max - rb.max;
    }
    return docNaturalCmp(a.model, b.model);
  };
}

function buildDocsCategory(cat) {
  if (cat === "firmware") {
    // 固件只做接收卡：以接收卡型号为单位，每组直接复用产品卡同源 firmwareGroupFor（通用置顶+芯片系列+专用）
    const seen = new Set();
    const cards = [];
    for (const it of loadFirmwareManifest()) {
      if (it.status && it.status !== "uploaded") continue;
      if (!it.publicUrl || !it.card) continue;
      const key = String(it.card).toUpperCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(String(it.card).trim());
    }
    cards.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const groups = [];
    let total = 0;
    for (const card of cards) {
      const fg = firmwareGroupFor(card);
      if (!fg || !Array.isArray(fg.items) || !fg.items.length) continue;
      total += fg.items.length;
      groups.push({ key: card, label: card, count: fg.items.length, items: fg.items });
    }
    return { groups, total, modelCount: groups.length };
  }
  // 规格书/说明书：遍历产品库（幽灵型号过滤），取本型号该类资料，按确定性大类聚合，组内按型号折叠
  const products = loadProductIndex();
  const specs = loadProductSpecs();
  const buckets = new Map();
  let total = 0;
  for (const p of products) {
    const name = p.displayName || p.product;
    if (isGhostProduct(name)) continue;
    const ext = extractSpecFiles(name);
    const g = (ext.groups || []).find((x) => x.key === cat);
    if (!g || !g.items.length) continue;
    const sp = specs[name] || {};
    const officialSeries = Array.isArray(p.selector) ? p.selector.filter((x) => x && x.label === "产品系列" && x.text).map((x) => "产品系列：" + x.text).join(" ") : "";
    const seriesText = String((sp.keyParameters && sp.keyParameters.productSeries) || "") + " " + officialSeries + " " +
      (p.facts || []).join(" ") + " " + ((p.fields && p.fields.operation) || []).join(" ");
    const ck = docCategory.classifyDocModel(name, seriesText);
    if (!buckets.has(ck)) buckets.set(ck, []);
    const model = String(name).replace(/^HD[-_ ]?/, "");
    buckets.get(ck).push({ model, items: g.items });
    total += g.items.length;
  }
  const groups = [];
  for (const c of docCategory.DOC_CATEGORIES) {
    const arr = buckets.get(c.key);
    if (!arr || !arr.length) continue;
    arr.sort(docBucketSorter(c.key));
    groups.push({ key: c.key, label: c.label, count: arr.length, fileCount: arr.reduce((n, x) => n + x.items.length, 0), products: arr });
  }
  return { groups, total, modelCount: groups.reduce((n, g) => n + g.count, 0) };
}

function searchProducts(keyword) {
  const q = String(keyword || "").trim().toUpperCase();
  if (!q) return [];
  const qLetters = (q.match(/^[A-Z]+/) || [""])[0]; // 查询字母前缀（C16→C、VP620→VP；纯数字则为空）
  const products = loadProductIndex();
  const results = [];
  for (const p of products) {
    const productName = p.displayName || p.product;
    const name = String(productName || "").toUpperCase();
    const aliases = (p.aliases || []).map((a) => String(a).toUpperCase());
    const bare = name.replace(/^HD-/, "");
    // 下市/英文误切＝硬隐藏，任何情况都不展示；仅“聚合幽灵”（自身无规格书、却是更长衍生型号前缀的真实裸款，
    // 如 A3 之于 A3L/A30）在分类浏览/模糊搜索时折叠，但客户精确点名（名称或别名完全相等）时放行给自身，
    // 不得被尾缀衍生款顶替——短型号 X 不能静默答成 X+尾缀（A3≠A3L、C16≠C16L）。
    const exactPoint = bare === q || aliases.some((a) => a === q);
    if (isHardHidden(productName)) continue;
    // 聚合幽灵仅在“客户精确点名 且 官网配单库确有此真实型号”时放行（A3 真实在册→给 A3 自身）；
    // 官网无此型号的前缀巧合（如 W6 之于 W60/W62）即使精确输入也继续折叠，不复活假型号。
    if (isGhostProduct(productName) && !(exactPoint && isOfficialSelectable(productName))) continue;
    const facts = (p.facts || []).map((f) => String(f).toUpperCase()).join(" ");
    // 匹配层级（取最高档，不累加）：数字主体精确 > 以查询结尾 > 包含；同层再按时间线
    const qDigits = (q.match(/\d+/) || [""])[0];
    const nameDigits = (bare.match(/\d+/) || [""])[0];
    const bareLetters = (bare.match(/^[A-Z]+/) || [""])[0];
    const prefixOk = !qLetters || bareLetters === qLetters; // 查询带前缀时型号前缀须一致（搜C16不让D16/T16混入）
    let tier = 0;
    if (bare === q) tier = 100;                                              // 完整型号精确
    else if (aliases.some((a) => a === q)) tier = 90;                        // 别名精确
    else if (qDigits && nameDigits === qDigits && prefixOk) tier = 85;       // 数字主体精确且前缀一致：搜620→VP620，搜1620→VP1620
    else if (q.length >= 2 && bare.endsWith(q)) tier = 70;                   // 型号以查询结尾
    else if (bare.includes(q)) tier = 50;                                    // 型号包含查询
    // 别名只认“前缀”关系（对齐旧快查站 startsWith）：型号别名以查询开头，或查询以完整型号别名开头（别名须含数字且≥3字符）。
    // 不再用任意位置双向 includes，避免芯片长串（如 ICN1065L 末尾含“5L”）被产品短别名（A5L 的别名 5L）跨位误命中。
    else if (aliases.some((a) => a.startsWith(q) || (q.startsWith(a) && /\d/.test(a) && a.length >= 3))) tier = 40;
    // 参数文本弱命中仅对“带字母”的查询生效；纯数字（常是芯片数字别名，如 2025/5166）不参与，
    // 避免撞规格书里的年份(2025)、参数数值(最高5120)、规格书罗列的芯片串(138,5166,2012…)而误判成产品。
    else if (/[A-Z]/.test(q) && facts.includes(q)) tier = 15;
    if (tier > 0) {
      const productName = p.displayName || p.product;
      const specFiles = extractSpecFiles(productName);
      const pdDetail = buildProductDetail(productName);
      results.push({
        name: productName,
        aliases: p.aliases || [],
        keyParams: extractSpecParams(productName),
        features: buildProductFeatures(productName),
        featureDetail: pdDetail.detail, // 小灰机：把短标签扩成的专业介绍段（快查站仍用 features.highlights）
        featureAdv: pdDetail.adv || "", // 竞品级亮点单独成行、标签左置顶
        specFiles: specFiles.files,
        specLinks: specFiles.links,
        specPairs: specFiles.pairs,
        specGroups: specFiles.groups,
        firmwareGroup: firmwareGroupFor(productName), // 接收卡产品：规格书下方的「固件」按钮组；非接收卡/无固件为 null 不显示
        matchTier: tier,
        recency: suffixRecency(bare), // 同系列版本新旧（C最新 > S > 裸款最早）
        selOrder: (p.selectionOrder == null ? -1 : p.selectionOrder),
        rawScore: (p.score || 0)
      });
    }
  }
  // 已有正经型号命中（tier≥50：精确/结尾/包含）时，丢弃 tier15 的参数文本弱命中，
  // 避免搜接收卡 R708 时把 facts 里顺带提到 R708 的控制卡（如 HD-A6）跨系列带出串味；
  // 只有在没有任何型号级命中、纯功能词搜索时，才保留 tier15 作兜底。
  const hasStrongHit = results.some((r) => r.matchTier >= 50);
  const ranked = hasStrongHit ? results.filter((r) => r.matchTier !== 15) : results;
  // 1)匹配精确度（打1620时VP1620系列仍高于VP620）；2)同匹配层(即同系列)内新版本在前：C>H>S>A/L/T>裸款；
  // 3)同新旧再按选型时间线；4)产品自身分；5)名称
  return ranked.sort((a, b) =>
    b.matchTier - a.matchTier
    || b.recency - a.recency
    || b.selOrder - a.selOrder
    || b.rawScore - a.rawScore
    || a.name.localeCompare(b.name, "zh-Hans-CN")
  ).slice(0, 10);
}

// 同系列型号的“版本新旧分”（越大越新、推荐越靠前）。发布时间口径（用户拍板）：
// 无尾缀最早 → S 次之 → C 最晚（最新）；H=高配（实际晚于 S）、A=改款、L=低配、T及其它=衍生款，均新于裸基础款。
// 只取数字主体后的第一个字母定主代次；同一系列里几乎不会同时出现 A/L/T 竞争，固定取值保证结果确定、不写死型号。
function suffixRecency(name) {
  const bare = String(name || "").replace(/^HD[\s-]?/i, "").toUpperCase();
  const m = bare.match(/^[A-Z]+\d+([A-Z])/); // 数字主体后的第一个尾缀字母（忽略 PRO/PLUS/-U 等附加段）
  const head = m ? m[1] : "";
  if (head === "C") return 40; // 最新代
  if (head === "H") return 30; // 高配
  if (head === "S") return 20; // 次新代
  if (head === "T") return 18;
  if (head === "A") return 16; // 改款
  if (head === "L") return 14; // 低配
  if (head) return 10;         // 其它衍生尾缀：新于裸款、低于明确代次
  return 0;                    // 无尾缀裸基础款：最早
}

// 产品系列键：HD-VP410H -> VP410；HD-C16L -> C16；HD-R512T -> R512
function seriesKeyOf(name) {
  const nm = String(name || "").replace(/^HD[\s-]?/i, "").toUpperCase();
  const m = nm.match(/^([A-Z]+)[\s-]?(\d+)/);
  if (!m) return "";
  const digits = m[2];
  return m[1] + digits.slice(0, digits.length >= 3 ? 3 : digits.length);
}
// 依据查询词与“名称/别名强命中”的结果，给出同系列兄弟型号可点词条（排除已在结果中的）
// 注意：只认名称/别名命中，参数文本(facts)里顺带提到型号的产品不算同系列，避免跨系列串味
function buildRelatedChips(results, q) {
  const products = loadProductIndex();
  const QU = String(q || "").trim().toUpperCase();
  // 1) 相关系列及其优先级：查询词字母前缀系列最高；纯数字时取“名称/别名强命中”结果的系列，按命中数排序
  const keyScore = new Map();
  const mq = QU.match(/^([A-Z]+)[\s-]?(\d+)/);
  if (mq) {
    const digits = mq[2];
    keyScore.set(mq[1] + digits.slice(0, digits.length >= 3 ? 3 : digits.length), 999);
  }
  for (const r of results) {
    const name = String(r.name || "").toUpperCase();
    const aliases = (r.aliases || []).map((a) => String(a).toUpperCase());
    const strongHit = QU && (name.includes(QU) || aliases.some((a) => a.includes(QU)));
    if (strongHit) {
      const k = seriesKeyOf(r.name);
      if (k) keyScore.set(k, (keyScore.get(k) || 0) + 1);
    }
  }
  if (!keyScore.size) return [];
  // 最多覆盖 4 个相关系列，避免纯数字查询时铺太多
  const orderedKeys = [...keyScore.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, 4);
  // 2) 始终列出这些系列的全部型号供点选（不再因“已在结果列表”而隐藏），总量封顶 12
  const chips = [];
  const seen = new Set();
  for (const k of orderedKeys) {
    const members = products.filter((p) => {
      const nm = p.displayName || p.product;
      return nm && !isGhostProduct(nm) && seriesKeyOf(nm) === k;
    });
    // 同系列可点型号同样“新版本在前”：C>H>S>A/L/T>裸款，同新旧再按名称，保证与结果首位口径一致
    members.sort((a, b) =>
      suffixRecency(b.displayName || b.product) - suffixRecency(a.displayName || a.product)
      || String(a.displayName || a.product).localeCompare(String(b.displayName || b.product), "zh-Hans-CN")
    );
    for (const p of members) {
      const nm = p.displayName || p.product;
      if (seen.has(nm)) continue;
      seen.add(nm);
      chips.push({ label: nm, q: nm });
      if (chips.length >= 12) return chips;
    }
  }
  return chips;
}

// 说明：快查站不提供固件检索（固件归售后小灰机）。firmware-index.json 保留在 data/ 供售后侧使用，快查站不加载。


return {loadProductIndex, searchProducts, buildRelatedChips, buildDocsCategory, firmwareGroupFor, enrichChipFirmware, injectFirmwareLine, wecomChipFwLine, extractSpecFiles};
}
module.exports={createCatalogService};
