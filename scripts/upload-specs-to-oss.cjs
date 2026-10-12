/*
 * 把 data/oss-docs-to-upload.json 列出的中文文档（205个）上传到阿里云 OSS 私有桶。
 * 零第三方依赖，仅用 Node 内置模块；OSS V1 (Header) 签名。
 * 私有桶 + 后端限时签名URL（见 backend/oss-sign.cjs），不做公共读，防外链盗读。
 *
 * 凭证：scripts/.oss-config.json（已在 .gitignore，勿提交）
 *   { AccessKeyId, AccessKeySecret, Region:"oss-cn-shenzhen", Bucket:"he-mo", Prefix:"official-files" }
 *
 * 用法：
 *   node scripts/upload-specs-to-oss.cjs --dry-run   只遍历统计，不上传
 *   node scripts/upload-specs-to-oss.cjs            上传；云端已存在且等长自动跳过（可反复跑续传）
 *   node scripts/upload-specs-to-oss.cjs --force     强制覆盖重传
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const LIST_FILE = path.join(ROOT, "data", "oss-docs-to-upload.json");
const CONCURRENCY = 4; // 1M 上行，并发不宜高

function loadConfig() {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, ".oss-config.json"), "utf8").replace(/^﻿/, ""));
  return {
    AccessKeyId: process.env.OSS_AK || f.AccessKeyId,
    AccessKeySecret: process.env.OSS_SK || f.AccessKeySecret,
    Region: process.env.OSS_REGION || f.Region,
    Bucket: process.env.OSS_BUCKET || f.Bucket,
  };
}

// OSS V1 签名：VERB\nMD5\nTYPE\nDATE\n(CanonicalizedOSSHeaders)CanonicalizedResource（共5段，无自定义header时第5段直接是resource）
function ossAuthorization(cfg, method, ossKey, date, canonHeaders = "", contentType = "") {
  const resource = "/" + cfg.Bucket + "/" + ossKey; // 用原始（中文 UTF-8）对象键参与签名
  const stringToSign = [method.toUpperCase(), "", contentType, date, canonHeaders + resource].join("\n");
  const sig = crypto.createHmac("sha1", cfg.AccessKeySecret).update(Buffer.from(stringToSign, "utf8")).digest("base64");
  return "OSS " + cfg.AccessKeyId + ":" + sig;
}
function encodedPath(ossKey) {
  return "/" + ossKey.split("/").map((s) => encodeURIComponent(s)).join("/");
}

function ossRequest(cfg, method, ossKey, body, contentType = "") {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const headers = { Host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`, Date: date, Authorization: ossAuthorization(cfg, method, ossKey, date, "", contentType) };
    if (contentType) headers["Content-Type"] = contentType; // PDF标application/pdf，浏览器可直接在线预览
    if (body) headers["Content-Length"] = body.length;
    const req = https.request(
      { host: headers.Host, path: encodedPath(ossKey), method, headers },
      (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); }
    );
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy(new Error("请求超时")));
    if (body) req.end(body); else req.end();
  });
}
async function withRetry(fn, times = 3) {
  let last;
  for (let i = 1; i <= times; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1000 * i)); } }
  throw last;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const cfg = loadConfig();
  const files = JSON.parse(fs.readFileSync(LIST_FILE, "utf8"));
  const totalMB = files.reduce((s, f) => s + f.sizeBytes, 0) / 1048576;
  console.log(`待上传文档：${files.length} 个，共 ${totalMB.toFixed(1)} MB；桶：${cfg.Bucket}（${cfg.Region}）`);
  if (dryRun) { files.slice(0, 5).forEach((f) => console.log("  例：", f.ossKey)); console.log("[dry-run] 不上传。"); return; }
  for (const k of ["AccessKeyId", "AccessKeySecret", "Region", "Bucket"]) if (!cfg[k]) throw new Error("缺少 OSS 配置 " + k);

  let uploaded = 0, skipped = 0, failed = 0, bytesUp = 0;
  const failures = [];
  let cursor = 0, t0 = Date.now();
  async function worker() {
    while (cursor < files.length) {
      const f = files[cursor++];
      try {
        if (!force) {
          const head = await withRetry(() => ossRequest(cfg, "HEAD", f.ossKey));
          if (head.status === 200 && Number(head.headers["content-length"]) === f.sizeBytes) { skipped++; continue; }
        }
        const buf = fs.readFileSync(f.localPath);
        const mime = /\.pdf$/i.test(f.ossKey) ? "application/pdf" : "application/octet-stream";
        const put = await withRetry(() => ossRequest(cfg, "PUT", f.ossKey, buf, mime));
        if (put.status === 200) { uploaded++; bytesUp += f.sizeBytes; if (uploaded % 10 === 0) console.log(`已上传 ${uploaded}/${files.length}…`); }
        else { failed++; failures.push({ f: f.ossKey, status: put.status, msg: put.body.toString("utf8").slice(0, 200) }); }
      } catch (e) { failed++; failures.push({ f: f.ossKey, status: "ERR", msg: e.message }); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n完成：上传 ${uploaded}，跳过 ${skipped}，失败 ${failed}，耗时 ${sec}s，上传流量 ${(bytesUp / 1048576).toFixed(1)}MB`);
  if (failures.length) {
    fs.writeFileSync(path.join(__dirname, "oss-upload-failures.json"), JSON.stringify(failures, null, 2), "utf8");
    console.log("失败清单写 scripts/oss-upload-failures.json，直接重跑本脚本即可续传（成功的自动跳过）。");
  } else {
    console.log("全部成功。");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
