// 小灰机 - 业务逻辑层入口
// 职责：启动 HTTP 服务、注册路由、请求分发
// 不做：意图判断、知识检索、回答组装（这些在各自模块里）

const http = require("http");
const path = require("path");
const fs = require("fs");
const release = require("./release-info.cjs");
const startedAt = new Date().toISOString();
const aftersales = require("./specialist/aftersales-specialist.js");
const { buildChipFirmware } = require("./chip-firmware.cjs");
const { buildProductFeatures, buildProductDetail } = require("./product-features.cjs");
const { isGhostProduct, isHardHidden, isOfficialSelectable } = require("./product-catalog.cjs");
const { attachWeCom, linkSpecLine } = require("./views/wecom-view.cjs");
const ordering = require("./ordering/ordering-specialist.cjs");
const orderEng = require("./ordering/ordering-engine.cjs");
const { renderTopoOnly: renderOrderTopo } = require("./ordering/topo-hdset.cjs");
const { buildSoftwareAnswer, isSoftwareAcquire, matchSoftware } = require("./software-catalog.cjs");
const videoCatalog = require("./video-catalog.cjs"); // 操作/教学视频：按操作主题(复位/WiFi/U盘…)跨软件检索，快查站「视频」大类与企微共用
const llm = require("./llm-client.cjs"); // 大模型统一客户端：意图判断/拟人开场白 + 答案润色/兜底，任何失败回退确定性规则
const ocr = require("./ocr-client.cjs"); // 图片文字识别 OCR：只把截图转成纯文本、不做判断，任何失败回退让客户打字
const docCategory = require("./doc-category.cjs");
const routerNlu = require("./nlu/router-nlu.cjs"); // 路由层结构化 NLU：模型输出契约校验 + 能力边界（友商/控标标书/非LED）探测，确定性优先 // 资料分类浏览：型号→客户能看懂的大类（接收卡/播放盒/处理器/单双色…），纯确定性归类

// -- 大模型润色与兜底：规则先跑出答案、过LLM润色；规则接不住时LLM直接答 --
const PORT = Number(process.env.PORT) || 3788;
// 规格书云端前缀：默认走阿里云OSS（205份中文规格书/说明书已上传到桶 he-mo，公共读，客户走云带宽、不占本机1M上行）
//   想临时切回本机 /official-files：启动时设环境变量 SPEC_PUBLIC_BASE=（空串）即可覆盖；配套脚本 scripts/upload-specs-to-oss.cjs
const SPEC_PUBLIC_BASE = String(process.env.SPEC_PUBLIC_BASE ?? "https://he-mo.oss-cn-shenzhen.aliyuncs.com").replace(/\/+$/, "");
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}
// ==================== HD固件升级助手 运行日志公网回传（POST /api/huidu/log） ====================
// 公网接口（花生壳暴露）：上报必须 X-Upload-Key；查看 GET /api/huidu/logs 必须 AI_ADMIN_TOKEN。
// 落盘 data/huidulogs/（按客户端 log_date 一个 JSONL，运营数据、不入库、.gitignore 排除）。
// 幂等：同一 machine_id + log_date 只保留一条（upsert 覆盖）；content 的 sha1 相同判重、不重复写。
// 密钥只以 backend/.env 为事实源（显式解析，避免系统里同名环境变量意外覆盖/成为有效令牌）。
const crypto = require("crypto");
const feishuBitable = require("./feishu-bitable.cjs"); // 日志同步到飞书多维表（未配置 FEISHU_APP_SECRET 时自动跳过）
const HUIDU_ENV = (() => {
  const out = {};
  try {
    const ep = path.join(__dirname, ".env");
    if (fs.existsSync(ep)) {
      for (const line of fs.readFileSync(ep, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch (e) { console.error("[huidulogs] .env", e.message); }
  return out;
})();
const HUIDU_LOG_DIR = path.join(__dirname, "..", "data", "huidulogs");
const HUIDU_MAX_BODY = 5 * 1024 * 1024; // 5MB
const HUIDU_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HUIDU_MID_RE = /^[A-Za-z0-9_.\-:]{1,64}$/;
const HUIDU_REASONS = new Set(["batch", "done", "manual"]);
try { fs.mkdirSync(HUIDU_LOG_DIR, { recursive: true }); } catch (e) { console.error("[huidulogs] mkdir", e.message); }

function huiduConstEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")); } catch { return false; }
}
function huiduLocalDate(d) {
  const x = d || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}
function huiduReadLimited(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let len = 0, done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on("data", (c) => {
      len += c.length;
      if (len > limit) { try { req.destroy(); } catch {} finish({ ok: false, status: 413, message: "日志体积超过 5MB 上限" }); return; }
      chunks.push(c);
    });
    req.on("end", () => finish({ ok: true, buf: Buffer.concat(chunks) }));
    req.on("error", () => finish({ ok: false, status: 400, message: "读取请求体失败" }));
  });
}
function huiduDayFile(date) { return path.join(HUIDU_LOG_DIR, date + ".jsonl"); }
function huiduReadDay(date) {
  const fp = huiduDayFile(date);
  if (!fs.existsSync(fp)) return [];
  const out = [];
  for (const line of fs.readFileSync(fp, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}
function huiduWriteDay(date, recs) {
  const fp = huiduDayFile(date);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, recs.map((r) => JSON.stringify(r)).join("\n") + (recs.length ? "\n" : ""), "utf8");
  fs.renameSync(tmp, fp); // 同盘原子替换
}
function huiduAppendMetric(o) {
  try { fs.appendFileSync(path.join(HUIDU_LOG_DIR, "_metrics.jsonl"), JSON.stringify(o) + "\n", "utf8"); }
  catch (e) { console.error("[huidulogs] metric", e.message); }
}
// 飞书同步失败的记录落到 feishu_outbox.jsonl，供补录脚本重放（不影响上报主链路）
function huiduFeishuOutbox(rec) {
  try { fs.appendFileSync(path.join(HUIDU_LOG_DIR, "feishu_outbox.jsonl"), JSON.stringify(rec) + "\n", "utf8"); }
  catch (e) { console.error("[huidulogs] feishu outbox", e.message); }
}
// 异步把一条落盘记录同步到飞书多维表（不 await、不阻塞 200 响应）
function huiduSyncFeishu(rec) {
  if (!feishuBitable.isConfigured()) return;
  feishuBitable.syncHuiduRecord(rec).then((r) => {
    console.log("[huidulogs] feishu " + r.action + " " + (r.key || ""));
  }).catch((e) => {
    console.error("[huidulogs] feishu sync fail: " + e.message);
    huiduFeishuOutbox(rec);
  });
}
async function handleHuiduLog(req, res) {
  const upKey = HUIDU_ENV.HUIDU_UPLOAD_KEY || "";
  if (!upKey) return sendJson(res, 503, { ok: false, message: "上传服务未配置密钥" });
  const gotRaw = req.headers["x-upload-key"];
  const got = Array.isArray(gotRaw) ? gotRaw[0] : gotRaw;
  if (!huiduConstEq(got, upKey)) return sendJson(res, 401, { ok: false, message: "X-Upload-Key 无效" });
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (!ct.includes("application/json")) return sendJson(res, 400, { ok: false, message: "Content-Type 必须为 application/json" });
  const rb = await huiduReadLimited(req, HUIDU_MAX_BODY);
  if (!rb.ok) return sendJson(res, rb.status, { ok: false, message: rb.message });
  let obj;
  try { obj = JSON.parse(rb.buf.toString("utf8")); } catch { return sendJson(res, 400, { ok: false, message: "JSON 解析失败" }); }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return sendJson(res, 400, { ok: false, message: "请求体必须是 JSON 对象" });
  const trim = (v) => (typeof v === "string" ? v.trim() : "");
  const machine_id = trim(obj.machine_id);
  const app_version = trim(obj.app_version);
  const reason = trim(obj.reason);
  const log_date = trim(obj.log_date);
  const client_ts = trim(obj.client_ts);
  const content = typeof obj.content === "string" ? obj.content : "";
  if (!HUIDU_MID_RE.test(machine_id)) return sendJson(res, 400, { ok: false, message: "machine_id 缺失或不合法（1-64位字母数字 _.-:）" });
  if (!app_version || app_version.length > 40) return sendJson(res, 400, { ok: false, message: "app_version 缺失或过长" });
  if (!HUIDU_REASONS.has(reason)) return sendJson(res, 400, { ok: false, message: "reason 必须为 batch|done|manual" });
  if (!HUIDU_DATE_RE.test(log_date)) return sendJson(res, 400, { ok: false, message: "log_date 必须为 yyyy-MM-dd" });
  if (!content) return sendJson(res, 400, { ok: false, message: "content 不能为空" });
  if (Buffer.byteLength(content, "utf8") > HUIDU_MAX_BODY) return sendJson(res, 413, { ok: false, message: "日志体积超过 5MB 上限" });

  const sha1 = crypto.createHash("sha1").update(content, "utf8").digest("hex");
  // 现场设备信息（发送端可选上报；老版本/2.1.1 不带时留空，绝不靠正则猜日志）
  const cleanDev = (v, max) => { const s = typeof v === "string" ? v.trim() : ""; return s.length > max ? s.slice(0, max) : s; };
  const nv = {
    product_models: cleanDev(obj.product_models, 500),
    chips: cleanDev(obj.chips, 500),
    version_info: cleanDev(obj.version_info, 2000),
    site_env: cleanDev(obj.site_env, 2000),
    // V2.1.3+ 拆分上报：设备段码/FPGA/应用/HDSet/HDPlayer/接收卡（老版本不带则留空）
    device_code: cleanDev(obj.device_code, 100),
    device_class: cleanDev(obj.device_class, 20),
    fpga_version: cleanDev(obj.fpga_version, 100),
    device_app_version: cleanDev(obj.device_app_version, 100),
    hdset_version: cleanDev(obj.hdset_version, 100),
    hdplayer_version: cleanDev(obj.hdplayer_version, 100),
    recv_models: cleanDev(obj.recv_models, 500),
    recv_versions: cleanDev(obj.recv_versions, 500)
  };
  // 行键：发送端给了设备段码就用「段码@日期」，否则回退「机器码@日期」（老版本/未接段码兜底）
  const devKey = (nv.device_code || "").length ? nv.device_code : machine_id;
  const recs = huiduReadDay(log_date);
  // 判行：同步卡（device_class='sync'）30 分钟窗口——同设备间隔≤30min 的上报合并一行，>30min 跨行；
  //       异步卡/默认按天（devKey+日期）合并（异步卡有完整码可唯一分辨，按天合并安全）
  let idx;
  if (nv.device_class === "sync") {
    const ts = client_ts ? new Date(client_ts).getTime() : null;
    idx = (ts === null || Number.isNaN(ts))
      ? -1
      : recs.findIndex((r) => r.devKey === devKey && r.log_date === log_date && r.client_ts &&
          Math.abs(new Date(r.client_ts).getTime() - ts) <= 30 * 60000);
  } else {
    idx = recs.findIndex((r) => r.devKey === devKey && r.log_date === log_date);
  }
  const old = idx >= 0 ? recs[idx] : null;
  // 晚到的上报若不带某设备字段，保留已落盘的值，避免把设备列清空
  const mergeDev = (k) => (nv[k] || (old && old[k] ? String(old[k]) : "") || "");
  const rec = {
    machine_id, app_version, reason, log_date, content, sha1,
    devKey,
    client_ts: client_ts || null,
    server_ts: new Date().toISOString(),
    size: Buffer.byteLength(content, "utf8"),
    product_models: mergeDev("product_models"),
    chips: mergeDev("chips"),
    version_info: mergeDev("version_info"),
    site_env: mergeDev("site_env"),
    device_code: mergeDev("device_code"),
    device_class: mergeDev("device_class"),
    fpga_version: mergeDev("fpga_version"),
    device_app_version: mergeDev("device_app_version"),
    hdset_version: mergeDev("hdset_version"),
    hdplayer_version: mergeDev("hdplayer_version"),
    recv_models: mergeDev("recv_models"),
    recv_versions: mergeDev("recv_versions")
  };
  // 正文 sha1 相同且设备字段也未变，才算重复；设备字段变化也要更新飞书
  const DEV_KEYS = ["product_models", "chips", "version_info", "site_env",
    "device_code", "device_class", "fpga_version", "device_app_version", "hdset_version", "hdplayer_version",
    "recv_models", "recv_versions"];
  const devChanged = !!old && DEV_KEYS.some((k) => (old[k] || "") !== rec[k]);
  let dedup = false, updated = true;
  if (idx >= 0) {
    if (old.sha1 === sha1 && !devChanged) {
      // 内容完全重复：只累计上传次数并落盘、同步飞书计数，不覆盖正文/设备字段
      dedup = true; updated = false;
      rec.upload_count = (old.upload_count || 0) + 1;
      recs[idx] = rec; huiduWriteDay(log_date, recs);
      huiduSyncFeishu(recs[idx]);
    }
    else {
      rec.upload_count = (old.upload_count || 0) + 1;
      recs[idx] = rec; huiduWriteDay(log_date, recs);
    }
  } else {
    rec.upload_count = 1;
    recs.push(rec); huiduWriteDay(log_date, recs);
  }

  huiduAppendMetric({ local_date: huiduLocalDate(), server_ts: rec.server_ts, machine_id, devKey, log_date, reason, app_version, dedup, updated, sha1, upload_count: rec.upload_count });
  if (!dedup) huiduSyncFeishu(rec); // 新增或内容变化才同步飞书；内容完全相同(dedup)只同步计数（上方已做）
  return sendJson(res, 200, { ok: true, dedup, updated });
}
function huiduAdminTokenOk(req, u) {
  const t = HUIDU_ENV.AI_ADMIN_TOKEN || "";
  if (!t) return false;
  const q = u.searchParams.get("token") || "";
  const hxRaw = req.headers["x-admin-token"];
  const h1 = Array.isArray(hxRaw) ? hxRaw[0] : (hxRaw || "");
  const au = String(req.headers["authorization"] || "");
  const h2 = au.startsWith("Bearer ") ? au.slice(7) : "";
  return huiduConstEq(q, t) || huiduConstEq(h1, t) || huiduConstEq(h2, t);
}
function huiduListDayFiles() {
  let files = [];
  try { files = fs.readdirSync(HUIDU_LOG_DIR); } catch { return []; }
  return files.filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.replace(/\.jsonl$/, "")).sort().reverse();
}
function huiduStats() {
  const today = huiduLocalDate();
  let todayUploads = 0;
  const todayMachines = new Set();
  const mf = path.join(HUIDU_LOG_DIR, "_metrics.jsonl");
  if (fs.existsSync(mf)) {
    for (const line of fs.readFileSync(mf, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let o = null; try { o = JSON.parse(line); } catch { continue; }
      const od = String(o.local_date || "").slice(0, 10) || String(o.server_ts || "").slice(0, 10);
      if (od === today) { todayUploads++; if (o.machine_id) todayMachines.add(o.machine_id); }
    }
  }
  const days = huiduListDayFiles();
  let totalRecords = 0;
  const allMachines = new Set();
  for (const d of days) {
    for (const r of huiduReadDay(d)) { totalRecords++; if (r.machine_id) allMachines.add(r.machine_id); }
  }
  return { todayDate: today, todayUploads, todayMachines: todayMachines.size, totalRecords, totalMachines: allMachines.size, dayCount: days.length };
}
function handleHuiduLogs(req, res, pathname) {
  const admin = HUIDU_ENV.AI_ADMIN_TOKEN || "";
  if (!admin) return sendJson(res, 503, { ok: false, message: "查看服务未配置管理员令牌" });
  const u = new URL(req.url, "http://localhost");
  if (!huiduAdminTokenOk(req, u)) return sendJson(res, 401, { ok: false, message: "管理员令牌无效（?token= 或 X-Admin-Token / Bearer）" });
  if (pathname === "/api/huidu/log") return sendJson(res, 405, { ok: false, message: "上报请用 POST /api/huidu/log" });
  const date = (u.searchParams.get("date") || "").trim();
  const mid = (u.searchParams.get("machine_id") || "").trim();
  const wantTxt = (u.searchParams.get("export") || u.searchParams.get("download") || "") === "txt";
  if (date) {
    if (!HUIDU_DATE_RE.test(date)) return sendJson(res, 400, { ok: false, message: "date 必须为 yyyy-MM-dd" });
    let recs = huiduReadDay(date);
    if (mid) recs = recs.filter((r) => r.machine_id === mid || r.devKey === mid);
    if (wantTxt) {
      if (!recs.length) return sendJson(res, 404, { ok: false, message: "无此记录" });
      const parts = recs.map((r) => [
        "# 机器码: " + r.machine_id, "# 版本: " + r.app_version, "# 类型: " + r.reason,
        "# 日志日期: " + r.log_date, "# 服务器接收: " + r.server_ts, "# 客户端时间: " + (r.client_ts || ""),
        "# SHA1: " + r.sha1, "", r.content || ""
      ].join("\n"));
      const txt = parts.join("\n\n==================== 分隔 ====================\n\n");
      const safeMid = (mid || "all").replace(/[^A-Za-z0-9_.-]/g, "_");
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"" + date + "_" + safeMid + ".txt\"",
        "Cache-Control": "private, no-store"
      });
      return res.end(txt);
    }
    return sendJson(res, 200, { ok: true, date, count: recs.length, records: recs });
  }
  if (wantTxt) return sendJson(res, 400, { ok: false, message: "导出 txt 需指定 date（可再带 machine_id）" });
  const stats = huiduStats();
  const days = huiduListDayFiles().map((d) => {
    const rs = huiduReadDay(d);
    return {
      date: d, count: rs.length,
      records: rs.map((r) => ({
        machine_id: r.machine_id, app_version: r.app_version, reason: r.reason, log_date: r.log_date,
        server_ts: r.server_ts, client_ts: r.client_ts, size: r.size, sha1: r.sha1,
        preview: String(r.content || "").slice(0, 160)
      }))
    };
  });
  return sendJson(res, 200, { ok: true, stats, days });
}
// ==================== /HD固件升级助手 日志回传 结束 ====================

// AI 回答统一出口：挂上企业微信展示层（markdown 正文 + 按钮卡片），网页端字段保持不变
// —— 统一问答采集：网页/企微所有经过 /api/ai/chat 的对话按天落 JSONL（仅本地，供质检与语料优化，不外发）——
const QA_LOG_DIR = path.join(__dirname, "..", "data", "qa-log");
try { fs.mkdirSync(QA_LOG_DIR, { recursive: true }); } catch {}
// 客户上传图片（配单截图/售后照片）统一落盘，供 3791 质检后台回看原图；仅本地保存、不外发
const QA_IMG_DIR = path.join(__dirname, "..", "data", "qa-images");
const IMG_ID_RE = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{6,40}\.(png|jpe?g|gif|webp)$/;
function sniffImageExt(buf) {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return "jpg";
}
function saveQaImage(buf) {
  try {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const iso = d.toISOString();
    const day = iso.slice(0, 10);
    const hms = iso.slice(11, 19).replace(/[:T]/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    const ext = sniffImageExt(buf);
    const dir = path.join(QA_IMG_DIR, day);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const name = hms + "-" + rand + "." + ext;
    fs.writeFileSync(path.join(dir, name), buf);
    return day + "/" + name;
  } catch (e) { console.error("[qa-image]", e.message); return ""; }
}
// 配单接收拓扑 SVG 单独落盘（qa-log 只存引用，避免日志膨胀），供 3791 质检后台回看；仅本地、不外发
const QA_TOPO_DIR = path.join(__dirname, "..", "data", "qa-topo");
// 可导入 HDSet 的 .ssm 连屏文件下载缓存（配单当次落盘，仅本地保存）
const SSM_CACHE_DIR = path.join(__dirname, "..", "data", "ssm-cache");
let _lastSsmCleanTs = 0;
function saveOrderingSsm(xml) {
  try {
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const day = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const hms = `${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
    const rand = Math.random().toString(36).slice(2, 8);
    const dir = path.join(SSM_CACHE_DIR, day);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${hms}-${rand}.ssm`;
    fs.writeFileSync(path.join(dir, name), xml, "utf8");
    if (Date.now() - _lastSsmCleanTs > 3600000) {
      _lastSsmCleanTs = Date.now();
      try {
        const cutoff = Date.now() - 14 * 86400000;
        const walk = (d) => {
          for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const fp = path.join(d, ent.name);
            if (ent.isDirectory()) { walk(fp); try { fs.rmdirSync(fp); } catch {} }
            else if (ent.name.endsWith(".ssm") && fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
          }
        };
        walk(SSM_CACHE_DIR);
      } catch {}
    }
    return `${day}/${name}`;
  } catch (e) { console.error("[ssm-cache]", e.message); return ""; }
}
function saveQaTopo(svg, ts) {
  try {
    if (typeof svg !== "string" || !/^<svg[\s>]/i.test(svg.trim())) return "";
    const day = ts.slice(0, 10), hms = ts.slice(11, 19).replace(/:/g, "");
    const rand = Math.random().toString(36).slice(2, 8);
    const dir = path.join(QA_TOPO_DIR, day);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const name = hms + "-" + rand + ".svg";
    fs.writeFileSync(path.join(dir, name), svg, "utf8");
    return day + "/" + name;
  } catch (e) { console.error("[qa-topo]", e.message); return ""; }
}
function sanitizeImageIds(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const x of arr) {
    const id = String(x || "");
    if (IMG_ID_RE.test(id)) { try { if (fs.existsSync(path.join(QA_IMG_DIR, id))) out.push(id); } catch {} }
    if (out.length >= 6) break;
  }
  return out;
}
function appendQaRecord(meta, data, ms) {
  try {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const iso = d.toISOString();
    const day = iso.slice(0, 10);
    const ts = iso.slice(0, 19).replace("T", " ");
    const model = (data && data.model) || "";
    const routeByModel = { "local-ordering": "ordering", "local-aftersales": "aftersales", "local-presales": "presales", "local-software": "software", "boundary-placeholder": "unknown" };
    let ans = (data && (data.reply || data.message || data.answer || data.wecomMarkdown)) || "";
    if (typeof ans !== "string") ans = JSON.stringify(ans);
    if (ans.length > 4000) ans = ans.slice(0, 4000);
    const __topoSvg = (data && data.ordering && data.ordering.topologySvg) || "";
    const topo = __topoSvg ? saveQaTopo(__topoSvg, ts) : "";
    const rec = {
      ts, source: meta.source || "", sid: meta.sid || "",
      q: meta.message,
      button: /^\s*\[(ORDER_|RX_|SIDE_)/.test(meta.message || ""),
      a: ans,
      route: (data && data.meta && data.meta.route) || routeByModel[model] || "",
      model,
      status: (data && data.status) || (data && data.error ? "error" : "answer"),
      escalate: (data && data.meta && data.meta.escalate) || "",
      ok: data && typeof data.ok === "boolean" ? data.ok : !(data && data.error),
      options: (data && data.quickOptions && data.quickOptions.length) || (data && data.wecomOptions && data.wecomOptions.length) || 0,
      images: Array.isArray(meta.images) ? meta.images : [],
      topo,
      ms,
    };
    fs.appendFile(path.join(QA_LOG_DIR, day + ".jsonl"), JSON.stringify(rec) + "\n", () => {});
  } catch (e) { console.error("[qa-log]", e.message); }
}
function sendAiJson(res, payload) {
  sendJson(res, 200, attachWeCom(payload));
}
// 企微折叠网口后给"网页看全部"深链用的可复现问题：当前句若是按钮 tag（[ORDER_*] 等多轮续算），
// 回退到 history 里最后一条客户人话，保证点开 ?q= 能在网页重算出同一份方案。
function replayQuery(message, history) {
  const isTag = (s) => /^\s*\[/.test(String(s || ""));
  if (!isTag(message)) return String(message || "").trim();
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.role === "user" && !isTag(h.content)) return String(h.content).trim();
  }
  return String(message || "").trim();
}

function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  // 单地址双形态（同一 3789、不需第二条花生壳）：/quick=快查站、/huiai=小灰机，均回 index.html，前端按路径切视图
  if (urlPath === "/quick" || urlPath === "/huiai") urlPath = "/index.html";
  if (urlPath === "/") urlPath = "/index.html";
  // 解码URL编码的中文文件名
  try { urlPath = decodeURIComponent(urlPath); } catch (e) {}
  const filePath = path.join(FRONTEND_DIR, urlPath);
  // 防目录穿越
  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not Found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// 纯文本金字塔回答 → 结构化 pyramid 对象（适配旧专精模块的【判断】标记格式）
function parsePyramidText(text) {
  const t = String(text || "");
  const pyramid = { conclusion: "", steps: [], fallback: "", references: [] };

  // 分流引导语：第一个分段标记（【判断】/【现场情况】/【这样解决】等任一）之前的文字，
  // 如“接收卡测试仍有现象…已按驱动芯片 X 收窄…”。不能只认【判断】——有的案例首段就是【现场情况】，否则引导语会丢。
  const leadMatch = t.match(/^([\s\S]*?)【(?:判断|现场情况|这样解决|请按顺序尝试|参考处理|兜底|来源)/);
  const lead = leadMatch ? leadMatch[1].trim().replace(/\n+/g, " ") : "";
  // 结论：【判断】之后到下一个【或空行
  const concMatch = t.match(/【判断】([\s\S]*?)(?:\n\s*\n|【|$)/);
  if (concMatch) pyramid.conclusion = (lead ? lead + " " : "") + concMatch[1].trim().replace(/\n+/g, " ");
  else if (lead) pyramid.conclusion = lead;

  // 现场情况：首选（权重最大）案例当时的现场现象总结，到下一个分段标记为止
  const sceneMatch = t.match(/【现场情况】([\s\S]*?)(?:\n【|$)/);
  if (sceneMatch) pyramid.scene = sceneMatch[1].trim().replace(/\n+/g, " ");

  // 步骤：【这样解决】/【请按顺序尝试】/【参考处理】之后的编号列表
  const stepsMatch = t.match(/【(?:这样解决|请按顺序尝试|参考处理)】([\s\S]*?)(?:\n【|— 参考案例|$)/);
  if (stepsMatch) {
    const stepLines = stepsMatch[1].split("\n").map((s) => s.trim()).filter(Boolean);
    for (const line of stepLines) {
      const m = line.match(/^\d+[\.、]\s*(.+)$/);
      if (m) {
        const raw = m[1].trim();
        // 步骤里的"（做完观察...）"作为verify，前面作为action
        const verifyMatch = raw.match(/[（(](做完[^）)]*|恢复[^）)]*|观察[^）)]*)[）)]/);
        const action = verifyMatch ? raw.replace(/[（(](做完[^）)]*|恢复[^）)]*|观察[^）)]*)[）)]/, "").trim() : raw;
        pyramid.steps.push({
          action: action.replace(/[。\s]+$/, ""),
          why: "",
          verify: verifyMatch ? verifyMatch[1] : ""
        });
      }
    }
    // 案例切不出编号步骤时（参考处理整段），把整段作为一条处理建议，避免中间内容丢失
    if (!pyramid.steps.length && stepLines.length) {
      pyramid.steps.push({ action: stepLines.join(" ").slice(0, 300), why: "", verify: "" });
    }
  }

  // 兜底：【兜底】之后到参考案例或结尾
  const fbMatch = t.match(/【兜底】([\s\S]*?)(?:— 参考案例|$)/);
  if (fbMatch) pyramid.fallback = fbMatch[1].trim().replace(/\n+/g, " ");

  // 来源：首选案例出处
  const srcMatch = t.match(/【来源】([\s\S]*?)(?:\n【|— 参考案例|$)/);
  if (srcMatch) pyramid.source = srcMatch[1].trim().replace(/\n+/g, " ");

  // 参考案例
  const refMatch = t.match(/— 参考案例：([\s\S]*)$/);
  if (refMatch) {
    pyramid.references = refMatch[1].split(/[；;]/).map((s) => s.trim()).filter(Boolean)
      .map((r) => {
        const idMatch = r.match(/(DSP-\d+)/);
        return { id: idMatch ? idMatch[1] : "", title: r };
      });
  }

  return pyramid;
}

// 从反问文本中提取问题和快捷选项
function parseClarify(text) {
  const t = String(text || "");
  // 取最后一个“以问号结尾”的句子作为核心问题（跳过其后的括号举例段）
  const sentences = t.split(/(?<=[？?])/).map((s) => s.trim()).filter(Boolean);
  const asked = [...sentences].reverse().find((s) => /[？?]\s*$/.test(s));
  const question = asked || sentences[0] || t;
  return {
    clarifyQuestion: question,
    quickOptions: ["C16系列", "A6L系列", "R712", "VP620A", "其他型号"]
  };
}

// ============ 产品资料搜索 ============
const PRODUCT_INDEX_FILE = path.join(__dirname, "..", "data", "product-index.json");
const PRODUCT_SPECS_FILE = path.join(__dirname, "..", "data", "product-specs-index.json");
let productIndexCache = null;
let productSpecsCache = null;
function loadProductIndex() {
  if (productIndexCache) return productIndexCache;
  try {
    const raw = JSON.parse(fs.readFileSync(PRODUCT_INDEX_FILE, "utf8").replace(/^\uFEFF/, ""));
    productIndexCache = Array.isArray(raw.products) ? raw.products : [];
  } catch (err) {
    console.error("[product-index load error]", err.message);
    productIndexCache = [];
  }
  return productIndexCache;
}

// ============ 接收卡固件（产品卡「固件」标签，数据源 firmware-manifest.json） ============
const FIRMWARE_MANIFEST_FILE = path.join(__dirname, "..", "data", "firmware-manifest.json");
let firmwareManifestCache = null;
function loadFirmwareManifest() {
  if (firmwareManifestCache) return firmwareManifestCache;
  try {
    const raw = JSON.parse(fs.readFileSync(FIRMWARE_MANIFEST_FILE, "utf8").replace(/^﻿/, ""));
    firmwareManifestCache = Array.isArray(raw.items) ? raw.items : (Array.isArray(raw) ? raw : []);
  } catch (err) {
    console.error("[firmware-manifest load error]", err.message);
    firmwareManifestCache = [];
  }
  return firmwareManifestCache;
}

function loadProductSpecs() {
  if (productSpecsCache) return productSpecsCache;
  try {
    const raw = JSON.parse(fs.readFileSync(PRODUCT_SPECS_FILE, "utf8").replace(/^\uFEFF/, ""));
    const map = {};
    (raw.products || []).forEach((p) => { map[p.displayName || p.product] = p; });
    productSpecsCache = map;
  } catch (err) {
    console.error("[product-specs load error]", err.message);
    productSpecsCache = {};
  }
  return productSpecsCache;
}

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
  return params;
}
// 提取规格书文件和本地PDF链接（统一中文在前）
const OFFICIAL_FILES_DIR = path.join(__dirname, "..", "frontend", "official-files");
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
function specFileBelongs(fname, want) {
  if (!want) return true;
  const esc = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(?:HD[-_ ]?)?(?<![A-Za-z0-9])" + esc + "(?![A-Za-z0-9])(?!\\s+[A-Za-z][A-Za-z0-9]*)(?!-(?:BOX|PRO|PLUS|MAX|MINI|LITE)\\b)", "i");
  return re.test(fname);
}
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
function docDedupKey(fname) {
  return fname.replace(/\.pdf$/i, "").replace(/[_\s-]*已?签章/g, "").replace(/\(\d+\)/g, "").replace(/\s+/g, "").toLowerCase();
}
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

// ============ 接收卡固件：产品卡「固件」标签（与规格书按钮同构；数据全部来自 firmware-manifest，绝不生成文件名） ============
const FW_CHIP_LABEL = { "63": "ICN1063", "65": "ICN2065", "97": "LS9937", "99": "LS99" };
const FW_CHIP_ORDER = ["65", "63", "99", "97"]; // 新平台在前，固定顺序保证同卡同序、不随机
function fwFpgaVersion(file) {
  const m = String(file || "").match(/FPGA[_\s-]?(V\d+\.\d+)/i) || String(file || "").match(/(V\d+\.\d+)/);
  return m ? m[1].toUpperCase() : "";
}
function fwVerScore(v) {
  const m = String(v || "").match(/(\d+)\.(\d+)/);
  return m ? (+m[1]) * 1000 + (+m[2]) : 0;
}
function firmwareGroupFor(productName) {
  const want = String(productName || "").toUpperCase().replace(/^HD[-_]?/, "").replace(/\s+/g, "");
  if (!want) return null;
  const items = loadFirmwareManifest().filter((it) => {
    if (it.status && it.status !== "uploaded") return false;
    if (!it.publicUrl) return false;
    return String(it.card || "").toUpperCase().replace(/\s+/g, "") === want;
  });
  if (!items.length) return null;
  const verOf = (it) => fwFpgaVersion(it.file);
  const newest = (arr) => arr.slice().sort((a, b) => fwVerScore(verOf(b)) - fwVerScore(verOf(a)))[0];
  const mkBtn = (it, label) => ({ name: it.file, url: it.publicUrl, clean: label, btn: label, kind: "firmware", ver: verOf(it) });
  const out = [];
  // 1) 通用固件：只给最新 1 个并置顶推荐（旧通用版不列出，避免客户选错）
  const common = newest(items.filter((it) => it.commonCode));
  if (common) out.push(mkBtn(common, ("通用固件 " + verOf(common) + " · 推荐").replace(/\s+/g, " ").trim()));
  // 2) 芯片系列：63/65/97/99 各取最新 1 个；E#/D# 硬件批次后缀挂在名后
  for (const ser of FW_CHIP_ORDER) {
    const cand = items.filter((it) => !it.commonCode && !it.specialCode && String(it.series) === ser);
    const it = newest(cand);
    if (it) {
      const vh = String(it.variant || "").trim();
      let label = FW_CHIP_LABEL[ser] + " 固件";
      if (/^[ED]\d+$/i.test(vh)) label += " " + vh.toUpperCase();
      if (verOf(it)) label += " · " + verOf(it);
      out.push(mkBtn(it, label.trim()));
    }
  }
  // 3) 专用固件：specialCode 或无法归入通用/四大系列（84/18 等未知系列按专用处理，绝不编芯片名）；
  //    中文变体（贴膜屏/透明屏）直接用其名；同名按钮用版本号区分
  const special = items.filter((it) => {
    if (it.commonCode) return false;
    if (FW_CHIP_LABEL[String(it.series)] && !it.specialCode) return false;
    return true;
  }).sort((a, b) => fwVerScore(verOf(b)) - fwVerScore(verOf(a)));
  const spSeen = new Set();
  for (const it of special) {
    const vh = String(it.variant || "").trim();
    let label;
    if (/[一-龥]/.test(vh)) label = vh + "固件";
    else if (/^[ED]\d+$/i.test(vh)) label = "专用固件 " + vh.toUpperCase();
    else if (vh) label = "固件 " + vh; // 老版下划线固件（如异步卡 C16L 的 V9_16_13_0 / V9_16_13_63）：忠实文件名版本串区分，对照表无此卡型、不套芯片标签
    else label = "专用固件";
    if (verOf(it)) label += " · " + verOf(it);
    const dedup = label + "|" + it.file;
    if (spSeen.has(dedup)) continue;
    spSeen.add(dedup);
    out.push(mkBtn(it, label.trim()));
  }
  if (!out.length) return null;
  return { key: "firmware", label: "固件", items: out };
}
// 企微等纯文本通道：产品固件组降级为一行可点 markdown 链接，插到产品块规格书行之后（无规格书行则挂标题行下）
function wecomFirmwareLine(p) {
  const fg = p && p.firmwareGroup;
  if (!fg || !Array.isArray(fg.items) || !fg.items.length) return "";
  const links = fg.items.map((it) => "[" + it.clean + "](" + it.url + ")").join("、");
  return "· 固件：" + links;
}
function injectFirmwareLine(text, p) {
  const line = wecomFirmwareLine(p);
  if (!line || /· 固件：/.test(text)) return text;
  const spec = text.match(/^· 规格书：[^\n]*/m);
  if (spec) return text.slice(0, spec.index + spec[0].length) + "\n" + line + text.slice(spec.index + spec[0].length);
  const head = text.match(/^【[^\n】]+】/m);
  if (head) return text.slice(0, head.index + head[0].length) + "\n" + line + text.slice(head.index + head[0].length);
  return line + "\n" + text;
}

// ============ 搜芯片：主驱动系列 → 每款接收卡“该系列最新固件”下载（与卡型页同源 manifest，绝不编文件名） ============
const CHIP_FW_FAMILY_LABEL = { "63": "ICN1063系列", "65": "ICN2065系列", "97": "LS9937系列", "99": "LS99系列", common: "通用" };
function chipFirmwareDownloads(family) {
  if (!family) return [];
  const all = loadFirmwareManifest();
  // 与卡型页 firmwareGroupFor 完全同口径：通用=commonCode；四大系列=series 命中且非专用
  const inFamily = (it) => family === "common"
    ? !!it.commonCode
    : !it.commonCode && !it.specialCode && String(it.series) === String(family);
  const byCard = new Map();
  for (const it of all) {
    if (it.status && it.status !== "uploaded") continue;
    if (!it.publicUrl || !inFamily(it)) continue;
    const card = String(it.card || "").trim();
    if (!card) continue;
    const cur = byCard.get(card);
    if (!cur || fwVerScore(fwFpgaVersion(it.file)) > fwVerScore(fwFpgaVersion(cur.file))) byCard.set(card, it);
  }
  return [...byCard.values()]
    .sort((a, b) => String(a.card).localeCompare(String(b.card), "zh-Hans-CN"))
    .map((it) => {
      const cardShort = String(it.card).replace(/^HD[-_]?/i, "");
      const label = (cardShort + " · " + fwFpgaVersion(it.file)).replace(/\s+/g, " ").trim();
      return { card: it.card, name: it.file, clean: label, btn: label, url: it.publicUrl, kind: "firmware", ver: fwFpgaVersion(it.file) };
    });
}
// 给芯片速查结果挂“按卡型下载固件”：仅主驱动芯片（primary.firmwareFamily 非空）；译码/借用芯片为 null、自动不挂
function enrichChipFirmware(cf) {
  if (!cf || !cf.hitCount || !cf.primary) return cf;
  const fam = cf.primary.firmwareFamily;
  if (fam) {
    cf.firmwareItems = chipFirmwareDownloads(fam);
    cf.firmwareFamily = fam;
    cf.firmwareSeriesLabel = CHIP_FW_FAMILY_LABEL[fam] || "";
  }
  return cf;
}
// 企微纯文本通道：搜芯片给固件时不堆十几个链接，引导客户回接收卡型号、走卡型页固件闭环（injectFirmwareLine）
function wecomChipFwLine(cf) {
  const items = cf && Array.isArray(cf.firmwareItems) ? cf.firmwareItems : [];
  if (!items.length) return "";
  const label = cf.firmwareSeriesLabel || "对应";
  return `· 固件下载：该芯片对应 ${items.length} 款接收卡的${label}固件，回复你的接收卡型号（如 R708）即可直接获取下载；也可在产品速查页「固件」分类按卡型下载。`;
}

// ============ 资料分类浏览（快查站空词分组：规格书/说明书按产品大类、固件按接收卡型号，与视频分类同构） ============
// 资料分类组内排序：视频处理器/拼接器按官网网口档位（ports→带载点数）从小到大，拼接器 VP8000 沉底；
// KV 二合一与 VP 同档，自然序 K<V 使 KV 居档首；型号→档位取配单引擎设备目录（仅 sync-processor，排除 sender）。
const DOC_PROC_RANK = (() => {
  const m = new Map();
  for (const d of (orderEng.PROCESSORS || [])) {
    if (d.deviceClass !== "sync-processor") continue;
    m.set(String(d.name).toUpperCase(), { ports: Number(d.ports) || 0, max: Number(d.max) || 0 });
  }
  return m;
})();
function docNaturalCmp(a, b) {
  const ta = String(a).toUpperCase().split(/(\d+)/).filter(Boolean);
  const tb = String(b).toUpperCase().split(/(\d+)/).filter(Boolean);
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const na = /^\d+$/.test(ta[i]); const nb = /^\d+$/.test(tb[i]);
    let c;
    if (na && nb) c = Number(ta[i]) - Number(tb[i]);
    else if (na !== nb) c = na ? -1 : 1;
    else c = ta[i].localeCompare(tb[i], "zh-Hans-CN");
    if (c) return c;
  }
  return ta.length - tb.length;
}
function docRankOf(model) {
  const m = String(model).toUpperCase();
  if (DOC_PROC_RANK.has(m)) return { group: 0, ...DOC_PROC_RANK.get(m) };
  if (/^VP8000/.test(m)) return { group: 2, ports: 0, max: 0 };
  return { group: 1, ports: 0, max: 0 };
}
function docBucketSorter(key) {
  if (key !== "processor") return (a, b) => String(a.model).localeCompare(String(b.model), "zh-Hans-CN");
  return (a, b) => {
    const ra = docRankOf(a.model); const rb = docRankOf(b.model);
    if (ra.group !== rb.group) return ra.group - rb.group;
    if (ra.group === 0) {
      if (ra.ports !== rb.ports) return ra.ports - rb.ports;
      if (ra.max !== rb.max) return ra.max - rb.max;
    }
    return docNaturalCmp(a.model, b.model);
  };
}

function buildDocsCategory(cat) {
  if (cat === "firmware") {
    // 固件只做接收卡：以接收卡型号为单位，每组直接复用产品卡同源 firmwareGroupFor（通用置顶+芯片系列+专用）
    const seen = new Set();
    const cards = [];
    for (const it of loadFirmwareManifest()) {
      if (it.status && it.status !== "uploaded") continue;
      if (!it.publicUrl || !it.card) continue;
      const key = String(it.card).toUpperCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(String(it.card).trim());
    }
    cards.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const groups = [];
    let total = 0;
    for (const card of cards) {
      const fg = firmwareGroupFor(card);
      if (!fg || !Array.isArray(fg.items) || !fg.items.length) continue;
      total += fg.items.length;
      groups.push({ key: card, label: card, count: fg.items.length, items: fg.items });
    }
    return { groups, total, modelCount: groups.length };
  }
  // 规格书/说明书：遍历产品库（幽灵型号过滤），取本型号该类资料，按确定性大类聚合，组内按型号折叠
  const products = loadProductIndex();
  const specs = loadProductSpecs();
  const buckets = new Map();
  let total = 0;
  for (const p of products) {
    const name = p.displayName || p.product;
    if (isGhostProduct(name)) continue;
    const ext = extractSpecFiles(name);
    const g = (ext.groups || []).find((x) => x.key === cat);
    if (!g || !g.items.length) continue;
    const sp = specs[name] || {};
    const officialSeries = Array.isArray(p.selector) ? p.selector.filter((x) => x && x.label === "产品系列" && x.text).map((x) => "产品系列：" + x.text).join(" ") : "";
    const seriesText = String((sp.keyParameters && sp.keyParameters.productSeries) || "") + " " + officialSeries + " " +
      (p.facts || []).join(" ") + " " + ((p.fields && p.fields.operation) || []).join(" ");
    const ck = docCategory.classifyDocModel(name, seriesText);
    if (!buckets.has(ck)) buckets.set(ck, []);
    const model = String(name).replace(/^HD[-_ ]?/, "");
    buckets.get(ck).push({ model, items: g.items });
    total += g.items.length;
  }
  const groups = [];
  for (const c of docCategory.DOC_CATEGORIES) {
    const arr = buckets.get(c.key);
    if (!arr || !arr.length) continue;
    arr.sort(docBucketSorter(c.key));
    groups.push({ key: c.key, label: c.label, count: arr.length, fileCount: arr.reduce((n, x) => n + x.items.length, 0), products: arr });
  }
  return { groups, total, modelCount: groups.reduce((n, g) => n + g.count, 0) };
}

function searchProducts(keyword) {
  const q = String(keyword || "").trim().toUpperCase();
  if (!q) return [];
  const qLetters = (q.match(/^[A-Z]+/) || [""])[0]; // 查询字母前缀（C16→C、VP620→VP；纯数字则为空）
  const products = loadProductIndex();
  const results = [];
  for (const p of products) {
    const productName = p.displayName || p.product;
    const name = String(productName || "").toUpperCase();
    const aliases = (p.aliases || []).map((a) => String(a).toUpperCase());
    const bare = name.replace(/^HD-/, "");
    // 下市/英文误切＝硬隐藏，任何情况都不展示；仅“聚合幽灵”（自身无规格书、却是更长衍生型号前缀的真实裸款，
    // 如 A3 之于 A3L/A30）在分类浏览/模糊搜索时折叠，但客户精确点名（名称或别名完全相等）时放行给自身，
    // 不得被尾缀衍生款顶替——短型号 X 不能静默答成 X+尾缀（A3≠A3L、C16≠C16L）。
    const exactPoint = bare === q || aliases.some((a) => a === q);
    if (isHardHidden(productName)) continue;
    // 聚合幽灵仅在“客户精确点名 且 官网配单库确有此真实型号”时放行（A3 真实在册→给 A3 自身）；
    // 官网无此型号的前缀巧合（如 W6 之于 W60/W62）即使精确输入也继续折叠，不复活假型号。
    if (isGhostProduct(productName) && !(exactPoint && isOfficialSelectable(productName))) continue;
    const facts = (p.facts || []).map((f) => String(f).toUpperCase()).join(" ");
    // 匹配层级（取最高档，不累加）：数字主体精确 > 以查询结尾 > 包含；同层再按时间线
    const qDigits = (q.match(/\d+/) || [""])[0];
    const nameDigits = (bare.match(/\d+/) || [""])[0];
    const bareLetters = (bare.match(/^[A-Z]+/) || [""])[0];
    const prefixOk = !qLetters || bareLetters === qLetters; // 查询带前缀时型号前缀须一致（搜C16不让D16/T16混入）
    let tier = 0;
    if (bare === q) tier = 100;                                              // 完整型号精确
    else if (aliases.some((a) => a === q)) tier = 90;                        // 别名精确
    else if (qDigits && nameDigits === qDigits && prefixOk) tier = 85;       // 数字主体精确且前缀一致：搜620→VP620，搜1620→VP1620
    else if (q.length >= 2 && bare.endsWith(q)) tier = 70;                   // 型号以查询结尾
    else if (bare.includes(q)) tier = 50;                                    // 型号包含查询
    // 别名只认“前缀”关系（对齐旧快查站 startsWith）：型号别名以查询开头，或查询以完整型号别名开头（别名须含数字且≥3字符）。
    // 不再用任意位置双向 includes，避免芯片长串（如 ICN1065L 末尾含“5L”）被产品短别名（A5L 的别名 5L）跨位误命中。
    else if (aliases.some((a) => a.startsWith(q) || (q.startsWith(a) && /\d/.test(a) && a.length >= 3))) tier = 40;
    // 参数文本弱命中仅对“带字母”的查询生效；纯数字（常是芯片数字别名，如 2025/5166）不参与，
    // 避免撞规格书里的年份(2025)、参数数值(最高5120)、规格书罗列的芯片串(138,5166,2012…)而误判成产品。
    else if (/[A-Z]/.test(q) && facts.includes(q)) tier = 15;
    if (tier > 0) {
      const productName = p.displayName || p.product;
      const specFiles = extractSpecFiles(productName);
      const pdDetail = buildProductDetail(productName);
      results.push({
        name: productName,
        aliases: p.aliases || [],
        keyParams: extractSpecParams(productName),
        features: buildProductFeatures(productName),
        featureDetail: pdDetail.detail, // 小灰机：把短标签扩成的专业介绍段（快查站仍用 features.highlights）
        featureAdv: pdDetail.adv || "", // 竞品级亮点单独成行、标签左置顶
        specFiles: specFiles.files,
        specLinks: specFiles.links,
        specPairs: specFiles.pairs,
        specGroups: specFiles.groups,
        firmwareGroup: firmwareGroupFor(productName), // 接收卡产品：规格书下方的「固件」按钮组；非接收卡/无固件为 null 不显示
        matchTier: tier,
        recency: suffixRecency(bare), // 同系列版本新旧（C最新 > S > 裸款最早）
        selOrder: (p.selectionOrder == null ? -1 : p.selectionOrder),
        rawScore: (p.score || 0)
      });
    }
  }
  // 已有正经型号命中（tier≥50：精确/结尾/包含）时，丢弃 tier15 的参数文本弱命中，
  // 避免搜接收卡 R708 时把 facts 里顺带提到 R708 的控制卡（如 HD-A6）跨系列带出串味；
  // 只有在没有任何型号级命中、纯功能词搜索时，才保留 tier15 作兜底。
  const hasStrongHit = results.some((r) => r.matchTier >= 50);
  const ranked = hasStrongHit ? results.filter((r) => r.matchTier !== 15) : results;
  // 1)匹配精确度（打1620时VP1620系列仍高于VP620）；2)同匹配层(即同系列)内新版本在前：C>H>S>A/L/T>裸款；
  // 3)同新旧再按选型时间线；4)产品自身分；5)名称
  return ranked.sort((a, b) =>
    b.matchTier - a.matchTier
    || b.recency - a.recency
    || b.selOrder - a.selOrder
    || b.rawScore - a.rawScore
    || a.name.localeCompare(b.name, "zh-Hans-CN")
  ).slice(0, 10);
}

// 同系列型号的“版本新旧分”（越大越新、推荐越靠前）。发布时间口径（用户拍板）：
// 无尾缀最早 → S 次之 → C 最晚（最新）；H=高配（实际晚于 S）、A=改款、L=低配、T及其它=衍生款，均新于裸基础款。
// 只取数字主体后的第一个字母定主代次；同一系列里几乎不会同时出现 A/L/T 竞争，固定取值保证结果确定、不写死型号。
function suffixRecency(name) {
  const bare = String(name || "").replace(/^HD[\s-]?/i, "").toUpperCase();
  const m = bare.match(/^[A-Z]+\d+([A-Z])/); // 数字主体后的第一个尾缀字母（忽略 PRO/PLUS/-U 等附加段）
  const head = m ? m[1] : "";
  if (head === "C") return 40; // 最新代
  if (head === "H") return 30; // 高配
  if (head === "S") return 20; // 次新代
  if (head === "T") return 18;
  if (head === "A") return 16; // 改款
  if (head === "L") return 14; // 低配
  if (head) return 10;         // 其它衍生尾缀：新于裸款、低于明确代次
  return 0;                    // 无尾缀裸基础款：最早
}

// 产品系列键：HD-VP410H -> VP410；HD-C16L -> C16；HD-R512T -> R512
function seriesKeyOf(name) {
  const nm = String(name || "").replace(/^HD[\s-]?/i, "").toUpperCase();
  const m = nm.match(/^([A-Z]+)[\s-]?(\d+)/);
  if (!m) return "";
  const digits = m[2];
  return m[1] + digits.slice(0, digits.length >= 3 ? 3 : digits.length);
}
// 依据查询词与“名称/别名强命中”的结果，给出同系列兄弟型号可点词条（排除已在结果中的）
// 注意：只认名称/别名命中，参数文本(facts)里顺带提到型号的产品不算同系列，避免跨系列串味
function buildRelatedChips(results, q) {
  const products = loadProductIndex();
  const QU = String(q || "").trim().toUpperCase();
  // 1) 相关系列及其优先级：查询词字母前缀系列最高；纯数字时取“名称/别名强命中”结果的系列，按命中数排序
  const keyScore = new Map();
  const mq = QU.match(/^([A-Z]+)[\s-]?(\d+)/);
  if (mq) {
    const digits = mq[2];
    keyScore.set(mq[1] + digits.slice(0, digits.length >= 3 ? 3 : digits.length), 999);
  }
  for (const r of results) {
    const name = String(r.name || "").toUpperCase();
    const aliases = (r.aliases || []).map((a) => String(a).toUpperCase());
    const strongHit = QU && (name.includes(QU) || aliases.some((a) => a.includes(QU)));
    if (strongHit) {
      const k = seriesKeyOf(r.name);
      if (k) keyScore.set(k, (keyScore.get(k) || 0) + 1);
    }
  }
  if (!keyScore.size) return [];
  // 最多覆盖 4 个相关系列，避免纯数字查询时铺太多
  const orderedKeys = [...keyScore.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, 4);
  // 2) 始终列出这些系列的全部型号供点选（不再因“已在结果列表”而隐藏），总量封顶 12
  const chips = [];
  const seen = new Set();
  for (const k of orderedKeys) {
    const members = products.filter((p) => {
      const nm = p.displayName || p.product;
      return nm && !isGhostProduct(nm) && seriesKeyOf(nm) === k;
    });
    // 同系列可点型号同样“新版本在前”：C>H>S>A/L/T>裸款，同新旧再按名称，保证与结果首位口径一致
    members.sort((a, b) =>
      suffixRecency(b.displayName || b.product) - suffixRecency(a.displayName || a.product)
      || String(a.displayName || a.product).localeCompare(String(b.displayName || b.product), "zh-Hans-CN")
    );
    for (const p of members) {
      const nm = p.displayName || p.product;
      if (seen.has(nm)) continue;
      seen.add(nm);
      chips.push({ label: nm, q: nm });
      if (chips.length >= 12) return chips;
    }
  }
  return chips;
}

// 说明：快查站不提供固件检索（固件归售后小灰机）。firmware-index.json 保留在 data/ 供售后侧使用，快查站不加载。

// ============ 售前 / 配单 / 售后 首道路由（企业微信与 AI 框统一入口）============
// 配单：要按屏体算接收卡/处理器数量、出选型方案（配单模块未上线，先占位）
const ORDERING_REGEX = /配单|配卡|配接收卡|配控制卡|怎么配|如何配|配.{0,2}屏|帮我配|我要配|配一块|配一张|配几张|几张(接收卡|控制卡|卡)|多少张(卡|接收卡|控制卡)|需要.{0,6}(几张|多少.{0,2}接收卡)|带载计算|配置方案|选型方案|物料清单|\bBOM\b|拼屏方案|配屏方案|一块屏.{0,6}配|箱体.{0,4}几张/;
// 配单进行中改方案：换/改/切换 + 同异步、点间距或尺寸，即使本轮没带完整规格也回配单续算（不依赖历史兜底）
const ORDER_CHANGE_REGEX = /(换成|改成|改为|切换|重选|换用|改用).{0,8}(同步|异步|播放盒|处理器|P\s*\d|\d{2,5}\s*[×x*])|(?:宽|高|长|宽度|高度|长度)\s*(?:改成|改为|调整成|调成|换成|换到|变成?|设成|设为)\s*\d{3,5}\s*(?:点|像素)?/;
// 屏体规格配单要素：整屏宽×高点数 / 面积 / 点间距P几 / 扫描方式 / 箱体模组数量。只给屏体规格、没带故障现象时即配单
// 配单强信号=“实体屏体参数”（尺寸/排列/米数/面积/P几/扫描/模组或卡数量）。
// 注意“能带载/带载多少”是问设备能力，无屏体参数时属售前参数咨询，故不放这里（见 PRE_SALES_REGEX）。
const ORDERING_SPEC_REGEX = /\d{2,5}\s*[×x*]\s*\d{2,5}|宽\s*\d{2,5}|高\s*\d{2,5}|平米|平方|㎡|整屏|箱体|点间距|扫描方式|\d{1,3}\s*扫|模组.{0,5}(几张|几块|数量|规格)|多少张(接收卡|控制卡|模组|箱体)|几张(接收卡|控制卡)|(?<![A-Za-z])P\s*\d(?:\.\d{1,2})?(?![A-Za-z])/;
// 拼控/拼接设备选型词：属配单（要算机箱/输出组），不是节目操作故障，避免被内容域“拼接/窗口”抢走
const SPLICER_DEVICE_REGEX = /拼接器|拼控|拼接处理器|拼接屏|视频墙|矩阵|多窗口|多画面|多信号源|多个\s*(?:4K|2K)\s*信号/;
// 配单正信号②：模组排列（几宽几高/几列几行/横向纵向几张）、整屏物理米数、模组数量——客户口语里没乘号、没“配”字也要确定性认出是配单
const ORDER_GRID_REGEX = /\d{1,3}\s*(?:宽|列)\s*\d{1,3}\s*(?:高|行)|(?:宽|长)(?:度)?\s*\d{1,3}[^\d]{0,4}\d{1,3}\s*(?:高|行)?|(?:横向|横排|横)\s*\d{1,3}\s*(?:张|块|排|列)?[^\d]{0,6}(?:纵向|纵排|纵)\s*\d{1,3}|\d+(?:\.\d+)?\s*(?:米|m)(?![a-zA-Z])|(?:宽|长|高)(?:度)?\s*\d+(?:\.\d+)?\s*(?:米|m)|\d{1,3}\s*(?:张|块|个)\s*(?:模组|单元板|箱体)|(?:模组|单元板|箱体)\s*\d{1,3}\s*(?:张|块|个)/i;
// 售前：产品资料/参数咨询语气（无故障现象时，按快查站资料回答）
const PRE_SALES_REGEX = /参数|规格|几个|多少个|网口|接口|功率|尺寸|重量|电压|功耗|供电|分辨率|点间距|带载能力|最大带载|能带载|带载多少|区别|对比|哪个好|选哪个|如何选|选型|手册|说明书|规格书|接线图|尾缀|固件(?:版本|尾缀|包|程序|文件|升级)?|配置文件|升级程序|有什么功能|功能特点|产品特点|参数表|多少钱|报价|价格|介绍一下|什么是|是什么|是啥|资料/;
// 售后软语境：没到具体现象、但明显是故障求助/效果调优（交售后硬件兜底，不当售前资料）
const AFTERSALES_SOFT_REGEX = /故障|异常|不正常|不对|有问题|出问题|坏了|坏的|失灵|卡死|卡住|死机|重启|掉线|用不了|没法用|没反应|怎么办|怎么回事|咋回事|求助|帮忙看|效果不好|效果不佳|调不好|不稳定|时好时坏|优化/;

// 是否带硬件实体（产品型号 / 芯片名 / 芯片数字）
function hasHardwareEntity(m) {
  return aftersales.extractProducts(m).length > 0
    || aftersales.extractChips(m).length > 0
    || /\b\d{3,5}[A-Z]{0,2}\b/.test(m);
}
// 干净裸串“以本地库为准”的售前判定（对标快查站搜索框）：整串无中文、含数字，且能在产品库高置信命中
// (matchTier>=40：完整/别名/数字主体/结尾/包含/别名前缀；排除参数文本弱命中 tier15)，或命中芯片固件，即售前。
// 覆盖 RB6/K08 这类“字母+少位数字”、extractProducts 正则没枚举到的短型号；库里以后加新型号无需改代码。
// 必须含数字（型号/丝印都带数字），挡掉 HD/VP 这类纯字母泛词；乱码长串在 noisyUnrecognized 已先判 unknown。
function catalogEntityHit(m) {
  const s = String(m || "").trim();
  if (s.length < 2 || !/\d/.test(s) || /[一-龥]/.test(s)) return false;
  try { if (searchProducts(s).some((p) => (p.matchTier || 0) >= 40)) return true; } catch { /* ignore */ }
  try { const cf = buildChipFirmware(s); if (cf && cf.hitCount) return true; } catch { /* ignore */ }
  return false;
}
// 输入质量门：型号/芯片丝印数字最多 5 位；超长编号或乱码不属于有效实体，确定性判死、不交模型、不硬猜。
// 判断一段连续字母是否能被完整切分为合法汉语拼音音节（如 guigeshu=规格书、canshu=参数）；
// 能拼读的是客户没切输入法打的拼音，不算乱码。随机辅音串（lqwrkjeo）切不动，仍判噪。
function isPinyinRun(w) {
  const syl = /(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(iang|uang|iong|ang|eng|ing|ong|ai|ei|ui|ao|ou|iu|ie|ve|er|an|en|in|un|vn|ia|ua|uo|a|o|e|i|u|v)/g;
  const s = String(w || "").toLowerCase();
  let m, last = 0, got = false;
  while ((m = syl.exec(s))) {
    if (m.index !== last) return false;
    last = syl.lastIndex; got = true;
  }
  return got && last === s.length;
}
function noisyUnrecognized(m) {
  const s = String(m || "").replace(/\[[A-Z_]+(?::[^\]]*)?\]/g, " ").trim();
  if (!s) return false;
  if (/[一-龥]{2,}/.test(s)) return false; // 成句中文交正常语义路由
  if (/\d{8,}/.test(s) && /^[A-Za-z0-9\-\/\s.]+$/.test(s)) return true; // 规整超长编号(SN/条码式)
  if (/\d{10,}/.test(s)) return true; // 含10位以上连续数字，即便夹少量符号/单汉字
  if ((s.match(/\d{8,}/g) || []).length >= 2) return true; // 两段以上长数字夹乱字符(如 63631804阿90138910)
  // 芯片/数字后拖一长串无意义字母（如 6363lqwrkjeoqmwiorp）：剥掉 HD 软件名等正常英文词后，仍有连续≥7位、且不能拼读成拼音的乱字母才判噪
  const deBrand = s.replace(/HDPlayer|HDSet|HDShow|HD\s?Show|HDSign|LCDPlayer|LCD\s?Player|MagicPlayer|BoxPlayer|Windows|Android/gi, " ");
  const gib = deBrand.match(/[A-Za-z]{7,}/g);
  if (gib) {
    const DICT = /^(player|display|software|windows|android|google|chrome|setting|settings|controller|receiver|sender|program|system|systems|manual|download|install|update|firmware|config|monitor|network|wireless|password|default|custom|standard|async|sync|fullcolor|indoor|outdoor|selection|huidu|distributed|management|platform|terminal|operation|perfect|support|domestic|feinteng|loongson)$/i;
    if (gib.some((w) => !DICT.test(w) && !isPinyinRun(w))) return true;
  }
  return false;
}
const UNRECOGNIZED_REPLY = "这条信息我没能识别出有效的型号或芯片丝印，看起来像一串编号或乱码。\n请重新发清晰的型号 / 芯片丝印（如 VP410C、C16L、6363、16380），或直接用一句话描述现场现象（如“C16L花屏一直闪”“搜不到设备”），我就能帮你查。";
// 证据闸：纯语气/寒暄/乱码、不含任何可服务业务信号的句子。
// noisyUnrecognized 只拦“无连续汉字”的乱码，纯中文语气噪声（“啊啊啊…乱七八糟…@#￥”）会漏到大模型，
// 模型可能被“不行了/无法识别”语气误导、无证据地强判售后。模型与正则兜底都先经 hardRouteSignal，
// 故在此一处收口：四类业务证据（硬件实体/故障现象/配单规格/软件资料）全空，且句子是乱码符号或
// 去语气指代后不剩实义（又无弱故障/求助词）时，确定性压回 unknown——模型只判类、不能无中生有。
function meaninglessNoise(m0) {
  const s = String(m0 || "").replace(/\[[A-Z_]+(?::[^\]]*)?\]/g, " ").trim();
  if (!s) return true;
  // —— 任一类业务证据存在即放行（正常交模型/路由）——
  if (aftersales.extractProducts(s).length || aftersales.extractChips(s).length) return false;
  try { if (hasHardwareEntity(s) || catalogEntityHit(s)) return false; } catch {}
  if (EFFECT_FAULT_RE.test(s) || FIRMWARE_TROUBLE_RE.test(s)) return false;
  // 连续乱码符号（@#￥%…）：真实故障/配单/资料不会这样打。命中即强判噪声，不再采信 detectDomain 的弱域
  // （“无法识别”会被弱域误判成联网故障）；唯一豁免是客户明确在形容屏体花屏乱码（“屏幕显示@#￥乱码”）。
  if (/[@#￥%…&*~`^$_{}|<>\\]{2,}/.test(s)
      && !/乱码|花屏|闪屏|黑屏|屏(?:幕|体)?(?:显示|不亮|异常|发黑)|显示(?:异常|不对|不正常)|设备|接收卡|发送卡|控制卡|处理器|播放盒|主控|模组|箱体|网线|网口/.test(s)) return true;
  const dom = aftersales.detectDomain(s);
  if (dom && dom !== "content") return false;
  if (SCREEN_SIZE_RE.test(s) || ORDER_CALC_RE.test(s) || ORDER_EXTRA_RE.test(s)) return false;
  try { if (ORDERING_REGEX.test(s) || SPLICER_DEVICE_REGEX.test(s)) return false; } catch {}
  if (ORDER_CONTEXT_RE.test(s) && /配|屏|卡|模组|单元板|箱体|处理器|播放盒|发送|接收|拼接|带载|网口|主控/.test(s)) return false;
  if (isSoftwareAcquire(s) || videoCatalog.isVideoAcquire(s)) return false;
  if (/HD\s?Player|HD\s?Set|HD\s?Show|HD\s?Sign|LCD\s?Player|屏掌控|小灰云|HD\s?20\d{2}/i.test(s)) return false;
  if (BIDDING_DOC_RE.test(s) || PRODUCT_CATEGORY_RE.test(s) || WIRING_OR_THEORY_RE.test(s)) return false;
  if (/参数|规格书|说明书|手册|固件|接口|带载|分辨率|价格|多少钱|报价|功能|接线|下载|教程|操作视频|软件|驱动芯片|接收卡|发送卡|控制卡|处理器|播放盒|升级|刷/.test(s)) return false;
  // —— 四类证据全空、且无乱码符号：仅在确属低信息密度噪声时判死 ——
  if (/坏|不行|不好使|不能用|用不了|乱码|怎么回事|咋回事|怎么办|咋办|问题|故障|求助|帮帮|怎么弄|怎么搞|咋整|为什么|啥原因|什么原因/.test(s)) return false; // 带弱故障/求助词：交模型，避免误伤真实残句
  const filler = /[啊呀哦噢喔嗯呃额呐吧呢吗嘛啦哇哎的了着过是不没要有在和也都就很太真我你他她它这那啥个些东西一下看看感觉好像似乎反正就是什么样能够能给帮让被把对请说问好可以知道收到行啦呀哦啊吧嗯]/g;
  const rest = (s.match(/[一-龥]/g) || []).join("").replace(filler, "");
  return rest.length <= 3; // 去语气/指代/寒暄字后几乎不剩实义（你好/在吗/谢谢/收到/嗯嗯/好的）
}
// 上一轮售后是否在追问芯片/型号/哪一侧：客户本轮只补一个裸型号/芯片时续走售后，不被“裸硬件→售前”抢走
function aftersalesAskingContext(history) {
  if (!Array.isArray(history)) return false;
  const lastAsst = [...history].reverse().find((h) => h && typeof h === "object" && h.role === "assistant");
  if (!lastAsst) return false;
  const lastText = String(lastAsst.content || lastAsst.message || "").trim();
  // RX_STILL 语境结尾不是问号，但客户下一轮手打芯片同样续走售后，故该语境不要求上一句以问号收尾
  const rxStillCtx = /接收卡测试画面上仍有同样现象|问题在接收卡\s*\/\s*屏体侧|已按驱动芯片/.test(lastText);
  return (lastAsst.model === "local-aftersales"
    || /驱动芯片|芯片型号|什么芯片|设备型号|具体型号|哪一类|补充.{0,6}型号/.test(lastText)
    || rxStillCtx)
    && (/[？?]\s*$/.test(lastText) || rxStillCtx);
}
// 上一轮是否正处在配单流程中（最近一条助手回复来自配单引擎）：本轮残句/补料要续走配单
function orderingInProgress(history) {
  if (!Array.isArray(history)) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && typeof h === "object" && h.role === "assistant") return h.model === "local-ordering";
  }
  return false;
}

// 流程进行中（配单/售后）客户转而索取明确资料文档/报价 → 售前，打断续聊；这些词不会出现在配单补料里
const DOC_BREAK_RE = /规格书|规格参数|技术参数|技术规格|参数表|数据手册|说明书|使用手册|操作手册|手册|接线图|配置文件|固件(?:尾缀|包|程序|文件|升级)?|升级什么固件|升级的固件|要固件|给固件|烧录文件|[Dd]atasheet|报价单|价格表|多少钱|报价|价格|规格|参数|区别|对比|接口|功率|电压|功耗|重量|尺寸|有什么功能|功能特点|产品特点/;
// 多轮流程确定性续算：上一轮在配单/售后流程中，本轮省略句沿用上一轮意图（优先于模型，稳定、不抢类）
function contextFollowup(message, history) {
  const m = String(message || "").trim();
  if (!m) return null;
  const faultNow = EFFECT_FAULT_RE.test(m) || /花屏|黑屏|闪屏|不亮|点不亮|色块|偏色|发暗|鬼影|拖影|错行|错位|连不上|搜不到|掉线|离线|异常|故障|坏了|不能用|用不了/.test(m);
  // 明确售前资料/参数咨询、且不是在补屏体尺寸或说配单 → 用于打断进行中的配单/售后流程
  const docBreak = DOC_BREAK_RE.test(m) && !SCREEN_SIZE_RE.test(m) && !/怎么配|配单|配卡|配屏|帮我配|算一下|几张卡/.test(m);
  // 售后排障流程中：补芯片/型号/现象/回答测试结果，续走售后；明确转回配单才放行
  if (aftersalesAskingContext(history)) {
    if (isSoftwareAcquire(m)) return "software";
    if (FIRMWARE_TROUBLE_RE.test(m)) return "aftersales";
    if (!faultNow && docBreak) return "presales";
    if (!faultNow && /怎么配|配单|配卡|配屏|几张卡|需要.{0,4}张|宽\s*\d|高\s*\d/.test(m)) return "ordering";
    return "aftersales";
  }
  // 配单流程中：补同异步/宽高/P几/数量/调整/确认 → 续配单；转而描述故障 → 售后；要下载 → 软件
  if (orderingInProgress(history)) {
    // 选型疑问/反问（不能用X吗、能不能换X、为啥不用X）不是报告故障，不要甩去售后
    if (faultNow && !SELECTION_QUESTION_RE.test(m)) return "aftersales";
    if (FIRMWARE_TROUBLE_RE.test(m)) return "aftersales";
    if (isSoftwareAcquire(m)) return "software";
    // 转而索取规格书/说明书/固件/报价等明确资料 → 售前，打断配单续聊（这些词不会是配单补料）
    if (docBreak) return "presales";
    // 线缆/接口传输距离咨询（HDMI线几米、网线最长多少米）→ 售前，不是配单补料
    if (CABLE_SPEC_RE.test(m) && !STRICT_SCREEN_RE.test(m)) return "presales";
    // 裸型号+参数疑问（如"A5可以接5米HDMI吗""VP210C带4K吗"）→ 售前，不是配单续聊
    if (/[A-Z]\d{1,4}[A-Z]?(?:.{0,12}(?:可以|能|支持|带|接|有什么|多少|几米|最长|最多|距离|线|接口|分辨率|4K|HDMI|网口))/.test(m) && !STRICT_SCREEN_RE.test(m) && !/怎么配|配单|配卡/.test(m)) return "presales";
    if (/同步|异步|宽|高|长|米|P\s*\d|^\s*\d|张|点|像素|列|行|排|块|网口|口|处理|发送|播放|改|换|调|可以|行|好|嗯|对|是|要|全彩|室内|户外|单色|双色|能用|用得|为啥|为什么|区别|选/.test(m)
        || SELECTION_QUESTION_RE.test(m) || aftersales.extractProducts(m).length > 0) return "ordering";
    return null;
  }
  return null;
}
// —— 大模型意图路由：只处理硬信号判不出的“错字/口语模糊地带”；意图固定 5 个，不许多造 ——
const ROUTE_INTENTS = ["presales", "aftersales", "ordering", "software", "unknown"];
const ROUTE_SYSTEM = `你是灰度科技"小灰机"客服的意图路由，只做判断、不生成答案。
把客户这句话归到下列 5 个意图之一：
- presales   ：查产品/设备参数、规格书、接口、带载、价格，或索取/询问固件（裸型号、裸芯片、"XX参数"、"XX升级什么固件/升级的固件"，只要没说升级失败或升级后异常）
- aftersales ：设备故障、显示效果异常、连不上、用不了、升级失败/升级后异常，或客户明确要"历史案例/故障案例/解决案例"，或在排查"什么设置/原因导致异常现象"
- ordering   ：配单/选型/算接收卡数量，必须出现【可计算的整屏规格】：整屏分辨率(如1920×1080)、物理宽高或米数(宽6米高3米)、模组排列(10宽9高/10列6行/横向几张纵向几张)、模组张数、整屏总点数(整点14406912)，或明确说"配单/配卡/几张卡/怎么配/算一下/按75口算"，或"整屏需要哪个型号处理器/发送卡"，或客户描述的是多块/多个物理位置的屏体工程（主屏+副屏、舞台一块两边各一块、楼上/楼下各一块、宴会厅屏加门口竖屏、N块/台/面屏等）；这类即使暂未给每块尺寸、句中只有P几，也判 ordering（下游会转人工或引导逐块补尺寸）
- software   ：要下载/安装 HD 软件，或点名 HDSet/HDPlayer/HD Show/HDSign/LCD Player/屏掌控 要手册、说明书、教程、操作视频
- unknown    ：闲聊、应答确认、残句碎片、只有一个P几或"模组"两字、省略了对象的短语、没有明确诉求，或一长串乱码/乱打字
判定优先级（大多数情况按此）：
① 出现驱动芯片丝印（FM/ICN/SM/HX/MBI/DP/LS/TC等字母+数字，或6363、16380、2065、32020、9931等纯数字芯片）就不是配单：带故障或显示效果异常→aftersales；裸芯片、问参数、问"升级什么固件/要固件"（无失败异常）→presales。
② 只有设备型号（VP/KV/A/C/R/H/T系列、发送卡、接收卡、处理器、播放盒、多功能卡），没有整屏尺寸/排列/张数/总点数，归 presales；问设备怎么接线、有什么功能、顺序播放/轮播等功能用法，也是 presales。客户明说"不是配单/不用配单"，即使句中带"配单"二字，也按他真正的问题（如问某设备带不带得起某宽度）归 presales。
③ 只有点间距 P几、点间距、扫描方式，或单个"数字×数字"分辨率，却没有整屏宽高/米数/模组排列/张数/总点数/配单词，【绝不判 ordering】（P几只是模组属性）：信息不足的残句判 unknown，明确问参数判 presales。（注：客户只发一个干净的 P几、前后无其他字，会由系统直接按配单处理，不会送到你这里） 例外：若描述了多块/多个位置的屏（≥2块、主屏/副屏、各一块、楼上/楼下、舞台加两侧、宴会厅加门口等），即使只有P几、没有整屏尺寸，也判 ordering，不要判 unknown。
④ 显示效果异常一律 aftersales，即使句中同时带 P几、芯片、模组：花屏、闪屏/一直闪、黑屏/不亮/点不亮、偏色、色块/色块不均/颜色不均、发青发红发暗、低灰不均、鬼影/拖影、摩尔纹/水波纹、消隐、黑线/亮线/横竖线、错行、画面模糊、很暗、连不上/搜不到/掉线、网口错误包/丢包、不正常/异常/故障、效果不好/需要优化参数。"什么设置/什么原因导致信号异常切换/黑屏/掉线"这类故障归因排查也归 aftersales。
⑤ 固件区分："升级失败/刷不上/变砖/升级后异常/找不到固件/固件选错"→aftersales；"XX升级什么固件/升级的固件/要固件/固件尾缀"（没有失败或异常词）→presales。
⑥ "历史案例/故障案例/解决案例/的案例"→aftersales；"屏掌控或HD软件 + 手册/教程/视频"→software；连续7个以上无意义、且不能拼读成拼音的乱字母（如6363lqwrkjeo）→unknown；但"数字+可拼拼音"（如3060guigeshu=3060规格书）按对应资料意图判 presales。
⑦ 招投标/技术参数文档（"名称：分布式图像综合管理系统、支持国产操作系统、龙芯飞腾"等参数表描述）是售前资料，判 presales，不要因含"系统/操作"等字判 aftersales。
典型例句（严格照此归类）：
- "256*128分辨率"、"160x80"（孤立规格、无型号无屏体无配单词）→unknown
- "你还有别的下载链接吗"（无软件名、无上下文）→unknown
- "没有后缀"、"多少钱"（省略了对象、无型号无芯片）→unknown
- "闪点"（两字残句、语义不明）→unknown
- "移位计算方法"（无芯片无型号、只问方法）→unknown；但"9931移动计算方法"（有芯片）→presales
- "立方屏"（产品品类）→presales；"是立方屏的"（应答确认）→unknown
- "不是配单，试问8192的宽度，T16能带的起不"→presales
- "我型号1.53 屏幕整点14406912需要用到那个型号处理器"→ordering
- "按75口的算一下"→ordering
- "发送卡有什么设置可能导致到点切换信号"→aftersales
- "网口有错误包，升级最新固件给一下 VP820A"→aftersales
- "3060guigeshu"（3060规格书）→presales；"6363123"、"6363qqqqq"（已知芯片+短噪声尾）→presales；"6363lqwrkjeoqmwiorp"（长乱码）→unknown
- "舞台中间一块大的两边各一块小的柱子上还要包两块 P3"→ordering（多块屏工程，无尺寸也判配单，下游转人工）
- "楼上大厅一块楼下进门头顶一块走字的 P4"→ordering（楼上楼下两块屏）
- "A3可以同步吗"、"最小有什么型号才支持同步"、"410有屏幕吗"（问设备能力/产品线、没有整屏规格）→presales，不是 ordering
- "U盘播放的素材有没有限制"（功能规格咨询，不是要下载/教程）→presales
- "A3发布视频发不上去"、"画面连不起来"（节目发布失败/连屏失败这类操作失败现象）→aftersales
- "强力的2.5模组"（只有友商模组+点间距、没有任何诉求）→unknown
- "A5可以接5米的HDMI线吗"、"网线最多能拉多少米"、"光纤能传多少米"（问线缆/接口能力与传输距离，不是整屏尺寸配单）→presales
- "C16L连接电脑，HDPlayer找不到设备"、"HDPlayer连不上设备/搜不到设备"（软件操作中找不到、连不上设备是故障求助）→aftersales，不是 software 下载
- 正在配单/选型的对话里客户反问"不能用C16L吗"、"能不能换成A5L"、"为啥不用R712"（在讨论选型，不是报告设备坏了）→ordering
同时判断是否需要反问补一个关键信息（型号/芯片/具体现象），需要则 needs_clarify=true 并给一句反问；
把话里的错字/口语/拼音尽量还原成标准型号/芯片写法放进 entities（只作提示，最终以本地索引为准，找不到就留空数组）。
⑧ 能力边界（拿不准就 out_of_scope=false，宁可放给本地，绝不乱拦正常客户）：
- 问的是【其他控制系统品牌】（诺瓦/NovaStar、卡莱特/Colorlight、仰邦、灵信/Linsn、凯视达等）的卡/盒/处理器、且没在问灰度(Huidu)产品 → kind='competitor-product'、out_of_scope=true；
- 要做招投标控标参数、技术应答/偏离表、标书、方案PPT、国产化(龙芯/飞腾/麒麟)参数 → kind='bidding-doc'、out_of_scope=true；
- 非 LED 控制系统（H4K、液晶/LCD/DLP 拼接墙、投影仪）→ kind='non-led'、out_of_scope=true；
- 多块独立屏(宴会厅多屏/主副屏)、单屏超大点数、弧形折角L/U异形屏 → kind 分别 'multi-screen'/'oversized'/'irregular-shape'、out_of_scope=true；
- 其余正常业务一律 kind='normal'、out_of_scope=false。
slots 只抽客户【字面明说】的，没写就 null/false，绝不推算：pitch=点间距数字(P2.5→2.5)；sync 仅 'sync'/'async'/null；screen_count=物理屏块数(单块或没提=null)；has_screen_spec=这句是否给了可计算整屏规格(整屏分辨率/物理米数/模组排列/张数/总点数；单个P几、单模组尺寸不算)；shape 仅客户明说长条/异形时填 'strip'/'irregular' 否则 null。
只输出 JSON，不要多余文字：{"intent":"...","confidence":0.0,"needs_clarify":false,"clarify_question":"","entities":[],"slots":{"pitch":null,"sync":null,"screen_count":null,"has_screen_spec":false,"shape":null},"boundary":{"out_of_scope":false,"kind":"normal","reason":""},"language":"zh"}`;
// 多轮上下文压缩提示：只告诉模型“当前在哪个流程”，帮它正确理解省略句（配单中补P几/售后中补芯片），不传内部细节
function routeContextHint(history) {
  if (!Array.isArray(history)) return "";
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && typeof h === "object" && h.role === "assistant") {
      if (h.model === "local-ordering") return "【上下文】当前正在为客户配单（在问整屏尺寸/同步异步/调整方案）。客户这句若在补屏体宽高、点间距、模组数量、选同步或异步、确认或调整上一版方案，判 ordering；若转而描述故障现象（花屏/黑屏/色块/偏色/闪/连不上），判 aftersales。";
      if (h.model === "local-aftersales") return "【上下文】当前正在售后排障（在请客户补芯片/型号/现象或反馈接收卡测试结果）。客户这句若在补芯片丝印、设备型号、现象描述或回答测试是否正常，判 aftersales。";
      return "";
    }
  }
  return "";
}
async function llmRoute(m, history) {
  const hint = routeContextHint(history);
  const user = hint ? hint + "\n客户这句话：" + String(m) : String(m);
  const raw = await llm.chat({ system: ROUTE_SYSTEM, user, json: true, temperature: 0, maxTokens: 320 });
  if (!raw) return null;
  return routerNlu.normalizeRoute(raw, m, { hasHuiduEntity: hasHuiduEntity(m), hasScreenSpec: (s2) => SCREEN_SIZE_RE.test(s2) });
}

// 零歧义显示/硬件故障现象词：命中即售后（效果优化类客户也明确归售后）。新增网络质量与故障归因。
const EFFECT_FAULT_RE = /花屏|闪屏|一直闪|闪烁|闪一下|黑屏|不亮|点不亮|偏色|色块|颜色不对|颜色异常|发青|发红|发暗|低灰不均|低灰效果|鬼影|拖影|摩尔纹|水波纹|消隐|黑线|亮线|横线|竖线|错行|错位|画面模糊|模糊|很暗|亮度不够|颜色不均|色彩不均|色块不均|显示异常|显示不正常|显示不对|无法显示|不正常|异常|故障|连不上|搜不到|找不到设备|掉线|离线|时好时坏|不稳定|卡死|卡住|死机|重启|没反应|无信号|不显示|出问题|有问题|错误包|丢包|误码|CRC\s*(报错|错误|异常)?|(导致|引起|造成|弄得).{0,12}(切换信号|信号.{0,3}(切换|异常|丢失|中断|不稳|时有时无)|黑屏|花屏|闪|掉线|离线|故障|异常|问题|不显示|无信号|不亮|灯不亮)|效果不好|效果不佳|效果差|调不好|优化一下|优化参数|效果优化/;
// 明确的升级/刷写失败、刷写后异常（铁售后）；单纯"升级固件/固件升级"不算
const FIRMWARE_TROUBLE_RE = /升级(失败|不了|不上|不成功|报错|出错|后|完).{0,12}(失败|异常|黑屏|花屏|不亮|变砖|砖|死机|没反应|无法|不行|报错|出错|找不到|搜不到)|刷(机|固件|写|程序).{0,8}(失败|不了|不上|不成功|报错|出错|变砖|砖)|变砖|刷成砖|固件(升级|更新|刷写|刷入).{0,6}(失败|不成功)|找不到固件|没有固件|固件(选错|不对|错误)|升级后(不正常|异常|黑屏|花屏|不亮)/;
// 可计算的整屏物理/像素规格（配单强信号）。新增整屏总点数/整点。
const SCREEN_SIZE_RE = /宽\s*\d{2,5}\s*[^\d]{0,3}\s*高?\s*\d{2,5}|高\s*\d{2,5}\s*[^\d]{0,3}\s*宽?\s*\d{2,5}|\d{2,5}\s*[×x*]\s*\d{2,5}|\d+(?:\.\d+)?\s*(?:米|m)(?![a-zA-Z])|(?:宽|长|高)(?:度)?\s*\d+(?:\.\d+)?\s*(?:米|m)|\d{1,3}\s*(?:宽|列)\s*\d{1,3}\s*(?:高|行)|(?:横向|横排|横)\s*\d{1,3}[^\d]{0,6}(?:纵向|纵排|纵)\s*\d{1,3}|\d{1,3}\s*(?:张|块|个)\s*(?:模组|单元板|箱体)|(?:模组|单元板|箱体)\s*\d{1,3}\s*(?:张|块|个)|(?:整点|总点|总像素|总分辨率|整屏)\s*\d{5,}|\d{5,9}\s*(?:个)?点(?:数)?(?![A-Za-z])/;
// 强屏体信号（宽/高/×/排列/张块/整点/维度词+米）；不含孤立"N米"——孤立"N米"在"5米的HDMI线"里是线缆长度而非屏体
const STRICT_SCREEN_RE = /宽\s*\d{2,5}\s*[^\d]{0,3}\s*高?\s*\d{2,5}|高\s*\d{2,5}\s*[^\d]{0,3}\s*宽?\s*\d{2,5}|\d{2,5}\s*[×x*]\s*\d{2,5}|(?:宽|长|高)(?:度)?\s*\d+(?:\.\d+)?\s*(?:米|m)|\d{1,3}\s*(?:宽|列)\s*\d{1,3}\s*(?:高|行)|(?:横向|横排|横)\s*\d{1,3}[^\d]{0,6}(?:纵向|纵排|纵)\s*\d{1,3}|\d{1,3}\s*(?:张|块|个)\s*(?:模组|单元板|箱体)|(?:模组|单元板|箱体)\s*\d{1,3}\s*(?:张|块|个)|(?:整点|总点|总像素|总分辨率|整屏)\s*\d{5,}|\d{5,9}\s*(?:个)?点(?:数)?(?![A-Za-z])/;
// 标准显示器分辨率（与 ordering-engine.cjs 的 isStandardDisplayRes 同集合）：客户孤立发=整屏输出分辨率，进配单追问点间距；256×128/128×64 等模组分辨率不在此列
const STANDARD_DISPLAY_RES_RE = /(?:^|[^\d])(1920\s*[×x*]\s*1080|3840\s*[×x*]\s*2160|2560\s*[×x*]\s*1440|1280\s*[×x*]\s*1024|1024\s*[×x*]\s*768)(?:[^\d]|$)/i;
// 配单选型语境词（与屏体规格/设备选型搭配才成立）
const ORDER_CONTEXT_RE = /配单|配屏|配卡|怎么配|如何配|选型|接收卡|控制卡|发送卡|拼接器|处理器|播放盒|主控|带载|网口|几张|多少张|多少个卡|屏体|整屏|箱体|模组|单元板|列|行|排|宽|高|长|面积|分辨率|像素|点间距|P\s*\d|同步|异步/;
// 客户问"怎么接线/怎么连/有什么功能/顺序播放/轮播"等功能与接线原理，不是配单，交模型（通常售前）
const WIRING_OR_THEORY_RE = /怎么接|如何接|接线|连线|怎么连|如何连|级联|串联|并接|网线怎么|连.{0,3}(?:网口|网线)|第一个网口|任意(?:网口|网线|一个)|网口.{0,4}(?:还是|随便|任意)|网线.{0,4}(?:随便|任意|哪根|还是)|有什么功能|功能介绍|顺序播放|轮播|切换节目|计算方法|移位计算|原理/;
// 配单交付动作：给了整屏规格/模组排列/卡数，并要求“画/出/生成 接线图/拓扑图/连屏图/布线图”，这是配单要出的图，不是售前接线原理咨询
const ORDER_DIAGRAM_RE = /(?:画一?个?|画张|绘制|出一?张?|生成|给我一?张?|给个|做一?个?|来一?张?)[^，。；;！!？?]{0,10}(?:接线图|接线示意|拓扑图|连屏图|连接图|布线图|组网图|走线图)|(?:接线图|拓扑图|连屏图|连接图|布线图|组网图|走线图)[^，。；;]{0,8}(?:画一?个?|出一?张?|生成|给|做)/;
// 线缆传输距离/接口能力咨询（售前）：HDMI线/网线/光纤 能接多长、最多多少米、N米的线；不是整屏尺寸配单，也不是网络故障
const CABLE_SPEC_RE = /(?:HDMI|HDM\s?I|视频线|网线|光纤|超[五5六6]类|[五5六6]类线|延长线|USB线|电源线|VGA|DP线|Type-?C线|信号线|传输线)[^。？?！!]{0,20}(?:最多|最长|能拉|能带|可以拉|可拉|能接|可以接|可接|支持|有效距离|传输距离|多少米|几米|\d+(?:\.\d+)?\s*(?:米|m))|(?:最多|最长|能拉|可以拉|能带|能接|可以接)[^。？?！!]{0,16}\d+(?:\.\d+)?\s*(?:米|m)[^。？?！!]{0,8}(?:HDMI|视频|网|光纤|延长|USB|电源|VGA|DP|信号)?线|\d+(?:\.\d+)?\s*(?:米|m)[^。？?！!]{0,6}(?:的)?(?:HDMI|视频|网|光纤|延长|USB|电源|VGA|DP|信号)?线/;
// 配单会话中的选型疑问/反问（"不能用C16L吗/能不能换A5/为啥不用R712"），是在讨论选型而非报告故障；区别于陈述故障"C16L不能用了"
const SELECTION_QUESTION_RE = /能不能用|可以用|可否用|能否用|能用.{0,8}吗|不能用.{0,8}吗|可不可以用|用得[起了]吗|为啥(?:不?用|选)|为什么(?:不?用|选)|要不要用|需不需要用|换成|换用|改用|能不能换|可以换|划算|贵不贵|省不省|哪个(?:好|划算|省)/;

// 配单成立的强锚点：仅有"数字×数字+分辨率"是残句(unknown)，还需 P几/同异步/米/宽高/张数/模组/接收卡等才算配单
const ORDER_STRONG_CTX_RE = /配单|配屏|配卡|怎么配|如何配|选型|几张|多少张|多少个卡|接收卡|控制卡|发送卡|拼接器|处理器|播放盒|主控|箱体|整屏|屏体|模组|单元板|宽(?:度)?\s*\d|高(?:度)?\s*\d|长(?:度)?\s*\d|\d+(?:\.\d+)?\s*(?:米|m)|P\s*\d|同步|异步|\d+\s*扫|\d{1,3}\s*(?:张|块|个)|列|行|排/;
// 招投标/技术参数文档特征（无故障词时属售前资料）
const BIDDING_DOC_RE = /技术参数|技术要求|技术规格|招标|投标|名称\s*[:：]|类别\s*[:：]|国产(?:硬件|操作系统|芯片)|龙芯|飞腾|鲲鹏|分布式.{0,8}(?:系统|平台|管理)|参数表/;
// 明确在算配单数量（接收卡按X带载/需要N张卡或N条网线/总分辨率/几个4K）
const ORDER_CALC_RE = /接收卡[\s\S]{0,18}(?:按\s*\d|带载|共|需要|几张|多少)|(?:需要|共|合计)\s*\d+\s*(?:张|条)(?:R?\d{2,4}|接收卡|网线|卡)?|总分辨率|需要\s*几个\s*4?\s*K|带载[\s\S]{0,6}\d/;
// 配单补充语：续算/帮算、按网口算、按整屏点数选处理器/发送卡
const ORDER_EXTRA_RE = /算一下|帮我算|帮忙算|帮算|重新算|按.{0,8}(?:口|接口|网口|列|宽|高|扫|卡数).{0,8}算|需要.{0,8}(?:什么|哪个|那种|那个|哪款).{0,5}(?:型号)?(?:处理器|拼接器|发送卡|主控|播放盒)|(?:处理器|拼接器|发送卡|主控设备|播放盒).{0,10}(?:选型|选哪|用哪个|用什么|什么型号|那个型号|哪个型号|哪种)/;
// 明确否定配单（"不是配单/不用配单"），避免句中带"配单"二字被误判
const NEG_ORDER_RE = /不(?:是|要|用|算|需要|想).{0,4}配[单屏卡]|非配单|不用配单|不是配屏/;
// 产品品类词（问这类异形/整机品类=售前），应答确认句式除外
const PRODUCT_CATEGORY_RE = /魔方屏|立方屏|灯杆屏|海报屏|广告机|柔性屏|透明屏|异形屏|格栅屏|地砖屏|会议屏|一体机|双面屏|圆柱屏|球形屏/;
const CATEGORY_ANSWER_RE = /^\s*(?:是|对|嗯|哦|收到|可以|好的|是的|对的)/;
// 意图确认缓存文件：首轮（无历史）被确认过的问法 → 意图，只锁判类、不锁答案
const INTENT_CACHE_FILE = path.join(__dirname, "..", "data", "intent-cache.json");
function normQuestion(q) { return String(q || "").replace(/\s+/g, "").replace(/[。！？!?，、~～]+$/g, "").toLowerCase(); }
function loadIntentCache() { try { return JSON.parse(fs.readFileSync(INTENT_CACHE_FILE, "utf8") || "{}"); } catch { return {}; } }
function cachedIntent(message, history) {
  try {
    if (history && history.length) return null; // 仅首轮锁，续聊交给上下文
    const c = loadIntentCache();
    return c[normQuestion(message)] || null;
  } catch { return null; }
}
function recordConfirmedIntent(message, intent) {
  try {
    const c = loadIntentCache();
    c[normQuestion(message)] = intent;
    fs.writeFileSync(INTENT_CACHE_FILE, JSON.stringify(c, null, 2), "utf8");
  } catch {}
}
// 词边界提取失败时，从"数字+字母粘连串/长数字"里挖已知芯片前缀（仅无中文裸串），承接短噪声尾
function looseChipEntity(m) {
  if (/[一-龥]/.test(m)) return false;
  const cands = new Set(); let mm;
  const reDW = /\d{3,7}[A-Za-z]{0,6}/g;
  while ((mm = reDW.exec(m))) {
    const d = String(mm[0].match(/^\d{3,7}/)[0]);
    if (d.length <= 5) cands.add(d);
    else { cands.add(d.slice(0, 4)); cands.add(d.slice(0, 3)); }
  }
  for (const c of cands) { try { if (aftersales.extractChips(c).length > 0) return true; } catch {} }
  return false;
}
// 没切输入法的拼音资料词（3060guigeshu=3060规格书）
function pinyinDocEntity(m) {
  if (/[一-龥]/.test(m)) return false;
  return /\d{3,5}[A-Za-z]*(?:guigeshu|guige|canshu|shuomingshu|shuoming|shengji|xiazai|peizhi|gujian|wenjian|shouce|jiaocheng|shipin)/i.test(m)
      || /^(?:guigeshu|canshu|shuomingshu|shengji|xiazai)/i.test(m);
}
// LED软件界面截图的纯状态罗列（网口/卡号/版本号，无提问无故障无配单），没有客户诉求
function ocrEmptyState(m) {
  if (!/LED软件界面/.test(m)) return false;
  const s = m.replace(/图片OCR辅助信息[（(][^）)]*[）)]：?/g, " ").replace(/LED软件界面|可确认外观|可确认文字|图片类型|图片识别结果：?/g, " ");
  if (/[吗呢]|怎么|如何|支持|有没有|是否|需要|几个|几张|多少|配卡|配单|不亮|黑屏|花屏|闪|异常|故障|连不上|不显示|没反应|\d{2,5}\s*[×x*]\s*\d{2,5}/.test(s)) return false;
  return true;
}
// 第一层：零歧义铁规则（确定性、免费、毫秒级）。命中即定类，不经过大模型；返回 null 才交模型。
function hardRouteSignal(message) {
  const m = String(message || "");
  const prods = aftersales.extractProducts(m);
  const chips = aftersales.extractChips(m);
  const hasDevice = prods.length > 0, hasChip = chips.length > 0;
  // 内部按钮 tag（续算/选型/案例下钻），最高优先
  if (/\[(ORDER_ADD_MODULE|ORDER_ACCEPT_PROVISIONAL|ORDER_PICK_ASYNC|ORDER_PICK_SYNC|ORDER_ADJUST|SCENE_OFFICIAL|SCENE_GENERIC|SCENE_MEETING|SCENE_POSTER)/.test(m)) return "ordering";
  if (/\[(RX_STILL|RX_OK|SIDE_ASYNC|SIDE_SYNC|CASE_DETAIL)/.test(m)) return "aftersales";
  // 明确要历史案例
  if (/案例/.test(m)) return "aftersales";
  // 软件本身故障（闪退/打不开/崩溃/无响应）→售后；明确要下载/重装包才走软件获取
  if (/HD\s?Player|HD\s?Set|HD\s?Show|HD\s?Sign|HD\s?20\d{2}|LCD\s?Player/.test(m)
      && /闪退|崩溃|打不开|无法打开|不能打开|无法启动|启动不了|无响应|未响应|卡死|卡住|卡顿|停止工作|停止运行|已停止|报错|用不了|不能用|无法使用|安装失败|运行不了|死机|登不上|登录失败|连不上|连接失败|发不出|发送失败/.test(m)
      && !/重装|重新安装|下载|安装包|安装程序|客户端/.test(m)) return "aftersales";
  // 软件获取 / 软件手册教程视频 / 明确要操作教学视频（复位、投屏、WiFi 等操作主题，跨软件）
  // 句中带真实故障现象（找不到/连不上/搜不到设备等）→ 售后，软件下载不得抢判
  const swAcquire = isSoftwareAcquire(m) || videoCatalog.isVideoAcquire(m);
  if (swAcquire && EFFECT_FAULT_RE.test(m)) return "aftersales";
  if (swAcquire) return "software";
  // 乱码 / 超长编号 → unknown
  if (noisyUnrecognized(m)) return "unknown";
  // 纯中文语气/寒暄噪声（四类业务证据全空）→ unknown，模型与兜底共用此闸，不被语气误导强判售后
  if (meaninglessNoise(m)) return "unknown";
  // LED软件界面纯状态截图、无诉求 → unknown
  if (ocrEmptyState(m)) return "unknown";
  // 招投标/技术参数标书（强特征、无第一人称故障求助）→售前；文中"模糊查找/信号切换/热恢复"是功能描述，须在 EFFECT 之前
  if (BIDDING_DOC_RE.test(m) && /招标|投标|技术参数|技术规格|参数表|国产(?:硬件|操作系统|芯片)|龙芯|飞腾|鲲鹏|申威|名称\s*[:：][^\n]{0,24}(?:系统|平台|管理|设备)/.test(m) && !/我的|我这|我们这|咋回事|怎么回事|怎么办|求助|坏了|不亮了|黑屏了|花屏了|一直闪/.test(m)) return "presales";
  // 单个点间距 P几（无尺寸/排列/张数）→ 进配单，由配单引擎反问整屏宽高与同异步
  if (/^\s*P\s*\d+(?:\.\d+)?\s*(?:屏|全彩|室内|户外|的)?\s*$/i.test(m)) return "ordering";
  // ① 显示/硬件效果故障（最高优先，压过固件索取与配单）
  if (EFFECT_FAULT_RE.test(m)) return "aftersales";
  // 线缆传输距离/接口能力咨询（HDMI线/网线/光纤能接多长、N米的线）→售前；须在屏体米数配单之前，且无故障现象
  // 配单出图：有屏体规格/排列/卡数且明确要“画接线/拓扑图”，是配单交付物，不算售前线缆/接线咨询
  const orderDiagram = ORDER_DIAGRAM_RE.test(m) && (SCREEN_SIZE_RE.test(m) || ORDER_GRID_REGEX.test(m) || ORDER_CALC_RE.test(m) || /\d{1,3}\s*张[^，。；;]{0,6}(?:R?\d{2,4}|接收卡|控制卡|卡)/.test(m));
  if (CABLE_SPEC_RE.test(m) && !EFFECT_FAULT_RE.test(m) && !FIRMWARE_TROUBLE_RE.test(m) && !orderDiagram) return "presales";
  const isWiringOrTheory = WIRING_OR_THEORY_RE.test(m) && !/(故障|异常|不亮|黑屏|花屏|闪|连不上|搜不到|掉线|没反应|不显示|错误包|丢包)/.test(m);
  // 接线/功能用法/原理方法（无故障词）：有设备/芯片/明确功能或接线词→售前；纯"计算方法/原理"无对象→残句；其余交模型
  if (isWiringOrTheory && !orderDiagram) {
    if (hasDevice || hasChip || /多功能卡|发送卡|接收卡|控制卡|播放盒|处理器|拼接器|主控|怎么接|如何接|接线|怎么连|如何连|级联|顺序播放|轮播|切换节目|有什么功能|网口|网线/.test(m)) return "presales";
    if (/计算方法|原理/.test(m)) return "unknown";
  }
  // 明确在算配单数量 → 配单，优先于故障域；排除更换/维修语境
  if (ORDER_CALC_RE.test(m) && !EFFECT_FAULT_RE.test(m) && !/坏了|坏掉|更换|换一张|换一个|维修|返修|不工作/.test(m)) return "ordering";
  if (orderDiagram) return "ordering"; // 给了屏体规格/排列/卡数且要画接线/拓扑图=配单交付物
  // 售前购买/选型意愿（想要/想买/推荐/有没有带某功能 + 设备），不是故障
  if (/(?:想要|想买|要买|要个|来个|求购|推荐(?:一)?(?:款|个)?|选(?:一)?(?:款|个)|有没有(?:带|支持)|哪款(?:好|适合)|需要一(?:款|个))/.test(m)
      && /(?:发送卡|接收卡|控制卡|播放盒|处理器|拼接器|主控|设备|WiFi|wifi|无线|4G|网口|播放|卡|盒)/.test(m)
      && !EFFECT_FAULT_RE.test(m)) return "presales";
  // ② 故障域定域
  const domain = aftersales.detectDomain(m);
  if (domain === "firmware") {
    // 明确升级失败/刷写异常 → 售后；单纯索取固件/问升级什么/配置文件 → 售前
    if (FIRMWARE_TROUBLE_RE.test(m)) return "aftersales";
    if (hasChip || hasDevice || /\d{3,5}/.test(m) || /配置文件|升级什么固件|升级的固件|要固件|给固件|固件尾缀|烧录/.test(m)) return "presales";
    return null; // 无对象的泛固件话题交模型
  }
  if (domain && domain !== "content") {
    const hanLen = (m.match(/[一-龥]/g) || []).length;
    if (hanLen <= 3 && !hasDevice && !hasChip && !EFFECT_FAULT_RE.test(m)) return "unknown"; // 超短残句(如"闪点")信息不足，直接 unknown 走补料
    // 接线/功能原理类即使命中 display 词也不当故障，交模型
    if (domain === "display" && isWiringOrTheory) return null;
    // 购物/采购/招投标语境下的功能词不是故障
    if (/哪里有卖|哪里买|多少钱|报价|采购|招标|投标|技术参数|技术要求|参数表|规格书|说明书|购买|供货/.test(m)) return null;
    return "aftersales";
  }
  // 招投标/技术参数文档（无故障词）→ 售前资料
  if (BIDDING_DOC_RE.test(m) && !EFFECT_FAULT_RE.test(m) && !FIRMWARE_TROUBLE_RE.test(m)) return "presales";
  // ③ 配单：必须有可计算的整屏规格或明确配单语；芯片独占且无规格不判配单
  const chipBlocks = chips.length && !/屏|模组|单元板|箱体|宽|高|长|面积|分辨率|像素|张|块|口|列|行|排|配|带载|处理|发送|播放|同步|异步|P\s*\d/.test(m);
  const negOrder = NEG_ORDER_RE.test(m);
  const baseOrderWord = ORDERING_REGEX.test(m) || ORDER_EXTRA_RE.test(m);
  const explicitOrder = (negOrder ? ORDER_EXTRA_RE.test(m) : baseOrderWord)
    || ORDER_CHANGE_REGEX.test(m) || /\[(ORDER_ADD_MODULE|ORDER_ACCEPT_PROVISIONAL|ORDER_PICK_ASYNC|ORDER_PICK_SYNC|ORDER_ADJUST|SCENE_OFFICIAL|SCENE_GENERIC|SCENE_MEETING|SCENE_POSTER)/.test(m);
  const hasSize = SCREEN_SIZE_RE.test(m);
  const hasCtx = ORDER_CONTEXT_RE.test(m);
  if (explicitOrder && !chipBlocks) return "ordering";
  if (SPLICER_DEVICE_REGEX.test(m) && (ORDER_STRONG_CTX_RE.test(m) || hasSize) && !chipBlocks) return "ordering";
  if (hasSize && ORDER_STRONG_CTX_RE.test(m) && !chipBlocks) return "ordering";
  // 孤立标准显示器分辨率（1920×1080 等）= 客户给的整屏输出分辨率，进配单追问点间距；模组分辨率（256×128 等）仍按残句
  if (STANDARD_DISPLAY_RES_RE.test(m) && !ORDER_STRONG_CTX_RE.test(m) && !hasDevice && !hasChip && !EFFECT_FAULT_RE.test(m) && !/是什么|什么意思|是多少|几\s*K|参数|规格书|说明书|支持不|带得?[动起]/.test(m)) return "ordering";
  // 只有"数字×数字"分辨率/扫描、无配单强锚点/硬件实体/故障 → 信息不足残句 unknown
  if (/\d{2,5}\s*[×x*]\s*\d{2,5}/.test(m) && !ORDER_STRONG_CTX_RE.test(m) && !hasDevice && !hasChip && !EFFECT_FAULT_RE.test(m)) return "unknown";
  // ④ 产品品类词（非应答句、无配单规模）→ 售前
  if (PRODUCT_CATEGORY_RE.test(m) && !CATEGORY_ANSWER_RE.test(m) && !explicitOrder && !hasSize) return "presales";
  // ⑤ 干净裸型号/裸芯片（无中文现象描述）→ 售前快查；含已知芯片+短噪声尾/拼音资料词同样售前；
  //    最后用“本地库整串高置信命中”兜底 RB6 这类短型号（库里有即售前，不依赖正则枚举）
  const cleanEntity = !/[一-龥]/.test(m) && (hasHardwareEntity(m) || looseChipEntity(m) || pinyinDocEntity(m) || catalogEntityHit(m));
  if (cleanEntity) return aftersalesAskingContext(m) ? "aftersales" : "presales";
  // 中文资料/参数咨询（参数/规格书/固件/配置文件/区别对比/价格/功能等）：走到这里已排除故障域与可计算整屏规格，
  // 复用 PRE_SALES_REGEX（模型失败兜底本就同判）在第一层确定性接住高频标准售前问法，不再逐条赌模型
  if (PRE_SALES_REGEX.test(m)) return "presales";
  return null; // 其余模糊/冲突/口语/残句/OCR → 交模型主判
}
// 主路由（异步）：tag/已确认缓存 → 铁规则 → DeepSeek 主判模糊句 → 正则兜底
function hasHuiduEntity(m) {
  try {
    return (aftersales.extractProducts(m) || []).length > 0
      || (aftersales.extractChips(m) || []).length > 0
      || catalogEntityHit(m)
      || /灰度|huidu|HD\s?Player|HD\s?Set|HD\s?Show|HD\s?Sign|屏掌控/i.test(m);
  } catch (e) { return false; }
}

// 结构化路由：内部tag → 能力边界闸门 → 已确认缓存 → 多轮上下文 → 确定性铁规则 → DeepSeek结构化NLU(过校验器) → 正则兜底
async function resolveRoute(message, history) {
  const msg = String(message || "");
  let tag = "";
  if (/\[(ORDER_ADD_MODULE|ORDER_ACCEPT_PROVISIONAL|ORDER_PICK_ASYNC|ORDER_PICK_SYNC|ORDER_ADJUST|SCENE_OFFICIAL|SCENE_GENERIC|SCENE_MEETING|SCENE_POSTER)/.test(msg)) tag = "ordering";
  if (/\[(RX_STILL|RX_OK|SIDE_ASYNC|SIDE_SYNC|CASE_DETAIL)/.test(msg)) tag = "aftersales";
  if (tag) return { intent: tag, detail: routerNlu.blankDetail(tag, "tag") };
  const hb = routerNlu.detectHardBoundary(msg, { hasHuiduEntity: hasHuiduEntity(msg) });
  if (hb && routerNlu.HUMAN_BOUNDARY.has(hb.kind)) {
    return { intent: routerNlu.BOUNDARY_INTENT[hb.kind] || "presales", detail: routerNlu.hardBoundaryDetail(hb) };
  }
  const cached = cachedIntent(msg, history);
  if (cached) return { intent: cached, detail: routerNlu.blankDetail(cached, "cache") };
  const ctx = contextFollowup(msg, history);
  if (ctx) return { intent: ctx, detail: routerNlu.blankDetail(ctx, "context") };
  const softHb = hb && !routerNlu.HUMAN_BOUNDARY.has(hb.kind) ? hb : null;
  const withSoft = (d) => {
    if (softHb && d.boundary && d.boundary.kind === "normal") d.boundary = { kind: softHb.kind, escalate: false, reason: softHb.reason };
    return d;
  };
  const hard = hardRouteSignal(msg);
  if (hard) return { intent: hard, detail: withSoft(routerNlu.blankDetail(hard, "hard")) };
  // 多屏/超大/异形是确定性结构信号：售后/软件等铁规则已在上方先行切走，落到这里的交配单 specialist
  // （其内部有转人工或逐块引导），避免被通用 unknown 兜底漏走。
  if (softHb) return { intent: "ordering", detail: withSoft(routerNlu.blankDetail("ordering", "hard-multiscreen")) };
  if (llm.enabled()) {
    const detail = await llmRoute(msg, history);
    if (detail && detail.confidence >= 0.6 && detail.intent !== "unknown") return { intent: detail.intent, detail };
  }
  const fb = routeIntentFallback(msg);
  return { intent: fb, detail: withSoft(routerNlu.blankDetail(fb, "fallback")) };
}

async function routeIntent(message, history) {
  const r0 = await resolveRoute(message, history);
  return r0.intent;
}
// 正则兜底（模型关闭/超时/低置信/判 unknown 时）：先复用铁规则，再走历史软正则
function routeIntentFallback(message) {
  const m = String(message || "");
  const hard = hardRouteSignal(m);
  if (hard) return hard;
  const chips = aftersales.extractChips(m);
  const prods = aftersales.extractProducts(m);
  const hasDevice = prods.length > 0, hasChip = chips.length > 0;
  const chipBlocks = chips.length && !/屏|模组|单元板|箱体|宽|高|长|面积|分辨率|像素|张|块|口|列|行|排|配|带载|处理|发送|播放|同步|异步|P\s*\d/.test(m);
  const negOrder = NEG_ORDER_RE.test(m);
  const baseOrderWord = ORDERING_REGEX.test(m) || ORDER_EXTRA_RE.test(m);
  const explicitOrder = (negOrder ? ORDER_EXTRA_RE.test(m) : baseOrderWord) || ORDER_CHANGE_REGEX.test(m);
  const hasSize = SCREEN_SIZE_RE.test(m);
  const hasCtx = ORDER_CONTEXT_RE.test(m);
  const isWiringOrTheory = WIRING_OR_THEORY_RE.test(m) && !/(故障|异常|不亮|黑屏|花屏|闪|连不上|搜不到|掉线|没反应|不显示|错误包|丢包)/.test(m);
  if (explicitOrder && !chipBlocks) return "ordering";
  if (SPLICER_DEVICE_REGEX.test(m) && (ORDER_STRONG_CTX_RE.test(m) || hasSize) && !chipBlocks) return "ordering";
  if (hasSize && ORDER_STRONG_CTX_RE.test(m) && !chipBlocks) return "ordering";
  // 孤立标准显示器分辨率（1920×1080 等）= 客户给的整屏输出分辨率，进配单追问点间距；模组分辨率（256×128 等）仍按残句
  if (STANDARD_DISPLAY_RES_RE.test(m) && !ORDER_STRONG_CTX_RE.test(m) && !hasDevice && !hasChip && !EFFECT_FAULT_RE.test(m) && !/是什么|什么意思|是多少|几\s*K|参数|规格书|说明书|支持不|带得?[动起]/.test(m)) return "ordering";
  // 只有"数字×数字"分辨率/扫描、无配单强锚点/硬件实体/故障 → 信息不足残句 unknown
  if (/\d{2,5}\s*[×x*]\s*\d{2,5}/.test(m) && !ORDER_STRONG_CTX_RE.test(m) && !hasDevice && !hasChip && !EFFECT_FAULT_RE.test(m)) return "unknown";
  if (PRODUCT_CATEGORY_RE.test(m) && !CATEGORY_ANSWER_RE.test(m) && !explicitOrder && !hasSize) return "presales";
  if (/案例/.test(m)) return "aftersales";
  if (isSoftwareAcquire(m) && (EFFECT_FAULT_RE.test(m) || FIRMWARE_TROUBLE_RE.test(m))) return "aftersales";
  if (isSoftwareAcquire(m)) return "software";
  if (noisyUnrecognized(m) || ocrEmptyState(m)) return "unknown";
  if (EFFECT_FAULT_RE.test(m) || FIRMWARE_TROUBLE_RE.test(m)) return "aftersales";
  if (CABLE_SPEC_RE.test(m)) return "presales";
  if (AFTERSALES_SOFT_REGEX.test(m) && !isWiringOrTheory && !/哪里有卖|哪里买|多少钱|报价|采购|招标|投标|技术参数|技术要求|参数表|规格书|说明书|购买|供货/.test(m)) {
    if (hasChip || hasDevice || /屏|卡|设备|发送|接收|控制|播放|处理器|模组/.test(m)) return "aftersales";
  }
  if (!/[一-龥]/.test(m) && (hasHardwareEntity(m) || looseChipEntity(m) || pinyinDocEntity(m) || catalogEntityHit(m))) return "presales";
  if (PRE_SALES_REGEX.test(m)) return "presales";
  if (hasChip || hasDevice) return "presales";
  return "unknown";
}
const HUMANIZE_SYSTEM = `你是灰度科技 LED 控制系统的客服“小灰机”，懂行、说话利落像工程师。下面给你“对象 + 咨询类型”，请写【一句】把客户自然带到资料上的承接语。
要求：①陈述句，12–22字，口语、干脆，不端客服腔；②可以点出这份资料大致包含什么（如接口、带载、固件尾缀、规格书），但只能依据“咨询类型”泛说，严禁写出任何具体数值或我没给的型号/芯片/对比，对象名照用给你的；③禁用“好的、可以、我来为您、这就为您、为您说明、为您整理、相关情况如下、如下所示、下面为您”等套话；④不带问号和感叹号，不用“命中/库里/系统”这类机器腔；⑤同一类对象换自然说法，别每次都是同一句。只输出这一句，不加引号。`;
const leadCache = new Map(); // key = 咨询类型|对象 → 开场白，命中即复用，保证同问同答、不随机
// 开场白安全校验：反问句(带问号)、或冒出"已识别对象"之外的型号/芯片数字，一律判不合格 → 空串，绝不让模型脑补实体
function leadLooksSafe(text, allowNums) {
  if (!text) return false;
  const t = String(text).trim();
  if (/[?？]/.test(t)) return false;                       // 反问句不合格
  if (t.replace(/[\s，。、,.！!~～]/g, "").length > 24) return false; // 过长=啰嗦套路，不合格
  if (/^(好的|可以|没问题|行[，,])|我来(为|给)|这就(为|给)|为(您|你)(介绍|说明|整理|呈现)|相关情况如下|情况如下|如下所示|下面(由|为)|由我为/.test(t)) return false; // 客服套话不合格
  const toks = t.toUpperCase().match(/[A-Z]{1,3}\d{1,5}[A-Z]{0,2}|\d{1,5}[A-Z]{1,2}/g) || [];
  for (const tk of toks) {
    const num = (tk.match(/\d+/) || [""])[0];
    if (num && !allowNums.has(num)) return false; // 出现没给过的型号数字=脑补
  }
  return true;
}
// 模型不可用/不合格时的确定性自然开场：对象来自本地识别(安全)，按 key 哈希选句保证同问同答
// 开场白纯确定性：对象明确且不能编造（译码芯片无尾缀、部分产品无规格书），
// 按对象类型选自然句、按 key 哈希定句：同问同答、不同对象不重样、零延迟、零编造；模型不写开场白。
function leadIn(kind, name) {
  name = String(name || "").trim();
  if (!name) return "";
  const pools = {
    "chip-driver": [
      name + " 这颗驱动芯片的固件信息如下。",
      name + " 的固件尾缀和智能设置这样对。",
      name + " 驱动芯片，固件按下面这组来。"
    ],
    "chip-decoder": [
      name + " 是行扫译码芯片，本身不刷接收卡固件。",
      name + " 属于配套译码芯片，固件跟着主驱动走。"
    ],
    product: [
      name + " 的关键参数给你列在下面。",
      name + " 这台设备的接口和带载能力如下。",
      name + " 的参数整理好了，重点看这几项。"
    ]
  };
  const pool = pools[kind] || pools.product;
  let h = 0; const k = kind + "|" + name;
  for (let c = 0; c < k.length; c++) h = (h + k.charCodeAt(c)) % 997;
  return pool[h % pool.length];
}

// 售前快查回答：复用快查站的产品检索 + 芯片固件尾缀，组织成企微可读的纯文本（结构化数据一并返回供网页端用）
async function buildPresalesAnswer(message) {
  // 命中法则对标快查站搜索框：干净硬件词（整句无中文现象描述）先用“整串”搜，让完整型号精确命中的产品做主产品
  // （如 R5s Plus→HD-R5S Plus，而不是被拆词误取的 R5S；RB6→HD-RB6）；拆词 token 随后只补充同系列近似型号。
  const cleanHardwareQuery = !/[一-龥]/.test(String(message));
  const entityKeys = [...new Set([
    ...aftersales.extractProducts(message),
    ...(String(message).match(/\b\d{3,5}[A-Z]{0,2}\b/gi) || []),
  ])];
  const products = [];
  const seen = new Set();
  const addResults = (k) => searchProducts(k).forEach((r) => { if (!seen.has(r.name)) { seen.add(r.name); products.push(r); } });
  if (cleanHardwareQuery) addResults(String(message).trim()); // 整串优先：与快查站搜索框结果排序一致
  entityKeys.forEach(addResults);
  // 带现象的中文自然语句不整串搜（上面被 cleanHardwareQuery 门控跳过），只按提取出的型号 token 搜，
  // 避免整句被参数文本弱命中、冒出搜索框本不会给出的产品。
  let chipFirmware = null;
  try { chipFirmware = buildChipFirmware(message); } catch { /* ignore */ }
  if (!chipFirmware || !chipFirmware.hitCount) {
    for (const k of entityKeys) {
      try { const cf = buildChipFirmware(k); if (cf && cf.hitCount) { chipFirmware = cf; break; } } catch { /* ignore */ }
    }
  }
  // 短噪音：原 token 带字母小尾巴(如 6363q)精确查无、剥出的纯数字核能命中芯片固件 → 按核查并标记“推断”；
  // 只对芯片固件剥核(数字核稳定)，不据泛数字推产品(如 410 太泛易误配)。
  let inferredFrom = null;
  if (!products.length && !(chipFirmware && chipFirmware.hitCount)) {
    const rawTokens = [...new Set(entityKeys.concat(cleanHardwareQuery ? [String(message).trim()] : []))];
    for (const tok of rawTokens) {
      const mm = String(tok || "").match(/\d{3,5}/);
      if (!mm) continue;
      const core = mm[0];
      if (core === String(tok).replace(/[^A-Za-z0-9]/g, "")) continue; // 无尾巴=干净裸核，前面已精确查过
      let cf = null; try { cf = buildChipFirmware(core); } catch { cf = null; }
      if (cf && cf.hitCount) { chipFirmware = cf; inferredFrom = { raw: String(tok).trim(), core }; break; }
    }
  }
  if (!products.length && !(chipFirmware && chipFirmware.hitCount)) return null;
  // 主驱动芯片挂上“按接收卡型下载固件”（译码/借用芯片 firmwareFamily 为 null，enrich 自动不挂）
  try { enrichChipFirmware(chipFirmware); } catch { /* ignore */ }

  const L = [];
  // 拟人开场白：只点“主对象”（与正文一致：只平铺主产品/主芯片，其余型号转下方近似按钮），
  // 由大模型写一句陈述开场（按 key 缓存、同问同答）；LLM 不可用或不合格则不出开场、直接进正文，客户无感。
  // 下方参数/固件/规格书正文全部仍是本地确定性数据，一字不交给模型。
  const leadLabels = [];
  if (products[0]) leadLabels.push(`产品 ${String(products[0].name).replace(/^HD-/, "")}`);
  if (chipFirmware && chipFirmware.hitCount) {
    const cn = String(chipFirmware.primary.chip).split(/[\/\n]/).map((s) => s.trim()).filter(Boolean);
    if (cn[0]) leadLabels.push(`芯片 ${cn[0]}`);
  }
  if (leadLabels.length) {
    let kind = "product";
    let leadName = products[0] ? String(products[0].name).replace(/^HD-/, "") : "";
    if (chipFirmware && chipFirmware.hitCount) {
      const ff = (chipFirmware.primary && chipFirmware.primary.facts) || [];
      kind = ff.some((x) => x && x.label === "芯片类型") ? "chip-decoder" : "chip-driver";
      leadName = String((chipFirmware.primary && chipFirmware.primary.chip) || "").split(/[\/\n]/)[0].trim() || leadName;
    }
    const lead = leadIn(kind, leadName);
    if (lead) L.push(lead);
  }
  // 正文只平铺权重最高的 1 个产品，避免一次堆一大团；其余型号转成下方“近似型号”可点按钮
  const mainProduct = products[0] || null;
  if (mainProduct) {
    L.push(`\n【${mainProduct.name}】`);
    // 参数与快查站卡片完全同源（features）：类型/系列/带载/分辨率/输入接口/输出接口，最后一行才是产品特点；
    // 不再用残缺重复的 keyParams（那套会把音频当接口、丢掉视频输入、还混入 U盘播放分辨率）。
    const f = mainProduct.features || {};
    if (f.series) L.push(`· 类型：${f.series}`);
    if (f.color) L.push(`· 系列：${f.color}`);
    if (f.load) L.push(`· 带载：${f.load}`);
    if (f.resolution) L.push(`· 分辨率：${f.resolution}`);
    if (f.inputs) L.push(`· 输入接口：${f.inputs}`);
    if (f.outputs) L.push(`· 输出接口：${f.outputs}`);
    const detail = mainProduct.featureDetail || f.highlights || "";
    if (detail) L.push(`· 产品特点：${detail}`); // 小灰机给一段专业介绍，比快查站的短标签更丰满
    if (mainProduct.featureAdv) L.push(`· 亮点：${mainProduct.featureAdv}。`); // 竞品级亮点独立成行、标签左置顶
    const files = mainProduct.specFiles || [];
    if (files.length) L.push(`· 规格书：${files.slice(0, 2).join("、")}`); // 网页端按纯文件名渲染可点链接，企微端在展示层替换为 markdown 链接
  }
  if (chipFirmware && chipFirmware.hitCount) {
    L.push(`\n【${chipFirmware.primary.chip} 芯片固件】`);
    // facts 内部保留换行（异步卡尾缀多组各占一行），不再压成一行
    (chipFirmware.primary.facts || []).forEach((x) => L.push(`· ${x.label}：${x.text}`));
  }
  // 故障引导句单独成字段：网页放气泡框外，企微等纯文本通道再拼回 reply 末尾
  const presalesHint = ""; // 售前参数答案不再机械追加售后尾巴（已给答案还挂故障提示，体验差）
  // 近似型号：主产品之外的命中型号 + 同系列型号，去重并排除主产品后封顶 10 个，供前端渲染成可点按钮
  const related = [];
  const relSeen = new Set();
  const pushRel = (label, q) => { if (!label || relSeen.has(label)) return; relSeen.add(label); related.push({ label, q: q || label }); };
  products.slice(1).forEach((p) => pushRel(p.name, p.name));
  (products.length ? buildRelatedChips(products, entityKeys[0] || message) : []).forEach((c) => pushRel(c.label, c.q));
  const relatedModels = related.filter((c) => c.label !== (mainProduct && mainProduct.name)).slice(0, 10);
  // 中文语气/符号小尾巴(如 6363阿)：芯片已命中但原串不是规范裸丝印写法，同样声明推断
  if (!inferredFrom && chipFirmware && chipFirmware.hitCount) {
    const core = (String((chipFirmware.primary && chipFirmware.primary.chip) || "").match(/\d{3,5}/) || [])[0];
    const rawTrim = String(message).trim().replace(/\[[A-Z_]+(?::[^\]]*)?\]/g, "").replace(/\s+/g, "");
    if (core && rawTrim && rawTrim.includes(core)) {
      // 形态像规范裸丝印(前缀+数字核+0~2字母尾)且纯字母数字时，只有完整 token 真在芯片/产品库才算合法；
      // 完整 token 查无、纯数字核却命中(如 6363q)，或夹了中文/符号尾巴(如 6363阿)，都按噪声推断并声明。
      const cleanCanon = new RegExp("^(?:[A-Z]{0,4})?" + core + "[A-Z]{0,2}$", "i").test(rawTrim);
      const legal = cleanCanon && /^[A-Za-z0-9]+$/.test(rawTrim)
        && (aftersales.extractChips(rawTrim).length > 0 || searchProducts(rawTrim).length > 0);
      if (!legal) inferredFrom = { raw: String(message).trim(), core };
    }
  }
  if (inferredFrom) L.unshift(`你发的“${String(inferredFrom.raw).slice(0, 16)}”我按 ${inferredFrom.core} 来查了，若不是这个型号/丝印，请补充完整写法。`);
  return { reply: L.join("\n"), hint: presalesHint, products: mainProduct ? [mainProduct] : [], chipFirmware, related: relatedModels };
}

// POST /api/ai/chat — 核心接口（契约见 docs/api-contract.md）
async function handleAiChat(req, res) {
  const body = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }
  const message = String(payload.message || "").trim();
  if (!message) {
    sendJson(res, 400, { error: "empty_message" });
    return;
  }

  const history = Array.isArray(payload.history) ? payload.history : [];
  req._qa = { message, source: String(payload.source || ""), sid: String(payload.sessionId || ""), images: sanitizeImageIds(payload.images), t0: Date.now() };

  // 首道路由：配单 / 售前快查 先行分流；售后与模糊求助继续走下面的售后专精通道
  const { intent: route, detail: routeDetail } = await resolveRoute(message, history);
  if (routeDetail && routeDetail.boundary && routeDetail.boundary.escalate) {
    const bk = routeDetail.boundary.kind;
    sendAiJson(res, { status: "answer", reply: routerNlu.buildBoundaryReply(bk), needClarify: false, model: "boundary-" + bk, meta: { route: routerNlu.BOUNDARY_INTENT[bk] || "presales", escalate: bk } });
    return;
  }
  if (route === "ordering") {
    const orderingResult = await ordering.handleOrdering(message, history);
    // 可导入 HDSet 的连屏文件：specialist 仅对真机验证过的口数在 ordering.ssm 给 ssmXml，这里落盘换成下载地址（大 XML 不回传客户端）
    try {
      const od = orderingResult.ordering;
      if (od && od.ssm && od.ssm.ssmXml) {
        if (String(payload.source || "") === "wecom") {
          od.ssm = null; // 企微纯文本通道不提供文件下载，也不回传大 XML、不落盘
        } else {
          const ssmId = saveOrderingSsm(od.ssm.ssmXml);
          od.ssm = ssmId
            ? { available: true, url: `/api/ordering/ssm?f=${encodeURIComponent(ssmId)}`, fileName: od.ssm.fileName, ports: od.ssm.ports, cardCount: od.ssm.cardCount }
            : null;
        }
      }
    } catch (eSsm) { console.error("[ssm attach]", eSsm.message); if (orderingResult.ordering) orderingResult.ordering.ssm = null; }
    // 保留 specialist 自带 meta，并补 route 与网页复现用 q（不能整体 Object.assign，否则 meta 被覆盖丢 q）
    const orderingMeta = Object.assign({ route: "ordering" }, orderingResult.meta || {}, { q: replayQuery(message, history) });
    sendAiJson(res, Object.assign({}, orderingResult, { meta: orderingMeta }));
    return;
  }
  if (route === "software") {
    // 未点名具体软件、但明确要操作/教学视频（如“复位视频/怎么投屏/恢复出厂怎么操作”）→ 跨软件按操作主题给视频
    let swMatched = [];
    try { swMatched = matchSoftware(message); } catch { swMatched = []; }
    if (!swMatched.length && videoCatalog.isVideoAcquire(message)) {
      let va = null;
      try { va = videoCatalog.buildVideoAnswer(message, { source: payload.source || "" }); } catch (err) { console.error("[video error]", err.message); }
      if (va) {
        sendAiJson(res, {
          status: "answer",
          reply: va.reply,
          needClarify: false,
          model: "local-software",
          video: { items: va.items },
          meta: { route: "software", kind: "video", count: va.items.length }
        });
        return;
      }
    }
    let sw = null;
    try { sw = buildSoftwareAnswer(message); } catch (err) { console.error("[software error]", err.message); }
    if (sw) {
      // reply 已是 markdown 链接（企微可点）；software.items 为结构化数据，网页端渲染下载卡片
      sendAiJson(res, {
        status: "answer",
        reply: sw.reply,
        needClarify: false,
        model: "local-software",
        software: { items: sw.items, isList: sw.isList },
        meta: { route: "software", count: sw.items.length }
      });
      return;
    }
  }
  if (route === "presales") {
    let pre = null;
    try { pre = await buildPresalesAnswer(message); } catch (err) { console.error("[presales error]", err.message); }
    if (pre) {
      let replyText = pre.reply;
      let outsideHint = "";
      if (payload.source === "quick-site") {
        // 网页：答案正文 + 相近芯片椭圆都在气泡框内，故障引导句交给前端放到框外
        outsideHint = pre.hint || "";
      } else {
        // 企微等纯文本通道：主产品规格书文件名 → 可点 markdown 链接（外网直开 PDF）；网页通道仍用纯文件名由前端渲染
        const wecomMain = (pre.products && pre.products[0]) || null;
        if (wecomMain) replyText = linkSpecLine(replyText, wecomMain.specPairs);
        replyText = injectFirmwareLine(replyText, wecomMain); // 产品卡「固件」标签在企微降级为一行可点链接（搜芯片的 chipFirmware 不受影响）
        const chipFwLine = wecomChipFwLine(pre.chipFirmware); // 搜芯片：主驱动系列固件引导回卡型号取下载，不堆链接
        if (chipFwLine) replyText += `\n${chipFwLine}`;
        // 相近芯片/近似型号不在正文平铺罗列：统一交给 attachWeCom 生成“回复数字选型 / 发完整型号”的带序号选项行
        if (pre.hint) replyText += `\n${pre.hint}`;
      }      sendAiJson(res, {
        status: "answer", reply: replyText, hint: outsideHint, needClarify: false, model: "local-presales",
        presales: { products: pre.products, chipFirmware: pre.chipFirmware, related: pre.related },
        meta: { route: "presales" },
      });
      return;
    }
    // 已识别为售前、但话里没有可直接查的型号/芯片（如“有没有支持4K的处理器”“带WiFi的发送卡”）：
    // 给售前专属引导（可发型号直查、也可给需求帮筛），不再掉进与“完全听不懂”相同的通用兜底
    sendAiJson(res, {
      status: "answer",
      reply: "你想了解的是产品选型或参数，两种方式都可以：\n① 直接发型号或芯片丝印（如 VP2060、6363），我给参数、接口、带载、规格书和固件信息；\n② 告诉我需求我帮你筛——整屏宽高或点间距、几路 HDMI、是否 4K、要不要 WiFi、网口数量、同步还是异步。\n发其中一项就行。",
      needClarify: false,
      model: "boundary-presales-need-model",
      meta: { route: "presales", reason: "no-entity" }
    });
    return;
  }

  // 超长编号/乱码：明确请客户重发清晰型号/丝印，不硬猜、不进售后误匹配
  if (route === "unknown" && noisyUnrecognized(message)) {
    sendAiJson(res, { status: "answer", reply: UNRECOGNIZED_REPLY, needClarify: false, model: "boundary-unrecognized", meta: { route: "unrecognized" } });
    return;
  }

  if (route === "aftersales") {
  // 售后专精通道：当前启用「显示效果」「连接联网」两个问题域（仅售后路由进入，不再抢占其他意图）
  let spResult;
  try {
    spResult = aftersales.handle(message, history);
  } catch (err) {
    console.error("[specialist error]", err);
    spResult = null;
  }

  if (spResult && spResult.matched) {
    if (spResult.needClarify) {
      // 信息不足：反问
      const cl = parseClarify(spResult.reply);
      sendAiJson(res, {
        status: "clarify",
        clarifyQuestion: cl.clarifyQuestion,
        // 分流提问（如接收卡测试后问异步/同步）用后端给的 {label,value}，其余用默认型号快捷词
        quickOptions: spResult.options || cl.quickOptions,
        needClarify: true,
        model: "local-aftersales",
        meta: { specialist: "aftersales", domain: spResult.meta?.domain || "", stage: spResult.meta?.stage || "clarify", sourceGrade: "C", confidence: "中" }
      });
    } else {
      // 直接回答：纯文本 → 结构化 pyramid
      const pyramid = parsePyramidText(spResult.reply);
      sendAiJson(res, {
        status: "answer",
        pyramid,
        bestId: spResult.bestId || "",
        candidates: spResult.candidates || [],
        followUp: spResult.followUp || null,
        needClarify: false,
        model: "local-aftersales",
        sources: spResult.sources || [],
        meta: { specialist: "aftersales", domain: spResult.meta?.domain || "", stage: spResult.meta?.stage || "answer", categories: spResult.meta?.categories || [], products: spResult.meta?.products || [], chips: spResult.meta?.chips || [], hitCount: spResult.meta?.hitCount || 0, sourceGrade: "A", confidence: "高" }
      });
    }
    return;
  }

          // 售后路由但专精未匹配到案例（无芯片/无已知域）：给售后补料反问，引导客户发芯片型号+现象
            sendAiJson(res, {
              status: "clarify",
              reply: "方便把【设备背面完整型号】和接收卡上的【芯片丝印】发我吗？再一句话说下现场现象（比如黑屏、花屏、连不上、颜色异常），我按对应芯片给你最高频的解决案例。",
              clarifyQuestion: "请提供设备型号或芯片丝印，并描述现场现象",
              quickOptions: [
                { label: "我发芯片型号", value: "芯片丝印在接收卡上，常见如 FM6363、ICN2065、SM16380" },
                { label: "我描述现象", value: "现象是" }
              ],
              needClarify: true,
              model: "local-aftersales",
              meta: { specialist: "aftersales", domain: spResult && spResult.meta ? spResult.meta.domain : "", stage: "clarify", sourceGrade: "C", confidence: "低", route: "aftersales-noentity" }
            });
            return;
  }
  // 其余真无法归类：给确定性引导（大模型不碰最终答案）
          const isGreeting = /^\s*(你好|您好|嗨|哈喽|hi|hello|在吗|在不在|早上好|上午好|中午好|下午好|晚上好)\s*[!！。.，,~～?？]*$/i.test(message);
          sendAiJson(res, {
            status: "answer",
            reply: isGreeting
              ? "你好，我是灰度科技的小灰机，可以这样找我：① 发设备型号或芯片丝印（如 R708、6363），查参数、规格书和固件；② 直接发整屏尺寸和点间距（如 1920×1080 P3 同步），我给配单、接收卡数量和网线拓扑；③ 描述现场故障现象加型号（如 C16L 花屏一直闪），我给已解决的售后案例。"
              : "这个问题我没完全看懂。你可以直接发【设备型号或芯片丝印】，我给你参数和固件；也可以描述【现场现象+型号】，我给你对应的售后解决案例。",
            needClarify: false,
            model: "boundary-placeholder",
            meta: { route: "unknown" }
          });
}

// POST /api/ocr — 图片文字识别：只做「截图→纯文本」，识别文字回灌前端正常问答链路（OCR 不做任何判断/查库）
async function handleOcr(req, res) {
  const body = await readBody(req);
  let payload;
  try { payload = JSON.parse(body || "{}"); } catch { sendJson(res, 400, { ok: false, code: "invalid_json", message: "请求格式错误" }); return; }
  const dataUrl = String(payload.image || "");
  let buf = null;
  const dm = dataUrl.match(/^data:[^;,]*(;base64)?,(.*)$/s);
  if (dm && dm[1]) { try { buf = Buffer.from(dm[2], "base64"); } catch { buf = null; } }
  else if (payload.imageBase64) { try { buf = Buffer.from(String(payload.imageBase64), "base64"); } catch { buf = null; } }
  if (!buf || buf.length === 0) { sendJson(res, 400, { ok: false, code: "bad_image", message: "没有收到可用图片" }); return; }
  if (buf.length > 10 * 1024 * 1024) { sendJson(res, 413, { ok: false, code: "image_too_large", message: "图片超过 10MB 上限" }); return; }
  const r = await ocr.recognize(buf, { type: payload.type ? String(payload.type) : undefined });
  if (!r.ok) { sendJson(res, 200, { ok: false, code: r.code, message: friendlyOcr(r) }); return; }
  const imageId = saveQaImage(buf);
  sendJson(res, 200, { ok: true, text: r.text, imageId });
}
// OCR 失败码 → 给客户看的中文提示（不暴露内部细节；服务端只回友好话术）
function friendlyOcr(r) {
  if (r.code === "no_text") return "没从图片里认出文字，可能是图片不够清晰；可以直接把文字打给我";
  if (r.code === "timeout" || r.code === "network") return "图片识别服务暂时连不上，可以直接把文字打给我";
  if (r.code === "image_too_large") return "图片太大（上限 10MB），可以发张更清晰的小图或直接打字";
  if (r.code === "noPermission" || r.code === "Forbidden" || r.code === "NoPermission") return "图片识别服务未授权，请联系管理员开通 OCR";
  if (r.code === "ServiceNotOpened" || r.code === "ocrServiceNotOpen" || /not\s*activated|has\s*not\s*been\s*opened|not\s*open|未开通/i.test(r.message || "")) return "图片识别服务还没开通，请联系管理员在阿里云开通「文字识别 OCR」（通用文字识别，开通免费）";
  if (r.code === "InvalidAccessKeyId" || r.code === "SignatureDoesNotMatch" || r.code === "Unauthorized") return "图片识别服务鉴权失败，请联系管理员检查 OCR 密钥";
  return "图片识别失败，可以直接把文字打给我";
}
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url.split("?")[0] === "/api/huidu/log") {
    handleHuiduLog(req, res).catch((err) => { console.error("[huidu-log error]", err); sendJson(res, 500, { ok: false, message: "服务器内部错误" }); });
    return;
  }
  if (req.method === "POST" && req.url === "/api/ai/chat") {
    const _realEnd = res.end.bind(res);
    res.end = (chunk, enc, cb) => {
      try {
        if (req._qa && typeof chunk === "string") {
          let _d = null; try { _d = JSON.parse(chunk); } catch {}
          if (_d) appendQaRecord(req._qa, _d, Date.now() - req._qa.t0);
        }
      } catch (e) { console.error("[qa-log wrap]", e.message); }
      return _realEnd(chunk, enc, cb);
    };
    handleAiChat(req, res).catch((err) => {
      console.error("[ai-chat error]", err);
      sendJson(res, 500, { error: "internal_error" });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/api/ocr") {
    handleOcr(req, res).catch((err) => {
      console.error("[ocr error]", err);
      sendJson(res, 200, { ok: false, code: "internal_error", message: "识别服务异常" });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/api/ordering/topo") {
    (async () => {
      let payload = {};
      try { payload = JSON.parse((await readBody(req)) || "{}"); }
      catch { sendJson(res, 400, { ok: false, message: "请求格式错误" }); return; }
      const msg = String(payload.message || "").trim();
      if (!msg) { sendJson(res, 400, { ok: false, message: "请输入配单需求" }); return; }
      try {
        const r0 = orderEng.answerWithContext ? orderEng.answerWithContext([msg]) : orderEng.calculate(msg);
        const result = (r0 && r0.result) ? r0.result : r0;
        const svg = renderOrderTopo(result);
        if (!svg) {
          sendJson(res, 200, { ok: false, code: "need_more",
            message: (result && result.confirmationQuestion) ? result.confirmationQuestion
              : "信息不足或超出自动配单范围。请补充：点间距(P几)、宽×高（模组张数或米数）、室内/户外、同步/异步；异形折角/超大屏/友商设备请联系人工。" });
          return;
        }
        const summary = {
          preset: result.preset && (result.preset.name || result.preset.label),
          screenW: result.screenW, screenH: result.screenH, totalPx: result.totalPx,
          cols: result.cols, rows: result.rows,
          card: result.card && result.card.name, receiverQuantity: result.receiverQuantity,
          physicalPortCount: result.physicalPortCount,
          processor: result.processor && result.processor.name,
          syncProcessor: result.syncProcessor && result.syncProcessor.name,
          asyncProcessor: result.asyncProcessor && result.asyncProcessor.name,
          state: result.resultState,
          assumptions: result.assumptions || [], riskFlags: result.riskFlags || []
        };
        sendJson(res, 200, { ok: true, svg, summary });
      } catch (err) {
        console.error("[ordering-topo error]", err);
        sendJson(res, 500, { ok: false, message: "配单解析异常，请换个说法或联系人工。" });
      }
    })();
    return;
  }
  {
    const _huiduPath = req.url.split("?")[0];
    if (req.method === "GET" && (_huiduPath === "/api/huidu/logs" || _huiduPath === "/api/huidu/log")) {
      handleHuiduLogs(req, res, _huiduPath);
      return;
    }
  }
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, service: "xiaohuiji", time: new Date().toISOString(), pid: process.pid, started_at: startedAt, release });
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/api/ordering/ssm")) {
    const su = new URL(req.url, "http://localhost");
    const sf = su.searchParams.get("f") || "";
    const SSM_ID_RE = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\.ssm$/;
    if (!SSM_ID_RE.test(sf)) { sendJson(res, 404, { ok: false, message: "连屏文件不存在或已过期" }); return; }
    const sfp = path.join(SSM_CACHE_DIR, sf);
    if (!sfp.startsWith(SSM_CACHE_DIR) || !fs.existsSync(sfp)) { sendJson(res, 404, { ok: false, message: "连屏文件不存在或已过期" }); return; }
    const dlName = su.searchParams.get("name") || "HDSet连屏.ssm";
    res.writeHead(200, {
      "Content-Type": "application/octet-stream; charset=utf-8",
      "Content-Disposition": `attachment; filename="HDSet-screen.ssm"; filename*=UTF-8''${encodeURIComponent(dlName)}`,
      "Cache-Control": "private, no-store"
    });
    fs.createReadStream(sfp).pipe(res);
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/api/search")) {
    const url = new URL(req.url, "http://localhost");
    const q = url.searchParams.get("q") || "";
    const products = searchProducts(q);
    const relatedChips = buildRelatedChips(products, q);
    // 芯片固件速查：输芯片数字/全名/系列名时反查灰度自家卡型固件尾缀（与产品结果共存，互不影响）
    let chipFirmware = null;
    try {
      chipFirmware = enrichChipFirmware(buildChipFirmware(q));
    } catch (err) {
      console.error("芯片固件速查失败：", err.message);
    }
    sendJson(res, 200, {
      query: q,
      count: products.length,
      productCount: products.length,
      relatedChips,
      chipFirmware,
      results: products
    });
    return;
  }
  // Quick-site "Software" category: software is model-independent.
  // empty q -> full software list; concrete q matching a product -> that card; no match -> null.
  if (req.method === "GET" && req.url.startsWith("/api/software")) {
    const surl = new URL(req.url, "http://localhost");
    const sq = (surl.searchParams.get("q") || "").trim();
    let swData = null;
    try {
      if (!sq) {
        const all = buildSoftwareAnswer("");
        swData = { items: all.items || [], isList: true };
      } else if (matchSoftware(sq).length) {
        const one = buildSoftwareAnswer(sq);
        swData = { items: one.items || [], isList: false };
      }
    } catch (err) { console.error("[software category error]", err.message); }
    sendJson(res, 200, { query: sq, software: swData });
    return;
  }
  // Quick-site "视频" 分类：操作/教学视频按操作主题组织，与型号无关。
  // 空 q=全主题分组浏览；有 q=按复位/WiFi/U盘/拼接/节目等关键词跨软件检索。
  if (req.method === "GET" && req.url.startsWith("/api/videos")) {
    const vurl = new URL(req.url, "http://localhost");
    const vq = (vurl.searchParams.get("q") || "").trim();
    let vData = null;
    try { vData = videoCatalog.buildVideoCategory(vq); } catch (err) { console.error("[video category error]", err.message); }
    sendJson(res, 200, { query: vq, video: vData });
    return;
  }
  // Quick-site 规格书/说明书/固件 分类：空词全量分组浏览（有型号词仍走 /api/search 产品卡，保留参数+全资料强相关体验）
  if (req.method === "GET" && req.url.startsWith("/api/docs")) {
    const durl = new URL(req.url, "http://localhost");
    const dcat = (durl.searchParams.get("cat") || "").trim();
    if (!["spec", "manual", "firmware"].includes(dcat)) { sendJson(res, 400, { error: "bad cat" }); return; }
    let docs = null;
    try { docs = buildDocsCategory(dcat); } catch (err) { console.error("[docs category error]", err.message); }
    sendJson(res, 200, { query: "", cat: dcat, docs });
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405); res.end("Method Not Allowed");
});

// 仅在直接运行时监听端口；被离线测试脚本 require 时不启动 HTTP，只导出路由函数
if (require.main === module) {
  // 默认监听 0.0.0.0，局域网同事可用 http://<本机IPv4>:PORT 访问；如需仅本机可设 HOST=127.0.0.1
  const HOST = process.env.HOST || "0.0.0.0";
  server.listen(PORT, HOST, () => {
    console.log(`小灰机已启动: http://127.0.0.1:${PORT}/ (监听 ${HOST})`);
    console.log(`健康检查: http://127.0.0.1:${PORT}/api/health`);
  });
}

// 离线意图回归 / 双跑测试用导出（仅被 require 时生效，不影响线上行为）
if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveRoute, routeIntent, hardRouteSignal, routeIntentFallback, contextFollowup, buildDocsCategory, extractSpecFiles, firmwareGroupFor, detectHardBoundary: (m, o) => routerNlu.detectHardBoundary(m, o), normalizeRoute: (raw, m, o) => routerNlu.normalizeRoute(raw, m, o) };
}
