/*
 * 把 HDSet 内置【接收卡】固件上传到阿里云 OSS（只传接收卡，发送卡/处理器 local/sendcard 不传）。
 * 源：C:\Program Files (x86)\HDSet\local\recvcard\<卡型>\*.bin
 * 目标：oss://he-mo/firmware/recvcard/<卡型>/<原文件名>.bin（公共读，保留中文/空格/原名，HDSet 可识别）
 * 零第三方依赖，仅 Node 内置模块；OSS V1 (Header) 签名，复用 scripts/.oss-config.json 凭证。
 *
 * 设计：
 *   - 固件全部上云（含旧版/专用变体，存储便宜、不丢固件）；“每卡型×系列只展示最新正式版、专用折叠”
 *     由展示层依据本脚本生成的 data/firmware-manifest.json 控制，不在上传时删文件。
 *   - Content-Type=application/octet-stream + Content-Disposition=attachment，点链接即下载、文件名正确。
 *   - 文件名解析（系列码/硬件尾位/变体）只做如实记录，解析不出留空、绝不猜测；硬件尾位另与
 *     data/receiver-card-firmware-suffixes.json 交叉校验，不符打 tableMatched=false，不阻断上传。
 *
 * 用法：
 *   node scripts/upload-firmware-to-oss.cjs --dry-run   只列对象与解析结果，不上传
 *   node scripts/upload-firmware-to-oss.cjs             上传；云端已存在且等长自动跳过（可反复跑续传）
 *   node scripts/upload-firmware-to-oss.cjs --force     强制覆盖重传
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = "C:\\Program Files (x86)\\HDSet\\local\\recvcard";
const OSS_PREFIX = "firmware/recvcard";

function loadConfig() {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, ".oss-config.json"), "utf8").replace(/^﻿/, ""));
  return {
    AccessKeyId: process.env.OSS_AK || f.AccessKeyId,
    AccessKeySecret: process.env.OSS_SK || f.AccessKeySecret,
    Region: process.env.OSS_REGION || f.Region,
    Bucket: process.env.OSS_BUCKET || f.Bucket
  };
}

// ---------- 接收卡硬件尾位对照表（交叉校验用，权威表来自 data/）----------
function loadSuffixTable() {
  const p = path.join(ROOT, "data", "receiver-card-firmware-suffixes.json");
  const json = JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
  const map = new Map();
  const norm = (s) => String(s).toUpperCase().replace(/\s+/g, "");
  for (const r of json.rows || []) {
    const names = [...(r.models || []), ...(r.aliases || [])];
    for (const n of names) {
      const key = norm(n);
      const ex = map.get(key);
      // 同型号可能有 standard/custom 两行（如 R5S=82/89、R712=30/39）：standard 优先，不被 custom 覆盖
      if (!ex || r.variant === "standard") map.set(key, r);
    }
  }
  return { map, norm };
}

// ---------- 固件文件名解析（如实记录，不猜）----------
function parseFirmware(card, file, table) {
  const base = file.replace(/\.bin$/i, "");
  // 变体：_E0/_E1/.../_D8，以及中文专用屏（贴膜屏/透明屏）
  const variantParts = [];
  const em = base.match(/_(E\d+|D\d+)(?=_|\.|$)/);
  if (em) variantParts.push(em[1]);
  if (/贴膜屏/.test(base)) variantParts.push("贴膜屏");
  if (/透明屏/.test(base)) variantParts.push("透明屏");
  const variant = variantParts.length ? variantParts.join("+") : null;
  // 文件名显式写出的芯片系列（佐证用）
  const chipHint = /ICN2065/i.test(base) ? "ICN2065"
    : /LS99/i.test(base) ? "LS99xx"
    : /ICN1063/i.test(base) ? "ICN1063" : null;
  // 只取 FPGA 主段（_MCU 之前），避免 MCU 版本段污染系列码/尾位
  const mainPart = base.split(/_MCU/i)[0];
  // 恰好两位、且以 . 或 _ 为边界的数字段 = 版本/系列/尾位；最后一个=硬件尾位，倒数第二=系列码
  const two = [...mainPart.matchAll(/(?:^|[._])(\d{2})(?=[._]|$)/g)].map((m) => m[1]);
  const hwFromFile = two.length ? two[two.length - 1] : null;
  const series = two.length >= 2 ? two[two.length - 2] : null;
  // 版本排序键：主段内所有数字按出现顺序转数值（越大越新）
  const sortNums = [...mainPart.matchAll(/\d+/g)].map((m) => parseInt(m[1], 10));
  // 与对照表交叉校验
  const row = table.map.get(table.norm(card));
  const hwFromTable = row ? String(row.suffix) : null;
  const tableMatched = row ? hwFromFile === hwFromTable : null; // null=对照表无此卡型
  return {
    card, file, variant, chipHint, series, hwFromFile, hwFromTable, tableMatched,
    commonCode: row && series && (row.commonCodes || []).includes(series),
    specialCode: row && series && (row.specialCodes || []).includes(series),
    sortNums
  };
}

// 收集所有接收卡固件（按卡型目录）
function collect() {
  const table = loadSuffixTable();
  const cards = fs.readdirSync(SRC_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  const items = [];
  for (const c of cards) {
    const cardDir = path.join(SRC_DIR, c.name);
    const bins = fs.readdirSync(cardDir).filter((f) => /\.bin$/i.test(f));
    for (const f of bins) {
      const localPath = path.join(cardDir, f);
      const sizeBytes = fs.statSync(localPath).size;
      const meta = parseFirmware(c.name, f, table);
      items.push({ ...meta, localPath, sizeBytes, ossKey: `${OSS_PREFIX}/${c.name}/${f}` });
    }
  }
  return items;
}

// ---------- OSS V1 签名/请求（与 upload-software-to-oss.cjs 同范式）----------
function ossAuthorization(cfg, method, ossKey, date, contentType = "", canonHeaders = "") {
  const resource = "/" + cfg.Bucket + "/" + ossKey; // 原始（中文 UTF-8）对象键参与签名
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
    req.setTimeout(180000, () => req.destroy(new Error("请求超时")));
    if (body) req.end(body); else req.end();
  });
}
async function withRetry(fn, times = 3) {
  let last;
  for (let i = 1; i <= times; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1000 * i)); } }
  throw last;
}
function publicUrlOf(cfg, ossKey) {
  return `https://${cfg.Bucket}.${cfg.Region}.aliyuncs.com/` + ossKey.split("/").map(encodeURIComponent).join("/");
}
// ASCII 回退文件名（Content-Disposition filename），中文/空格转安全字符
function asciiName(card, file) {
  const a = `${card}_${file}`.replace(/\.bin$/i, "").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return `${a}.bin`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  const cfg = loadConfig();
  for (const k of ["AccessKeyId", "AccessKeySecret", "Region", "Bucket"]) if (!cfg[k]) throw new Error("缺少 OSS 配置 " + k);

  const items = collect();
  const totalMB = items.reduce((a, x) => a + x.sizeBytes, 0) / 1048576;
  const byCard = {};
  for (const it of items) (byCard[it.card] = byCard[it.card] || []).push(it);
  console.log(`接收卡固件：${items.length} 个，共 ${totalMB.toFixed(1)} MB，${Object.keys(byCard).length} 个卡型；桶 ${cfg.Bucket}（${cfg.Region}），前缀 ${OSS_PREFIX}/`);
  for (const card of Object.keys(byCard).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))) {
    console.log(`\n[${card}] ${byCard[card].length} 个`);
    for (const it of byCard[card].sort((a, b) => a.file.localeCompare(b.file))) {
      const flag = it.tableMatched === false ? "  ⚠尾位表不符" : (it.tableMatched === null ? "  (表无此卡)" : "");
      const tags = [it.series != null ? `系列${it.series}` : "系列?", it.hwFromFile != null ? `尾位${it.hwFromFile}` : "尾位?", it.variant, it.chipHint].filter(Boolean).join(" ");
      console.log(`   ${(it.sizeBytes / 1048576).toFixed(2)}MB  ${tags}${flag}  ${it.file}`);
    }
  }
  if (dryRun) { console.log("\n[dry-run] 不上传。"); return; }

  let uploaded = 0, skipped = 0, failed = 0;
  const failures = [];
  const manifest = [];
  for (const it of items) {
    try {
      if (!force) {
        const head = await withRetry(() => ossRequest(cfg, "HEAD", it.ossKey));
        if (head.status === 200 && Number(head.headers["content-length"]) === it.sizeBytes) {
          skipped++;
          manifest.push({ ...it, localPath: undefined, status: "skipped", publicUrl: publicUrlOf(cfg, it.ossKey) });
          continue;
        }
      }
      const buf = fs.readFileSync(it.localPath);
      const disposition = `attachment; filename="${asciiName(it.card, it.file)}"; filename*=UTF-8''${encodeURIComponent(it.file)}`;
      const put = await withRetry(() => ossRequest(cfg, "PUT", it.ossKey, buf, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": disposition
      }));
      if (put.status === 200) {
        uploaded++;
        console.log("已上传：", it.ossKey);
        manifest.push({ ...it, localPath: undefined, status: "uploaded", publicUrl: publicUrlOf(cfg, it.ossKey) });
      } else {
        failed++;
        failures.push({ f: it.ossKey, status: put.status, msg: put.body.toString("utf8").slice(0, 200) });
      }
    } catch (e) {
      failed++;
      failures.push({ f: it.ossKey, status: "ERR", msg: e.message });
    }
  }
  // 清单：按卡型→系列分组，给出每组最新正式版（供展示层“每卡型×系列只给最新、专用折叠”）
  const groups = {};
  for (const m of manifest) {
    const key = `${m.card}|${m.series == null ? "?" : m.series}`;
    (groups[key] = groups[key] || []).push(m);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      const n = Math.min(a.sortNums.length, b.sortNums.length);
      for (let i = 0; i < n; i++) if (b.sortNums[i] !== a.sortNums[i]) return b.sortNums[i] - a.sortNums[i];
      return b.sortNums.length - a.sortNums.length;
    });
    groups[key].forEach((m, i) => { m.latestInSeries = i === 0 && !m.variant; m.latestAny = i === 0; });
  }
  fs.writeFileSync(path.join(ROOT, "data", "firmware-manifest.json"),
    JSON.stringify({
      bucket: cfg.Bucket, region: cfg.Region, prefix: OSS_PREFIX,
      source: SRC_DIR, updatedAt: new Date().toISOString(),
      count: manifest.length, totalMB: Number(totalMB.toFixed(2)),
      items: manifest
    }, null, 2), "utf8");
  console.log(`\n完成：上传 ${uploaded}，跳过 ${skipped}，失败 ${failed}。清单写 data/firmware-manifest.json`);
  if (failures.length) { console.error("失败明细：", JSON.stringify(failures, null, 2)); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
