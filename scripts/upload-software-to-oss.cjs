/*
 * 把桌面“下载器”里的 7 个 HD 自有软件下载器（在线安装引导程序，每个几十 KB）上传到阿里云 OSS。
 * 与规格书同一桶 he-mo（公共读），单独前缀 software/，客户走云带宽下载、不占本机 1M 上行。
 * 零第三方依赖，仅 Node 内置模块；OSS V1 (Header) 签名，复用 scripts/.oss-config.json 凭证。
 *
 * 设计：
 *   - 这些 .exe 是“在线下载器”，运行后再从灰度官网 CDN(cdn1.huidu.cn) 拉完整安装包，
 *     所以 OSS 只存这几十 KB 的引导器，几乎不占空间/流量；软件升级后重新生成下载器、带 --force 重传即可。
 *   - Content-Type=application/octet-stream，并设置 Content-Disposition=attachment，
 *     保证浏览器/企微点链接是“下载文件”而不是尝试打开，且中文文件名正确。
 *   - 不传：_backup_*、HD一键升级/调试助手、第三方远程工具(ToDesk/向日葵)。
 *
 * 用法：
 *   node scripts/upload-software-to-oss.cjs --dry-run   只列出将上传的对象与大小，不上传
 *   node scripts/upload-software-to-oss.cjs             上传；云端已存在且等长自动跳过（可反复跑续传）
 *   node scripts/upload-software-to-oss.cjs --force     强制覆盖重传
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const DOWNLOADER_DIR = "C:\\Users\\HD\\Desktop\\下载器";
const OSS_PREFIX = "software"; // 对象前缀（规格书用 official-files，软件下载器单独 software/）

// 7 个 HD 自有软件下载器：本地文件名 -> OSS对象名（保留中文原名，与规格书中文key风格一致）
const SOURCES = [
  { file: "下载HDSet.exe",       ascii: "HDSet-Setup-Downloader.exe",       version: "V4.0.38.11" },
  { file: "下载HDPlayer.exe",    ascii: "HDPlayer-Setup-Downloader.exe",    version: "7.11.18.0" },
  { file: "下载HD2018.exe",      ascii: "HD2018-Setup-Downloader.exe",      version: "v1.0.35" },
  { file: "下载HD2020.exe",      ascii: "HD2020-Setup-Downloader.exe",      version: "V1.3.2.1" },
  { file: "下载HD Show.exe",     ascii: "HDShow-Setup-Downloader.exe",      version: "2.1.1.0" },
  { file: "下载HDSign.exe",      ascii: "HDSign-Setup-Downloader.exe",      version: "V2.0.2" },
  { file: "下载LCD Player.exe",  ascii: "LCDPlayer-Setup-Downloader.exe",   version: "V1.1.26.0" }
].map((s) => ({
  ...s,
  localPath: path.join(DOWNLOADER_DIR, s.file),
  ossKey: `${OSS_PREFIX}/${s.file}`
}));

function loadConfig() {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, ".oss-config.json"), "utf8").replace(/^﻿/, ""));
  return {
    AccessKeyId: process.env.OSS_AK || f.AccessKeyId,
    AccessKeySecret: process.env.OSS_SK || f.AccessKeySecret,
    Region: process.env.OSS_REGION || f.Region,
    Bucket: process.env.OSS_BUCKET || f.Bucket
  };
}

// OSS V1 签名：VERB\nMD5\nContent-Type\nDate\nCanonicalizedOSSHeaders+Resource
function ossAuthorization(cfg, method, ossKey, date, contentType = "", canonHeaders = "") {
  const resource = "/" + cfg.Bucket + "/" + ossKey; // 用原始（中文 UTF-8）对象键参与签名
  const stringToSign = [method.toUpperCase(), "", contentType, date, canonHeaders + resource].join("\n");
  const sig = crypto.createHmac("sha1", cfg.AccessKeySecret).update(Buffer.from(stringToSign, "utf8")).digest("base64");
  return "OSS " + cfg.AccessKeyId + ":" + sig;
}
function encodedPath(ossKey) {
  return "/" + ossKey.split("/").map((s) => encodeURIComponent(s)).join("/");
}

function ossRequest(cfg, method, ossKey, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const contentType = headers["Content-Type"] || "";
    const head = {
      Host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`,
      Date: date,
      Authorization: ossAuthorization(cfg, method, ossKey, date, contentType, headers["x-oss-canon"] || ""),
      ...headers
    };
    delete head["x-oss-canon"];
    if (body) head["Content-Length"] = body.length;
    const req = https.request(
      { host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`, path: encodedPath(ossKey), method, headers: head },
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
  for (const k of ["AccessKeyId", "AccessKeySecret", "Region", "Bucket"]) if (!cfg[k]) throw new Error("缺少 OSS 配置 " + k);

  // 本地文件体检：缺一个就整体不上传，避免传一半
  for (const s of SOURCES) {
    if (!fs.existsSync(s.localPath)) throw new Error("本地缺少下载器：" + s.localPath);
    s.sizeBytes = fs.statSync(s.localPath).size;
  }
  const totalKB = SOURCES.reduce((a, s) => a + s.sizeBytes, 0) / 1024;
  console.log(`待上传 HD 软件下载器：${SOURCES.length} 个，共 ${totalKB.toFixed(1)} KB；桶 ${cfg.Bucket}（${cfg.Region}），前缀 ${OSS_PREFIX}/`);
  SOURCES.forEach((s) => console.log(`  ${s.ossKey}  (${(s.sizeBytes / 1024).toFixed(1)} KB, 内嵌版本 ${s.version})`));
  if (dryRun) { console.log("[dry-run] 不上传。"); return; }

  let uploaded = 0, skipped = 0, failed = 0;
  const failures = [];
  const manifest = [];
  for (const s of SOURCES) {
    try {
      if (!force) {
        const head = await withRetry(() => ossRequest(cfg, "HEAD", s.ossKey));
        if (head.status === 200 && Number(head.headers["content-length"]) === s.sizeBytes) {
          skipped++; console.log("跳过(已存在等长)：", s.ossKey);
          manifest.push({ ...s, status: "skipped", publicUrl: `https://${cfg.Bucket}.${cfg.Region}.aliyuncs.com/${encodedPath(s.ossKey).slice(1)}` });
          continue;
        }
      }
      const buf = fs.readFileSync(s.localPath);
      const disposition = `attachment; filename="${s.ascii}"; filename*=UTF-8''${encodeURIComponent(s.file)}`;
      const put = await withRetry(() => ossRequest(cfg, "PUT", s.ossKey, buf, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": disposition
      }));
      if (put.status === 200) {
        uploaded++;
        const publicUrl = `https://${cfg.Bucket}.${cfg.Region}.aliyuncs.com/${s.ossKey.split("/").map(encodeURIComponent).join("/")}`;
        console.log("已上传：", publicUrl);
        manifest.push({ file: s.file, ossKey: s.ossKey, version: s.version, sizeBytes: s.sizeBytes, publicUrl, status: "uploaded" });
      } else {
        failed++;
        failures.push({ f: s.ossKey, status: put.status, msg: put.body.toString("utf8").slice(0, 200) });
      }
    } catch (e) {
      failed++;
      failures.push({ f: s.ossKey, status: "ERR", msg: e.message });
    }
  }
  fs.writeFileSync(path.join(ROOT, "data", "software-downloaders-manifest.json"),
    JSON.stringify({ bucket: cfg.Bucket, region: cfg.Region, prefix: OSS_PREFIX, updatedAt: new Date().toISOString(), items: manifest }, null, 2), "utf8");
  console.log(`\n完成：上传 ${uploaded}，跳过 ${skipped}，失败 ${failed}。清单写 data/software-downloaders-manifest.json`);
  if (failures.length) { console.error("失败明细：", JSON.stringify(failures, null, 2)); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
