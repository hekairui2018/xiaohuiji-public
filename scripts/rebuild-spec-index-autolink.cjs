/*
 * 把 docs-autolink.json 中“产品在库、只是旧索引未登记”的中文文档，
 * 补登到 product-specs-index.json 对应产品的 specificationFiles（去重、中文在前）。
 * 预演：node scripts/rebuild-spec-index-autolink.cjs
 * 落盘：node scripts/rebuild-spec-index-autolink.cjs --write （自动先备份）
 */
const fs = require("fs");
const path = require("path");
const D = path.join(__dirname, "..", "data");
const SPEC = path.join(D, "product-specs-index.json");
const AUTO = path.join(D, "docs-autolink.json");

const rawOriginal = fs.readFileSync(SPEC); // 原始字节，落盘前用于备份
const spec = JSON.parse(rawOriginal.toString("utf8"));
const auto = JSON.parse(fs.readFileSync(AUTO, "utf8"));
const write = process.argv.includes("--write");

// 产品名 -> 产品对象
const byName = new Map();
for (const p of spec.products) byName.set(p.displayName || p.product, p);

const hasChinese = (s) => /[一-龥]/.test(s);
const sortFiles = (a, b) => {
  const ca = hasChinese(a) ? 0 : 1, cb = hasChinese(b) ? 0 : 1;
  if (ca !== cb) return ca - cb;
  return a.localeCompare(b, "zh");
};

let added = 0, touchedProducts = new Set(), missing = [];
for (const { f, model } of auto) {
  const p = byName.get(model);
  if (!p) { missing.push({ f, model }); continue; }
  const arr = Array.isArray(p.specificationFiles) ? p.specificationFiles : (p.specificationFiles = []);
  if (!arr.includes(f)) { arr.push(f); added++; touchedProducts.add(model); }
  arr.sort(sortFiles);
}

console.log("待补登文档:", auto.length, " 成功:", added, " 涉及产品:", touchedProducts.size, " 找不到产品:", missing.length);
if (missing.length) { console.log("找不到产品的条目:"); missing.forEach(x => console.log("  ", x.model, "<-", x.f)); }

if (write) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const bak = path.join(D, `product-specs-index.bak-autolink-${stamp}.json`);
  fs.writeFileSync(bak, rawOriginal); // 备份的是改动前的原始内容
  spec.specificationFileCount = spec.products.reduce((s, p) => s + (p.specificationFiles || []).length, 0);
  fs.writeFileSync(SPEC, JSON.stringify(spec, null, 2), "utf8");
  console.log("已写回", SPEC, "\n备份:", bak, "\n登记文件总数:", spec.specificationFileCount);
} else {
  console.log("(预演，未写盘；加 --write 落盘)");
}
