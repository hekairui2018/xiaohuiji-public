/*
 * 中文软件说明书上传 OSS（串行、已验证请求范式，复制 upload-videos / diag 成功写法）
 * 读 tmp/manuals-rows.json，对象前缀 manuals/software/，Content-Type=application/pdf。
 * HEAD 等长跳过；跑完终验并写 data/software-manuals-manifest.json。
 * 用法：node scripts/upload-manuals2.cjs [--force] [--dry-run]
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const PREFIX = "manuals/software/";

function loadConfig() {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, ".oss-config.json"), "utf8").replace(/^﻿/, ""));
  return {
    AccessKeyId: process.env.OSS_AK || f.AccessKeyId,
    AccessKeySecret: process.env.OSS_SK || f.AccessKeySecret,
    Region: process.env.OSS_REGION || f.Region,
    Bucket: process.env.OSS_BUCKET || f.Bucket
  };
}
function ossAuthorization(cfg, method, ossKey, date, contentType = "") {
  const resource = "/" + cfg.Bucket + "/" + ossKey;
  const sts = [method.toUpperCase(), "", contentType, date, resource].join("\n");
  const sig = crypto.createHmac("sha1", cfg.AccessKeySecret).update(Buffer.from(sts, "utf8")).digest("base64");
  return "OSS " + cfg.AccessKeyId + ":" + sig;
}
const encodedPath = (k) => "/" + k.split("/").map(encodeURIComponent).join("/");
function ossRequest(cfg, method, ossKey, body, headers = {}, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const contentType = headers["Content-Type"] || "";
    const head = {
      Host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`,
      Date: date,
      Authorization: ossAuthorization(cfg, method, ossKey, date, contentType),
      Connection: "close",
      ...headers
    };
    if (body) head["Content-Length"] = body.length;
    const req = https.request(
      { host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`, path: encodedPath(ossKey), method, headers: head },
      (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("请求超时")));
    if (body) req.end(body); else req.end();
  });
}
async function withRetry(fn, times = 3) {
  let last;
  for (let i = 1; i <= times; i++) {
    try { return await fn(); }
    catch (e) { last = e; console.log("  重试", i, e.message); await new Promise((r) => setTimeout(r, 1500 * i)); }
  }
  throw last;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const cfg = loadConfig();
  for (const k of ["AccessKeyId", "AccessKeySecret", "Region", "Bucket"]) if (!cfg[k]) throw new Error("缺少 OSS 配置 " + k);

  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "manuals-rows.json"), "utf8"));
  const files = rows.map((r) => ({ ...r, ossKey: PREFIX + r.file, local: path.join(ROOT, "tmp", "manuals-pdf", r.file) }))
    .filter((f) => fs.existsSync(f.local));
  for (const f of files) f.size = fs.statSync(f.local).size;
  const totalMB = (files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1);
  console.log(`待处理 ${files.length} 个 / ${totalMB}MB${dryRun ? "（dry-run）" : ""}`);
  if (dryRun) { files.forEach((f) => console.log("  " + f.file)); return; }

  let uploaded = 0, skipped = 0, failed = 0;
  const failures = [], items = [];
  for (const f of files) {
    const publicUrl = `https://${cfg.Bucket}.${cfg.Region}.aliyuncs.com${encodedPath(f.ossKey)}`;
    try {
      if (!force) {
        const head = await withRetry(() => ossRequest(cfg, "HEAD", f.ossKey, null, {}, 30000), 2);
        if (head.status === 200 && Number(head.headers["content-length"]) === f.size) {
          skipped++; console.log("跳过(已存在) " + f.file);
          items.push({ softwareId: f.softwareId, label: f.label, file: f.file, ossKey: f.ossKey, sizeBytes: f.size, contentType: "application/pdf", publicUrl, status: "uploaded" });
          continue;
        }
      }
      const body = fs.readFileSync(f.local);
      const t0 = Date.now();
      const put = await withRetry(() => ossRequest(cfg, "PUT", f.ossKey, body, { "Content-Type": "application/pdf" }), 3);
      if (put.status === 200) {
        uploaded++; console.log(`已上传 ${(f.size / 1048576).toFixed(2)}MB ${((Date.now() - t0) / 1000).toFixed(1)}s  ${f.file}`);
        items.push({ softwareId: f.softwareId, label: f.label, file: f.file, ossKey: f.ossKey, sizeBytes: f.size, contentType: "application/pdf", publicUrl, status: "uploaded" });
      } else {
        failed++; failures.push({ f: f.file, status: put.status, msg: put.body.toString("utf8").slice(0, 200) });
        items.push({ softwareId: f.softwareId, label: f.label, file: f.file, ossKey: f.ossKey, sizeBytes: f.size, contentType: "application/pdf", publicUrl, status: "missing" });
      }
    } catch (e) {
      failed++; failures.push({ f: f.file, status: "ERR", msg: e.message });
    }
  }

  // 终验：逐个 HEAD 等长
  let verified = 0;
  for (const it of items) {
    if (it.status !== "uploaded") continue;
    try {
      const h = await ossRequest(cfg, "HEAD", it.ossKey, null, {}, 30000);
      if (h.status === 200 && Number(h.headers["content-length"]) === it.sizeBytes) verified++;
      else { it.status = "missing"; failed++; console.log("终验不符 " + it.file); }
    } catch { it.status = "missing"; }
  }
  const manifest = {
    bucket: cfg.Bucket, region: cfg.Region, prefix: PREFIX,
    updatedAt: new Date().toISOString(),
    count: items.filter((x) => x.status === "uploaded").length,
    items: items.sort((a, b) => a.ossKey.localeCompare(b.ossKey, "zh"))
  };
  fs.writeFileSync(path.join(ROOT, "data", "software-manuals-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\n完成：上传 ${uploaded}，跳过 ${skipped}，失败 ${failed}，终验通过 ${verified}/${files.length}`);
  console.log("manifest -> data/software-manuals-manifest.json");
  if (failures.length) { console.error("失败明细：\n" + failures.map((x) => x.f + " " + x.status + " " + x.msg).join("\n")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
