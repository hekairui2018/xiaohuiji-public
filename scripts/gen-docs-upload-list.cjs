/*
 * 生成“本次要上传 OSS 的中文文档”清单：只含已挂载到产品的 205 个
 * （=128 原本已登记 + 77 本次补登）；英文、59 个无产品页文档一律不传。
 * 输出 data/oss-docs-to-upload.json：[{name, ossKey, localPath, sizeBytes, sizeMB}]
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const D = path.join(ROOT, "data");
const LOCAL_DIR = path.join(ROOT, "frontend", "official-files");
const PREFIX = "official-files";

const specs = JSON.parse(fs.readFileSync(path.join(D, "product-specs-index.json"), "utf8")).products;
const mani = JSON.parse(fs.readFileSync(path.join(D, "oss-upload-manifest.json"), "utf8"));
const linked = new Set();
specs.forEach((p) => (p.specificationFiles || []).forEach((f) => linked.add(f)));

const out = [];
const missing = [];
for (const doc of mani.products) {
  if (!linked.has(doc.Name)) continue; // 只传已挂载的 205
  const localPath = path.join(LOCAL_DIR, doc.Name);
  if (!fs.existsSync(localPath)) { missing.push(doc.Name); continue; }
  const st = fs.statSync(localPath);
  out.push({
    name: doc.Name,
    cat: doc.Cat,
    ossKey: `${PREFIX}/${doc.Name}`, // OSS 对象键保留原始中文文件名
    localPath,
    sizeBytes: st.size,
    sizeMB: +(st.size / 1048576).toFixed(2),
  });
}
out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
const totalMB = out.reduce((s, x) => s + x.sizeBytes, 0) / 1048576;
fs.writeFileSync(path.join(D, "oss-docs-to-upload.json"), JSON.stringify(out, null, 2), "utf8");
console.log("待上传:", out.length, "个 /", totalMB.toFixed(1), "MB");
const byCat = {}; out.forEach((x) => (byCat[x.cat] = (byCat[x.cat] || 0) + 1));
console.log("分类:", JSON.stringify(byCat));
console.log("本地缺失:", missing.length, missing.slice(0, 5));
