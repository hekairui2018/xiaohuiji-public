// 产品目录清洗（业务逻辑层）
// 识别“聚合幽灵/误切型号”：没有任何以自身精确命名的规格书、只是更长型号前缀的条目
// （如 W6 名下全是 W60/W62 的资料；D30AND/T08FRONT 是把英文单词误当型号）。
// 只在搜索/展示层过滤，不删源数据，可随时回退。
const fs = require("fs");
const path = require("path");
const DATA_DIR = path.join(__dirname, "..", "data");
function loadJson(f) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8").replace(/^﻿/, "")); }

let _ghost = null;
let _hard = null;
// 英文单词被误切成型号后缀
const JUNK_TAIL = /(AND|SERIES|SENDING|CONNECTION|FRONT|RECEIVING|BACK|FRONTPANEL)$/i;

// 已下市老款（去 HD- 前缀，大写）：现规格书库与历史归档均无带载等核心参数，
// 客户快查层折叠，不删源数据；哪个仍在售要恢复，从这里移除即可。
const DISCONTINUED_BARE = new Set([
  // 老单双色控制卡
  "B38","B40","B41","B5","B34","B39","B26","B28A","B7","E2","E7","E66","E62P",
  "U63","U64","U6B","U60PLUS","U62PLUS","H5",
  // 老异步/播放盒
  "A1310","A30","A60X","A6LS","D0","D15","D35","D10","D20",
  "C36C","C15C","C35C","C46","C10","C30","K6",
  // 老发送卡
  "T568B","T600A",
  // 老接收卡
  "R1A","R1B","R2A","R2B","R3A","R3B","R4A","R4B","R320T"
]);

// 在售“裸基础款”豁免：虽存在更长衍生型号（如 R512 有 R512T/S），但自身也独立在售、
// 且有完整参数，不按“聚合幽灵”折叠。仅豁免动态规则，英文误切(JUNK_TAIL)不豁免。
const ACTIVE_BASE_BARE = new Set(["R500","R512","R516","C16","C08","A6"]);

function ownDocCount(psItem, bare) {
  if (!psItem) return 0;
  const all = [...(psItem.specificationFiles || []), ...(psItem.officialPdfLinks || [])];
  // 文件名中精确出现该型号（其后不紧跟字母数字）；“XX系列”合集不算该型号自身文档
  return all.filter((f) => new RegExp(bare + "(?![0-9A-Za-z])").test(String(f)) && !/系列/.test(String(f))).length;
}

// 计算折叠集合，区分两类原因：
//  - _hard 硬隐藏：人工确认下市（DISCONTINUED_BARE）或英文误切（JUNK_TAIL），任何场景（含客户精确点名）都不展示；
//  - _ghost 仅聚合幽灵：自身无规格书、却是更长衍生型号前缀的“真实裸款”（如 A3 之于 A3L/A30）。
//    分类浏览/模糊搜索时折叠，但客户精确点名该型号时必须放行给自身，不得被尾缀衍生款顶替（A3≠A3L）。
function ensureSets() {
  if (_ghost) return;
  const pi = loadJson("product-index.json").products || [];
  const ps = loadJson("product-specs-index.json").products || [];
  const allNames = pi.map((p) => p.product || p.displayName);
  const psMap = {};
  ps.forEach((p) => { psMap[p.product || p.displayName] = p; });
  _ghost = new Set();
  _hard = new Set();
  pi.forEach((p) => {
    const n = p.product || p.displayName;
    const bare = n.replace(/^HD-/, "").toUpperCase();
    const hasChild = allNames.some((o) => o !== n && o.startsWith(n) && o.length > n.length);
    const own = ownDocCount(psMap[n], bare);
    const aggregateGhost = hasChild && own === 0 && !ACTIVE_BASE_BARE.has(bare);
    if (JUNK_TAIL.test(n) || DISCONTINUED_BARE.has(bare)) { _hard.add(n); _ghost.add(n); }
    else if (aggregateGhost) { _ghost.add(n); }
  });
}
function ghostSet() { ensureSets(); return _ghost; }
function hardHiddenSet() { ensureSets(); return _hard; }
function isGhostProduct(name) { return ghostSet().has(name); }
function isHardHidden(name) { return hardHiddenSet().has(name); }
// 仅“聚合幽灵”而非人工下市/误切：精确点名时可放行
function isAggregateOnly(name) { return isGhostProduct(name) && !isHardHidden(name); }

// 官网配单工具“真实可选型型号”权威清单：用来区分“真实但暂无规格书的裸款”（如 A3）与
// “仅前缀巧合的假型号”（如 W6 之于 W60/W62，官网根本没有 W6）。懒加载，文件缺失则空集合（安全回退为不放行）。
let _officialBare = null;
function officialBareSet() {
  if (_officialBare) return _officialBare;
  _officialBare = new Set();
  try {
    const p = path.join(__dirname, "..", "reference", "official-selection-tool", "official-device-full.json");
    const arr = JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
    (Array.isArray(arr) ? arr : []).forEach((d) => {
      const b = String((d && d.model) || "").toUpperCase().replace(/^HD[-_]?/, "").trim();
      if (b) _officialBare.add(b);
    });
  } catch { /* 无官网库时不做精确放行，安全回退为折叠 */ }
  return _officialBare;
}
function isOfficialSelectable(name) {
  return officialBareSet().has(String(name || "").replace(/^HD-/, "").toUpperCase());
}

module.exports = {
  isGhostProduct,
  isHardHidden,
  isAggregateOnly,
  isOfficialSelectable,
  ghostSet,
  hardHiddenSet
};
