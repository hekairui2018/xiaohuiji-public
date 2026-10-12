/*
 * OSS 防盗链（Referer 白名单）配置工具 —— 桶 he-mo
 *
 * 设计原则（用户拍板④）：
 *  - AllowEmptyReferer=true：手机微信/企微/直接点链接多为空 Referer，必须放行，否则客户打不开（强兜底）。
 *  - 白名单严格按 OSS schema 只写 scheme+host（官方示例不接受端口/路径，否则 PutBucketReferer
 *    返回 MalformedXML 0033-00000001）；host 前缀匹配即覆盖该域名下任意路径/查询。
 *    本机 3789 带端口无法写进白名单（schema 限制），仅影响本机开发自测、不影响外网客户，故只告警不回滚。
 *  - 未来 GitHub Pages / ICP 备案自定义域名定了以后，把域名加进 REFERERS 重跑 --apply 即可。
 *  - OSS 没有“删除防盗链”接口，清空=用空 RefererList + AllowEmptyReferer=true 覆盖（=不限制），--reset 即此。
 *  - 只挡“第三方网页直接 <img>/<video>/<a> 盗用”；空 Referer 的直接拉流/爬虫挡不住（防君子不防小人），
 *    真正省流量要靠云监控下行流量告警 + 长期 CDN/签名URL，告警需本人在控制台配通知联系人。
 *
 * 用法：
 *   node scripts/oss-set-referer.cjs              # dry-run：读当前配置 + 对现状跑回归，不写任何东西
 *   node scripts/oss-set-referer.cjs --apply       # 写入白名单，随后自动回归；硬回归失败自动 --reset 回滚
 *   node scripts/oss-set-referer.cjs --reset       # 清空防盗链（恢复为不限制、空 Referer 放行）
 *
 * 零第三方依赖，内置 https；OSS V1 签名；所有写请求带 Connection:close（复用 keep-alive 会 403）。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const ROOT = path.join(__dirname, "..");

function loadConfig() {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, ".oss-config.json"), "utf8").replace(/^﻿/, ""));
  return {
    AccessKeyId: process.env.OSS_AK || f.AccessKeyId,
    AccessKeySecret: process.env.OSS_SK || f.AccessKeySecret,
    Region: process.env.OSS_REGION || f.Region,
    Bucket: process.env.OSS_BUCKET || f.Bucket
  };
}

// 白名单：严格 scheme+host（OSS schema 不接受端口/路径；host 前缀匹配覆盖全部路径与查询）。
const REFERERS = [
  "http://9vh47rq28469.vicp.fun",
  "https://9vh47rq28469.vicp.fun",
  "http://127.0.0.1",
  "http://localhost"
  // 未来："https://<你的GitHub用户名>.github.io"、"https://资料.<你的备案域名>"
];

function buildXml(referers, allowEmpty) {
  const list = referers.map((r) => `    <Referer>${r}</Referer>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<RefererConfiguration>\n  <AllowEmptyReferer>${allowEmpty}</AllowEmptyReferer>\n  <AllowTruncateQueryString>true</AllowTruncateQueryString>\n  <RefererList>\n${list}\n  </RefererList>\n</RefererConfiguration>\n`;
}

// 桶级子资源请求（PUT/GET /?referer）。V1 签名 canonicalized resource = /Bucket/?referer
function bucketSubRequest(cfg, method, subResource, body) {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const contentType = body ? "application/xml" : "";
    const resource = "/" + cfg.Bucket + "/?" + subResource;
    const sts = [method.toUpperCase(), "", contentType, date, resource].join("\n");
    const sig = crypto.createHmac("sha1", cfg.AccessKeySecret).update(Buffer.from(sts, "utf8")).digest("base64");
    const head = {
      Host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`,
      Date: date,
      Authorization: "OSS " + cfg.AccessKeyId + ":" + sig,
      Connection: "close"
    };
    if (body) { head["Content-Type"] = contentType; head["Content-Length"] = Buffer.byteLength(body); }
    const req = https.request(
      { host: `${cfg.Bucket}.${cfg.Region}.aliyuncs.com`, path: "/?" + subResource, method, headers: head },
      (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString("utf8") })); }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("请求超时")));
    if (body) req.end(body); else req.end();
  });
}

// 匿名 GET（Range 只取 1 字节）一个公共对象，带指定 Referer（referer=null 表示不发 Referer 头）。
// 关键：OSS 防盗链只拦 GET（实际取内容、耗下行流量），不拦 HEAD（HEAD 外域也返回 200），所以回归必须用 GET。
// 放行=200/206，拦截=403；拿到状态码立即销毁连接，不下载 body。
function getProbe(url, referer) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const head = { Connection: "close", Range: "bytes=0-0" };
    if (referer !== null) head.Referer = referer;
    const req = https.request({ method: "GET", host: u.host, path: u.pathname + u.search, headers: head }, (res) => {
      resolve(res.statusCode);
      res.destroy();
    });
    req.on("error", () => resolve("ERR"));
    req.setTimeout(15000, () => { req.destroy(); resolve("TIMEOUT"); });
    req.end();
  });
}

// 从本地 manifest 找一个一定存在的公共小对象作为探针对象
function probeUrl(cfg) {
  const candidates = [
    "software-downloaders-manifest.json",
    "firmware-manifest.json",
    "software-manuals-manifest.json"
  ];
  for (const fn of candidates) {
    const p = path.join(ROOT, "data", fn);
    if (!fs.existsSync(p)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
    const items = j.items || j.files || [];
    for (const it of items) {
      if (it.publicUrl) return it.publicUrl;
      if (it.ossKey) return `https://${cfg.Bucket}.${cfg.Region}.aliyuncs.com/` + it.ossKey.split("/").map(encodeURIComponent).join("/");
    }
  }
  throw new Error("找不到可用于回归探测的公共对象，请检查 data/*-manifest.json");
}

// hard=true 的用例失败才触发回滚；hard=false 仅告警（本机带端口 schema 无法加白、只影响开发自测）
async function regression(url) {
  const cases = [
    ["无 Referer（微信/直接点链接）", null, true, true],
    ["白名单·花生壳 http", "http://9vh47rq28469.vicp.fun/huiai?q=HDPlayer", true, true],
    ["白名单·花生壳 https", "https://9vh47rq28469.vicp.fun/quick?q=R708", true, true],
    ["本机开发页 127.0.0.1:3789（schema 不支持端口，仅告警）", "http://127.0.0.1:3789/huiai", true, false],
    ["外域盗链 evil.example.com", "http://evil.example.com/hotlink.mp4", false, true],
    ["外域盗链 某第三方站", "https://www.some-other-site.cn/page", false, true]
  ];
  const results = [];
  for (const [name, ref, expectAllow, hard] of cases) {
    const code = await getProbe(url, ref);
    const allowed = code === 200 || code === 206;
    const pass = allowed === expectAllow;
    results.push({ name, ref, code, pass, hard });
    const tag = pass ? "PASS" : (hard ? "FAIL" : "WARN");
    console.log(`  ${tag}  [${code}] ${name}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const reset = args.includes("--reset");
  const cfg = loadConfig();
  for (const k of ["AccessKeyId", "AccessKeySecret", "Region", "Bucket"]) if (!cfg[k]) throw new Error("缺少 OSS 配置 " + k);
  const url = probeUrl(cfg);
  console.log("探针对象：" + url + "\n");

  const cur = await bucketSubRequest(cfg, "GET", "referer");
  console.log("当前防盗链配置（GET ?referer）HTTP " + cur.status + "：");
  console.log(cur.status === 404 ? "  （桶未配置过 Referer，404=默认不限制）" : (cur.body.trim() || "  （空）"));
  console.log("");

  if (reset) {
    const xml = buildXml([], "true"); // 空列表 + 允许空 Referer = 完全不限制
    console.log("将写入（清空=不限制）：\n" + xml);
    const r = await bucketSubRequest(cfg, "PUT", "referer", xml);
    console.log("PUT ?referer -> HTTP " + r.status + (r.status === 200 ? "（已清空防盗链）" : "  body=" + r.body.slice(0, 300)));
    if (r.status !== 200) process.exit(1);
    return;
  }

  const xml = buildXml(REFERERS, "true");
  console.log((apply ? "将写入" : "[dry-run] 计划写入") + "的白名单：\n" + xml);

  if (!apply) {
    console.log("[dry-run] 未做任何修改。确认无误后执行：node scripts/oss-set-referer.cjs --apply\n");
    console.log("对【当前线上配置】跑一遍回归（供对照，WARN 不影响）：");
    await regression(url);
    return;
  }

  const put = await bucketSubRequest(cfg, "PUT", "referer", xml);
  console.log("PUT ?referer -> HTTP " + put.status);
  if (put.status !== 200) { console.error("写入失败：" + put.body.slice(0, 500)); process.exit(1); }

  // 读己之写：确认白名单真的落桶
  await new Promise((r) => setTimeout(r, 1500));
  const back = await bucketSubRequest(cfg, "GET", "referer");
  const gotAll = REFERERS.every((r) => back.body.includes("<Referer>" + r + "</Referer>"));
  console.log("读回配置 HTTP " + back.status + "，4 条白名单" + (gotAll ? "均已落桶" : "未落全（如下）"));
  if (!gotAll) console.log(back.body);

  // GET 防盗链通常立即生效；保留 3 轮、每轮间隔 2 秒仅作容错，硬回归全过才保留，否则回滚
  let res, hardFail, warn;
  for (let round = 1; round <= 3; round++) {
    console.log(`\n写入后回归（第 ${round} 轮）：`);
    res = await regression(url);
    hardFail = res.filter((x) => !x.pass && x.hard);
    warn = res.filter((x) => !x.pass && !x.hard);
    if (!hardFail.length) break;
    if (round < 3) { console.log("  配置可能尚未生效，2 秒后重试…"); await new Promise((r) => setTimeout(r, 2000)); }
  }

  if (hardFail.length) {
    console.error("\n硬回归持续 FAIL，自动回滚（清空防盗链恢复不限制）…");
    const rb = await bucketSubRequest(cfg, "PUT", "referer", buildXml([], "true"));
    console.error("回滚 PUT -> HTTP " + rb.status);
    console.error("失败项：\n" + hardFail.map((x) => `  [${x.code}] ${x.name} ref=${x.ref}`).join("\n"));
    process.exit(2);
  }
  if (warn.length) console.log("\n提示（仅告警、不影响外网客户）：\n" + warn.map((x) => `  [${x.code}] ${x.name} —— OSS 白名单 schema 不支持带端口，本机开发自测可改用空 Referer 直链。`).join("\n"));
  console.log("\n硬回归全部 PASS：空 Referer 与花生壳来源放行、外域盗链 403。防盗链已生效。");
}

main().catch((e) => { console.error(e); process.exit(1); });
