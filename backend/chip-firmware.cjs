// 芯片固件速查（业务逻辑层）
// 移植自旧快查站：chip-model-index（芯片选型 V4.8）+ firmware-display-rules（5家族白名单/异步卡尾缀）
// + receiver-card-firmware-suffixes（接收卡 GH 尾位）+ firmware-guidance 引擎。
// 只输出灰度自家产品/支持芯片对应的固件类别与卡型尾缀，不提供固件文件。
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8").replace(/^﻿/, ""));
}

let _chipIndex = null;
let _displayRules = null;
let _receiverSuffixes = null;
function chipIndex() {
  if (!_chipIndex) _chipIndex = loadJson("chip-model-index.json");
  return _chipIndex;
}
function displayRules() {
  if (!_displayRules) _displayRules = loadJson("firmware-display-rules.json");
  return _displayRules;
}
function receiverSuffixes() {
  if (!_receiverSuffixes) _receiverSuffixes = loadJson("receiver-card-firmware-suffixes.json");
  return _receiverSuffixes;
}

// ---------- 分词（与旧站 icTerms/normalizeIcKey 一致）----------
function normalizeIcKey(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/芯片|固件|升级|用|什么|哪个|哪一个|对应|系列|firmware/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function icTerms(value) {
  const text = String(value == null ? "" : value);
  const terms = new Set();
  const add = (item) => {
    const key = normalizeIcKey(item);
    if (key.length >= 2) terms.add(key);
  };
  add(text);
  text.split(/[\s/、,，或和]+/).forEach(add);
  (text.match(/[a-z]{0,5}\d{2,6}[a-z]{0,3}/gi) || []).forEach((item) => {
    add(item);
    const part = normalizeIcKey(item);
    const parsed = part.match(/^([a-z]*)(\d{2,6})([a-z]{0,3})$/i);
    if (parsed) {
      add(`${parsed[2]}${parsed[3] || ""}`);
      add(parsed[2]);
    }
  });
  return [...terms];
}

// ---------- 芯片大类标签 ----------
function categoryOf(models) {
  const first = String((models || [])[0] || "").toUpperCase();
  const prefix = (first.match(/^[A-Z]+/) || [""])[0];
  const labels = {
    SM: "SM系列芯片", HX: "HX系列芯片", ICN: "ICN系列芯片", ICND: "ICN系列芯片",
    FM: "FM系列芯片", MBI: "MBI系列芯片", DP: "DP系列芯片", LS: "LS系列芯片",
    CFD: "CFD系列芯片", C8: "C8/CFD系列芯片", SUM: "SUM系列芯片", LYD: "LYD系列芯片"
  };
  return labels[prefix] || (prefix ? `${prefix}系列芯片` : "芯片选型");
}

// 把芯片选型行规整成搜索行
function chipRows() {
  return chipIndex().rows.map((row) => ({
    models: Array.isArray(row.models) ? row.models : [],
    numericAliases: Array.isArray(row.numericAliases) ? row.numericAliases : [],
    chip: (Array.isArray(row.models) ? row.models : []).filter(Boolean).join("/"),
    // 匹配文本同时纳入数字别名，保证输纯数字也能命中
    matchText: [
      ...(Array.isArray(row.models) ? row.models : []),
      ...(Array.isArray(row.numericAliases) ? row.numericAliases : [])
    ].join("/"),
    setting: String(row.smartSelection || ""),
    firmware: String(row.firmwareType || ""),
    category: categoryOf(row.models),
    page: Number(row.page || 0)
  })).filter((r) => r.chip);
}

// ---------- 芯片反查打分 ----------
function scoreRow(row, queryKeys) {
  const chipTerms = icTerms(row.matchText);
  const settingTerms = icTerms(row.setting);
  const firmwareTerms = icTerms(row.firmware);
  const categoryTerms = icTerms(row.category);
  let score = 0;
  for (const key of queryKeys) {
    const hasSuffix = /\d+[a-z]+$/i.test(key);
    if (chipTerms.includes(key)) score = Math.max(score, hasSuffix ? 1550 : 1000);
    const isSpecificSetting = /(?:[a-z]+\d|\d+[a-z]+)/i.test(key);
    if (settingTerms.includes(key)) score = Math.max(score, hasSuffix || isSpecificSetting ? 1450 : 850);
    if (firmwareTerms.includes(key)) score = Math.max(score, 650);
    if (categoryTerms.includes(key)) score = Math.max(score, 300);
  }
  return score;
}
function evidenceScore(row) {
  return (String(row.firmware || "").trim() ? 2 : 0) + (String(row.setting || "").trim() ? 1 : 0);
}
function searchChipFirmware(query) {
  const keys = icTerms(query).filter((k) => k.length >= 2);
  if (!keys.length) return [];
  const exactKey = normalizeIcKey(query);
  return chipRows()
    .map((row) => {
      const chipTerms = icTerms(row.matchText);
      const settingTerms = icTerms(row.setting);
      const exactScore = exactKey && chipTerms.includes(exactKey) ? 1600
        : exactKey && settingTerms.includes(exactKey) ? 1400 : 0;
      return { ...row, score: Math.max(exactScore, scoreRow(row, keys)) };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score
      || evidenceScore(b) - evidenceScore(a)
      || a.category.localeCompare(b.category, "zh-Hans-CN")
      || a.chip.localeCompare(b.chip, "zh-Hans-CN"))
    .slice(0, 30);
}

// ---------- 固件指引引擎（移植 firmware-guidance.js）----------
const DEDICATED_MARKERS = ["专用", "旧版", "旧卡", "定制", "特殊", "临时", "测试"];
function normText(v) {
  return String(v == null ? "" : v).trim().toUpperCase().replace(/[\s_\-./\\]+/g, "");
}
function classifyFirmwareType(firmwareType) {
  const raw = String(firmwareType || "").trim();
  if (!raw) return { status: "unverified", familyKey: null, label: "未明确固件类别", seriesField: null };
  const text = normText(raw);
  const isDedicated = DEDICATED_MARKERS.some((m) => raw.includes(m));
  if (/LS9937|97系列/.test(text)) {
    return { status: isDedicated ? "dedicated" : "confirmed", familyKey: "97", label: raw, seriesField: "97" };
  }
  if (isDedicated) return { status: "dedicated", familyKey: null, label: raw, seriesField: null };
  if (/通用固件|^通用$/.test(text)) return { status: "confirmed", familyKey: "common", label: raw, seriesField: null };
  if (/ICN1063系列固件|^63系列固件$/.test(text)) return { status: "confirmed", familyKey: "63", label: raw, seriesField: "63" };
  if (/ICN2065系列固件|^65系列固件$/.test(text)) return { status: "confirmed", familyKey: "65", label: raw, seriesField: "65" };
  if (/LS99系列固件|^99系列固件$/.test(text)) return { status: "confirmed", familyKey: "99", label: raw, seriesField: "99" };
  return { status: "dedicated", familyKey: null, label: raw, seriesField: null };
}
function canonicalFamilyKey(value) {
  if (value && typeof value === "object") return value.familyKey || null;
  const direct = String(value || "").toLowerCase();
  if (["common", "63", "65", "97", "99"].includes(direct)) return direct;
  return classifyFirmwareType(value).familyKey;
}
function customerModelName(model) {
  const names = (displayRules().modelDisplayNames) || {};
  const hit = Object.entries(names).find(([k]) => normText(k) === normText(model));
  return (hit && hit[1]) || model;
}
function familySuffixFacts(classification) {
  const familyKey = classification.familyKey || canonicalFamilyKey(classification);
  if (!familyKey) return { receiverSeriesField: null, asyncMappings: [] };
  const bySuffix = new Map();
  for (const family of displayRules().asyncFamilies || []) {
    const mapping = family.mappings && family.mappings[familyKey];
    if (!mapping || mapping.status !== "confirmed" || mapping.suffix == null) continue;
    const suffix = String(mapping.suffix);
    const models = bySuffix.get(suffix) || [];
    for (const m of family.models || []) {
      const v = customerModelName(m);
      if (v && !models.includes(v)) models.push(v);
    }
    bySuffix.set(suffix, models);
  }
  return {
    receiverSeriesField: classification.seriesField || null,
    asyncMappings: [...bySuffix].filter(([, ms]) => ms.length).map(([suffix, ms]) => ({ models: ms, suffix }))
  };
}
function receiverRows(model) {
  if (!model) return [];
  return (receiverSuffixes().rows || []).filter((r) =>
    [...(r.models || []), ...(r.aliases || [])].some((n) => normText(n) === normText(model)));
}
function receiverTail(model, variant) {
  const candidates = receiverRows(model);
  if (!candidates.length) return null;
  let picked = candidates;
  const v = String(variant || "").toLowerCase();
  if (v) picked = candidates.filter((r) => String(r.variant || "").toLowerCase() === v);
  // 无变体时优先标准款；仍多个则取第一个（通用码另用 receiverCommonCodes 合并）
  if (picked.length !== 1) {
    const std = picked.filter((r) => String(r.variant || "standard") === "standard");
    picked = std.length ? std : picked;
  }
  return picked.length ? String(picked[0].suffix || "") : null;
}
// 该接收卡的通用/基础固件系列码（00/01/02…，可能多个，全部返回）
function receiverCommonCodes(model) {
  const set = new Set();
  for (const r of receiverRows(model)) (r.commonCodes || []).forEach((c) => set.add(c));
  return [...set].sort();
}
// 全部接收卡的通用系列码去重汇总（通用固件芯片不指定卡型时直接列出 00/01/02…）
let _allCommonCodes = null;
function allReceiverCommonCodes() {
  if (_allCommonCodes) return _allCommonCodes;
  const set = new Set();
  for (const r of receiverSuffixes().rows || []) (r.commonCodes || []).forEach((c) => set.add(c));
  _allCommonCodes = [...set].sort();
  return _allCommonCodes;
}
function asyncSuffix(model, classification) {
  const familyKey = classification.familyKey || canonicalFamilyKey(classification);
  if (!model || !familyKey) return null;
  for (const family of displayRules().asyncFamilies || []) {
    const hit = (family.models || []).some((m) => normText(m) === normText(model));
    if (!hit) continue;
    const mapping = family.mappings && family.mappings[familyKey];
    if (mapping && mapping.status === "confirmed" && mapping.suffix != null) return String(mapping.suffix);
  }
  return null;
}
// 从查询里识别接收卡/异步卡型号
function deviceSelection(query) {
  const normalized = String(query || "").toUpperCase().replace(/R\s+(?=\d)/g, "R").replace(/\s+PLUS\b/g, " PLUS");
  const receiverMatch = normalized.match(/\b(?:R\d{1,4}[A-Z]*(?:\s*PLUS)?|K08|K12|RB6|RP375)\b/);
  const asyncMatch = normalized.match(/\b(?:C08L|C16H|C16L|C16|C36|D16|D36)\b/);
  const variant = /定制|订制|客制|CUSTOM/i.test(query || "") ? "custom"
    : /标准|常规|STANDARD/i.test(query || "") ? "standard" : undefined;
  return {
    receiverModel: receiverMatch ? receiverMatch[0].replace(/\s+/g, " ") : undefined,
    receiverVariant: variant,
    asyncModel: asyncMatch ? asyncMatch[0] : undefined
  };
}

// 判定一行芯片是不是“主驱动（要刷接收卡固件）”，以及它对应哪个固件系列（用于反查固件下载）。
// 选型表“固件列”明确归到 63/65/97/99 专用系列的，一律按主驱动——即使智能设置选了相近型号
// （如 SM16389SC 选 SM16389、LS9937S 选 LS9937、ICND2065L 选 ICN1065S），固件列是权威，
// 不能因“智能设置名不完全等于自己”就误判成译码而不给固件。
// 通用/空类别仍按原借用判定：SM16380 这类行扫配通用固件、RUL5158 这类选别的主驱动，不单独给下载。
function driverInfo(row) {
  const classification = classifyFirmwareType(row.firmware);
  const smartSetting = String(row.setting || "").trim();
  const selfChipNames = String(row.chip || "").split(/[\/\n]/).map((s) => normText(s.trim())).filter(Boolean);
  const settingPrimaryName = smartSetting.split(/或|\/|、/)[0].trim();
  const forcedDriver = ["63", "65", "97", "99"].includes(classification.familyKey);
  const decoderBorrowed = !forcedDriver && !!smartSetting && smartSetting !== "按资料表选择"
    && !!settingPrimaryName && !selfChipNames.includes(normText(settingPrimaryName));
  const famKey = classification.familyKey || canonicalFamilyKey(classification);
  // 可反查下载的固件系列：仅主驱动给；译码/借用芯片给 null（不出现下载按钮）。
  let firmwareFamily = null;
  if (!decoderBorrowed) {
    if (["63", "65", "97", "99"].includes(famKey)) {
      firmwareFamily = famKey;
    } else if (classification.familyKey === "common") {
      firmwareFamily = "common"; // 选型表明确标“通用固件”
    } else if (smartSetting && smartSetting !== "按资料表选择"
      && selfChipNames.includes(normText(settingPrimaryName))) {
      firmwareFamily = "common"; // 固件列空但智能设置选自己（如 DP32020→DP32020），属主驱动、刷通用 FPGA
    }
    // 固件列与智能设置都空（如裸 ICND2065、LS9937C）证据不足，保持 null、宁缺毋滥
  }
  return { classification, decoderBorrowed, firmwareFamily };
}

// 组装一张卡的 facts
function buildFacts(row, query) {
  const classification = classifyFirmwareType(row.firmware);
  const sel = deviceSelection(query);
  const sf = familySuffixFacts(classification);
  const hasExactDevice = Boolean(sel.receiverModel || sel.asyncModel);
  // 类别行只显示类别名（系列码统一由“接收卡固件尾缀”行表达，避免重复）
  const baseLabel = classification.label || row.firmware;
  // “未明确固件类别”是内部占位，不外露给客户；类别无法判定时直接从下面的尾缀/智能设置行给信息
  const facts = [];
  if (baseLabel && baseLabel !== "未明确固件类别") facts.push({ label: "资料固件类别", text: baseLabel });
  // 智能设置选择：软件里该芯片应选哪个型号（如 FM6363 或 ICN2163），原始选型表有就展示
  const smartSetting = String(row.setting || "").trim();
  // 配套译码（行扫）判定统一走 driverInfo：四大专用系列(63/65/97/99)按选型表固件列强制为主驱动；
  // 通用/空类别仍按“智能设置选了另一个型号”判借用（如 RUL5158 选 5958、SM16380 行扫配通用），不单独刷接收卡固件。
  const { decoderBorrowed } = driverInfo(row);
  if (smartSetting && smartSetting !== "按资料表选择") {
    facts.push({ label: "智能设置选择", text: smartSetting.replace(/\n+/g, "、") });
  }
  if (decoderBorrowed) {
    facts.push({ label: "芯片类型", text: `配套译码/行扫芯片，不单独刷接收卡固件；HDSet 智能设置选 ${smartSetting.replace(/\n+/g, "、")}，接收卡固件按模组主驱动芯片确定` });
  }
  const famKey = classification.familyKey || canonicalFamilyKey(classification);
  // 接收卡固件系列段跟着芯片走：63/65/97/99 系列即该码；通用固件列 00/01/02… 全集；译码芯片无尾缀。排在异步卡之上
  if (!sel.receiverModel && !decoderBorrowed) {
    const recvCodes = ["63", "65", "97", "99"].includes(famKey) ? [famKey] : allReceiverCommonCodes();
    if (recvCodes.length) facts.push({ label: "接收卡固件尾缀", text: recvCodes.join("/") });
  }
  if (!hasExactDevice && !decoderBorrowed && sf.asyncMappings.length) {
    // 每组只第一个型号保留 HD- 前缀，尾缀正常跟在冒号后，各组各占一行
    const lines = sf.asyncMappings.map((m) => {
      const names = m.models.map((x, i) => (i === 0 ? x : String(x).replace(/^HD-/, ""))).join("/");
      return `${names}：${m.suffix}`;
    });
    facts.push({ label: "异步卡固件尾缀", text: lines.join("\n") });
  }
  if (sel.receiverModel && !decoderBorrowed) {
    const rm = sel.receiverModel;
    const tail = receiverTail(rm, sel.receiverVariant);
    const commonCodes = receiverCommonCodes(rm);
    if (tail) {
      const commonDirs = commonCodes.map((c) => `${c}.${tail}`);
      const famCode = ["63", "65", "97", "99"].includes(classification.familyKey) ? classification.familyKey : null;
      let text;
      if (famCode) {
        // 当前芯片是具体系列：本系列目录优先，再附通用固件目录
        text = `本系列固件目录 ${famCode}.${tail}`
          + (commonDirs.length ? `；通用固件系列码 ${commonCodes.join("/")}（目录 ${commonDirs.join(" / ")}）` : "");
      } else if (commonCodes.length) {
        text = `系列码 ${commonCodes.join("/")}，硬件尾缀 ${tail}（固件目录 ${commonDirs.join(" / ")}）`;
      }
      facts.push(text
        ? { label: `${rm} 固件目录`, text }
        : { label: `${rm} 卡型尾位`, text: tail });
    }
  }
  if (sel.asyncModel) {
    const tail = asyncSuffix(sel.asyncModel, classification);
    if (tail) facts.push({ label: `${sel.asyncModel} 固件尾缀`, text: tail });
  }
  if (classification.status === "dedicated") {
    facts.push({ label: "专用固件", text: "必须继续匹配该专用类别的实际原文件，不能只凭系列字段推断完整文件。" });
  }
  return facts;
}

// ---------- 主入口 ----------
function buildChipFirmware(query) {
  const hits = searchChipFirmware(query);
  if (!hits.length) return null;
  const primary = hits[0];
  const primaryFacts = buildFacts(primary, query);
  const pInfo = driverInfo(primary);
  const firmwareLabel = primary.firmware || "查看智能设置选择";
  const title = hits.length > 1 && primary.score < 1000
    ? `${query} 相关固件：${firmwareLabel}`
    : `${primary.chip.replace(/\n/g, " / ")} 对应：${firmwareLabel}`;
  // 其他相近芯片：按相关度命中的其他行（跳过主行自身），逐型号拆成“芯片 → 系列固件”，供前端椭圆可点标签
  const selfNames = new Set(primary.chip.split("/").map((s) => s.trim()).filter(Boolean));
  const nearby = [];
  const seenName = new Set(selfNames);
  for (const h of hits.slice(1)) {
    const fwLabel = classifyFirmwareType(h.firmware).label || h.firmware;
    if (!fwLabel || fwLabel === "未明确固件类别") continue;  // 固件类别缺失的行不进相近标签
    for (const name of String(h.chip).split("/").map((s) => s.trim()).filter(Boolean)) {
      if (seenName.has(name)) continue;
      seenName.add(name);
      nearby.push({ chip: name, firmware: fwLabel });
    }
  }
  // 精确命中单行时 nearby 会为空：补“同前缀系列”的其他芯片，按数字接近度排序，
  // 跳过无固件类别的行，让问任一芯片下方都有可点的相近芯片
  const mainNumMatch = String(primary.chip).match(/\d+/);
  const mainNum = mainNumMatch ? Number(mainNumMatch[0]) : NaN;
  const numOf = (name) => { const m = String(name).match(/\d+/); return m ? Number(m[0]) : NaN; };
  const sameFamily = chipRows()
    .filter((r) => r.category === primary.category)
    .filter((r) => { const lab = classifyFirmwareType(r.firmware).label; return lab && lab !== "未明确固件类别"; })
    .sort((a, b) => {
      const da = Math.abs((numOf(a.chip) || 0) - (mainNum || 0));
      const db = Math.abs((numOf(b.chip) || 0) - (mainNum || 0));
      return da - db || a.chip.localeCompare(b.chip);
    });
  for (const r of sameFamily) {
    const fwLabel = classifyFirmwareType(r.firmware).label || r.firmware;
    for (const name of String(r.chip).split("/").map((s) => s.trim()).filter(Boolean)) {
      if (seenName.has(name)) continue;
      seenName.add(name);
      nearby.push({ chip: name, firmware: fwLabel });
    }
  }
  return {
    query,
    title,
    nearby: nearby.slice(0, 12),
    primary: {
      chip: primary.chip.replace(/\n/g, " / "),
      setting: primary.setting.replace(/\n/g, " / ") || "按资料表选择",
      category: primary.category,
      facts: primaryFacts,
      // 主驱动芯片才给固件系列（63/65/97/99/common），供上层反查每款接收卡的最新固件下载；译码芯片为 null
      firmwareFamily: pInfo.firmwareFamily,
      isDecoder: pInfo.decoderBorrowed
    },
    hitCount: hits.length,
    hits: hits.slice(0, 8).map((h) => ({
      chip: h.chip.replace(/\n/g, " / "),
      category: h.category,
      setting: h.setting.replace(/\n/g, " / ") || "按资料表选择",
      firmwareLabel: classifyFirmwareType(h.firmware).label || h.firmware,
      // 次要行不重复显示“资料固件类别”，按 label 过滤（类别行可能本就缺失，不能用 slice(1) 按位置删，否则会误删尾缀行）
      facts: buildFacts(h, query).filter((x) => x.label !== "资料固件类别")
    })),
    source: (function () {
      const f = chipIndex().sourceFile || "";
      return f.split(/[\\/]/).pop() || "芯片选型资料";
    })()
  };
}

module.exports = { buildChipFirmware, searchChipFirmware };
