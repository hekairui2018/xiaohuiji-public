'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadProductData}=require('./product-data.cjs');
const {documentBelongs}=require('./model-identity.cjs');
const {receiverLoadEvidence}=require('./product-parameters.cjs');
function createSpecCatalog({publicBase='',officialFilesDir=path.join(__dirname,'..','frontend','official-files'),getSpecs=()=>loadProductData().specs}={}) {
 const SPEC_PUBLIC_BASE=publicBase,OFFICIAL_FILES_DIR=officialFilesDir;
 const loadProductSpecs=getSpecs;
// 规格书参数标签映射
const SPECS_LABELS = { productSeries: "产品系列", load: "带载", resolution: "分辨率", interfaces: "接口", syncSupport: "同步支持", support: "支持功能" };
function hasChinese(s) { return /[\u4e00-\u9fa5]/.test(s); }
// A1：判断是否为“纯英文句子残句”（应不展示）。数字为主的分辨率/频率（如 3840×2160@60Hz、Wi-Fi）保留。
function isEnglishOnlySentence(s) {
  const t = String(s || "");
  if (hasChinese(t)) return false;            // 含中文不算
  const words = (t.match(/[A-Za-z]+/g) || []);
  if (words.length < 2) return false;         // 不足两个英文词：型号/数值/单词，保留
  const digits = (t.match(/\d/g) || []).length;
  if (digits >= 4 && digits / t.length > 0.25) return false; // 数字占比高=分辨率/频率规格，保留
  return true;                                // 多个英文词又无中文=英文描述残句，不展示
}
// 从规格书索引提取干净参数（去标签、去重、去产品名前缀、截断）
function extractSpecParams(productName) {
  const specs = loadProductSpecs();
  const spec = specs[productName];
  if (!spec || !spec.keyParameters) return {};
  const params = {};
  const seenValues = new Set();
  for (const [key, label] of Object.entries(SPECS_LABELS)) {
    let raw = String(spec.keyParameters[key] || "").trim();
    if (!raw || raw === "未从规格书索引中确认") continue;
    // 用?分隔多条，优先取含中文且最短的，没有中文取最短英文
    const parts = raw.split(/[?？]/).map((s) => s.trim()).filter(Boolean);
    const chineseParts = parts.filter(hasChinese);
    let picked = (chineseParts.length ? chineseParts : parts).sort((a, b) => a.length - b.length)[0];
    // 去掉开头的产品名前缀（HD-XXX 或 XXX）
    picked = picked.replace(/^HD[-_]?[A-Z0-9]+\s*/i, "").replace(/^[A-Z]{1,3}\d+[A-Z0-9]*\s*/, "");
    // 去掉开头的中英文标签（"分辨率：""Resolution:""Support"等）
    picked = picked.replace(/^(分辨率|接口|带载|同步支持|支持功能|产品系列|Resolution|Support|Maximum|The|Note)[：:\s]*/i, "");
    // 去掉多余空格
    picked = picked.replace(/\s+/g, " ").trim();
    // A1补充①：删开头“两个及以上连续英文词”的残句前缀（如 "VESA standard , ≤3840" → "≤3840"）；
    //   单个英文规格词（HDMI/VESA/Wi-Fi）或“英文+数字”（HDMI 1.4）不在此列，保留
    picked = picked.replace(/^[A-Za-z]{2,}(?:[\s,]+[A-Za-z]{2,})+[\s,]*(?=[一-龥\d≤≥<>])/, "").trim();
    // A1补充②：型号被打散后残留的开头数字碎片（如 "4 10 是一款" → "是一款"）；数字直接接中文(65万)不受影响
    picked = picked.replace(/^\d+(?:[\s,/]+\d+)*[\s,]+(?=[一-龥])/, "").trim();
    // 去重：和已有参数值相似度太高则跳过
    const norm = picked.replace(/[\s，,。.、]/g, "").slice(0, 30);
    if (seenValues.has(norm)) continue;
    seenValues.add(norm);
    // A1：纯英文描述残句一律不展示（数字为主的分辨率/频率会保留）；中文长句截断到120字仍可读
    if (isEnglishOnlySentence(picked)) continue;
    if (picked.length > 120) picked = picked.slice(0, 117) + "...";
    if (picked && picked.length > 2) params[label] = picked;
  }
  const conditional = /^HD-R\d/i.test(productName) ? receiverLoadEvidence(spec.keyParameters) : null;
  if (conditional) params["带载"] = conditional.text;
  return params;
}
// 提取规格书文件和本地PDF链接（统一中文在前）

function specFileSortPriority(fname) {
  // 排序优先级：中文已签章 > 中文普通 > 英文已签章 > 英文普通
  const hasChinese = /[\u4e00-\u9fa5]/.test(fname);
  const isSigned = /已签章|签章|signed/i.test(fname);
  if (hasChinese && isSigned) return 0;
  if (hasChinese) return 1;
  if (isSigned) return 2;
  return 3;
}
// 去 HD- 前缀的型号本体（HD-VP410H → VP410H）
function bareSpecModel(name) { return String(name || "").toUpperCase().replace(/^HD[-_]?/, "").trim(); }
// 规格书严格归属：文件名里必须把“本型号”当完整词出现，且型号后不能再跟字母/数字。
// 这样 HD-VP410 不会错收 VP410A/VP410H 的文件，HD-VP410H 也不会错收基础款 VP410 的文件；本型号没有就留空，不瞎给。
// 额外排除“型号 + 空格 + 英文变体词”：基础款 DCS4000 不得收 “DCS4000 Pro规格书”、R5S 不得收 “R5s Plus规格书”
// （型号后紧跟空格+英文字母即视为更长的型号；“&”等符号或中文不算，故 “VP630 & VP830使用说明书” 仍能正确归到 VP630）。
const specFileBelongs = documentBelongs;
// 资料分组定义（对外中文 PDF 实际只有：规格书 / 使用说明书，其余兜底为“资料”；接线图、固件不在此文件池）
const DOC_GROUP_ORDER = [
  { key: "spec", label: "规格书" },
  { key: "manual", label: "使用说明书" },
  { key: "other", label: "资料" }
];
function classifyDoc(fname) {
  if (/说明书|使用说明|操作说明|用户手册|操作手册|手册/.test(fname)) return "manual";
  if (/规格书|规格/.test(fname)) return "spec";
  return "other";
}
// 同版去重指纹：忽略“已签章”标记、浏览器重复下载后缀 (2)、空白与大小写，让“v1.1”与“v1.1_已签章”视为同一版（排序已让签章版在前，去重即保留正式签章版）
// 干净展示名：只去扩展名/签章/重复下载后缀/下划线噪音，保留型号，使按钮名与真实文件一一对应（如“HD-VP210H规格书 v1.1”）
function cleanDocName(fname) {
  return fname.replace(/\.pdf$/i, "").replace(/[_\s-]*已?签章/g, "").replace(/\s*\(\d+\)\s*/g, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
// 组内按钮短名：剥离类别词只留版本等差异（“规格书 v1.1”→“v1.1”）；剥空了回退“查看”
function docBtnLabel(clean, groupKey) {
  let s = clean;
  if (groupKey === "manual") s = s.replace(/使用说明书|操作说明|使用说明|说明书|用户手册|操作手册|手册/g, "");
  else if (groupKey === "spec") s = s.replace(/规格书|规格/g, "");
  s = s.replace(/^[\s:：\-]+|[\s:：\-]+$/g, "").trim();
  return s || "查看";
}
function extractSpecFiles(productName) {
  const specs = loadProductSpecs();
  const spec = specs[productName];
  if (!spec) return { files: [], links: [], pairs: [], groups: [] };
  const want = bareSpecModel(productName);
  const candidates = (spec.specificationFiles || [])
    .filter((f) => /\.pdf$/i.test(f))
    .filter((f) => /[一-龥]/.test(f)) // 只对外提供中文文档（规格书/说明书）；英文Specification不展示、也未上云，避免OSS 404
    .filter((f) => specFileBelongs(f, want)) // 只挂本型号，杜绝跨型号错挂
    .sort((a, b) => specFileSortPriority(a) - specFileSortPriority(b));
  // 同类资料只保留最高版本：规格书/说明书按“去版本号+去签章”指纹归并，版本号按数值分段比较取最高
  // （V1.10 高于 V1.9、V3.1 高于 V1.0）；同版本保留排序最前者（中文已签章优先，已由上面排序保证）。
  // 型号后缀不同（Pro / 1U / Plus 等）指纹自然不同，绝不误并；“资料/接线图”等 other 类不归并、多份全留。
  const docVerOf = (f) => {
    const m = f.match(/[vV]\d+(?:\.\d+)+/);
    return m ? m[0].replace(/^[vV]/, "").split(".").map(Number) : [0];
  };
  const cmpDocVer = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  };
  const versionBaseKey = (f, cls) =>
    f.replace(/\.pdf$/i, "").replace(/[_\s-]*已?签章/g, "").replace(/\s*\(\d+\)\s*/g, "").replace(/[vV]\d+(?:\.\d+)+/g, "")
      .replace(/^hd[-_\s]?/i, "").replace(/[\s_\-]+/g, "").toLowerCase() + "|" + cls; // 归一 HD- 前缀与空格/下划线/连字符差异（修 HD-MS2000规格书 与 MS2000规格书 同形态两份未合并）；形态后缀 TP/1U/×N/Pro/Plus 是字母数字，去分隔符后串仍不同，不会误并
  const versionChamp = new Map();
  for (const f of candidates) {
    const cls = classifyDoc(f);
    if (cls !== "spec" && cls !== "manual") continue;
    const k = versionBaseKey(f, cls);
    const cur = versionChamp.get(k);
    if (!cur || cmpDocVer(docVerOf(f), docVerOf(cur)) > 0) versionChamp.set(k, f);
  }
  const pickedFiles = candidates.filter((f) => {
    const cls = classifyDoc(f);
    if (cls === "other") return true; // 资料/接线图：多份全部保留
    return versionChamp.get(versionBaseKey(f, cls)) === f;
  });
  // files/links/pairs 严格对齐：只保留本地确实存在、且同类最高版本的 PDF；同版签章去重（中文已签章优先）
  const pdfFiles = [];
  const localLinks = [];
  const pairs = [];
  const seen = new Set();
  for (const fname of pickedFiles) {
    const localPath = path.join(OFFICIAL_FILES_DIR, fname);
    if (!fs.existsSync(localPath)) continue;
    const dedup = classifyDoc(fname) + "|" + versionBaseKey(fname, classifyDoc(fname));
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    pdfFiles.push(fname);
    const relUrl = "/official-files/" + encodeURIComponent(fname);
    const fileUrl = SPEC_PUBLIC_BASE ? SPEC_PUBLIC_BASE + relUrl : relUrl;
    localLinks.push(fileUrl);
    pairs.push({ name: fname, url: fileUrl }); // 文件名↔链接一一配对；走OSS时为绝对地址，企微可直接点、不占花生壳带宽
  }
  // 分组视图（规格书→使用说明书→资料），供快查站产品卡分类、整齐展示
  const buckets = new Map(DOC_GROUP_ORDER.map((g) => [g.key, []]));
  pdfFiles.forEach((fname, i) => {
    const gk = classifyDoc(fname);
    const clean = cleanDocName(fname);
    buckets.get(gk).push({ name: fname, url: localLinks[i], clean, btn: docBtnLabel(clean, gk) });
  });
  const groups = DOC_GROUP_ORDER.map((g) => ({ key: g.key, label: g.label, items: buckets.get(g.key) }))
    .filter((g) => g.items.length);
  return { files: pdfFiles, links: localLinks, pairs, groups };
}


return {extractSpecParams,extractSpecFiles};
}
module.exports={createSpecCatalog};
