/* 小灰机 · 问答检测后台  [admin-state-backend-20260921]
 * 数据源：../data/qa-log/YYYY-MM-DD.jsonl（网页 quick-site + 企微 wecom 统一采集，只读）
 * 可写偏好：../data/admin-state.json（会话备注名、测试收纳组），换电脑/清浏览器不丢；不改动任何原始问答。
 * 安全：默认绑定 0.0.0.0，供同一局域网访问（无口令）；设 ADMIN_HOST=127.0.0.1 可仅本机。花生壳只映射 3789，公网无法访问本后台。
 * 零第三方依赖，纯 Node 内置模块。设 ADMIN_NO_OPEN=1 启动时不自动开浏览器。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const release = require("../backend/release-info.cjs");
const startedAt = new Date().toISOString();

const PORT = Number(process.env.ADMIN_PORT || 3791);
// 默认监听全部网卡，供同一局域网同事访问；如需仅本机，设环境变量 ADMIN_HOST=127.0.0.1
const HOST = process.env.ADMIN_HOST || "0.0.0.0";
const DATA_DIR = path.join(__dirname, "..", "data");
const LOG_DIR = path.join(DATA_DIR, "qa-log");
const HTML_FILE = path.join(__dirname, "admin.html");
const STATE_FILE = path.join(DATA_DIR, "admin-state.json");
// NLU 人工标注语料（对/错/该转人工），append-only jsonl：改标则追加新行、读取时同 key 以后写为准。入库随 git 走、换机不丢。
const LABELS_FILE = path.join(DATA_DIR, "nlu-labels.jsonl");
const LABEL_VALUES = ["correct", "wrong", "escalate"];
const QA_IMG_DIR = path.join(DATA_DIR, "qa-images");
const IMG_ID_RE = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{6,40}\.(png|jpe?g|gif|webp)$/i;
const QA_TOPO_DIR = path.join(DATA_DIR, "qa-topo");
const TOPO_ID_RE = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9-]{6,40}\.svg$/i;
const MAX_BODY = 128 * 1024;

function readAllRecords() {
  let files = [];
  try { files = fs.readdirSync(LOG_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); }
  catch { return []; }
  const out = [];
  for (const f of files) {
    const date = f.replace(/\.jsonl$/, "");
    let lines = [];
    try { lines = fs.readFileSync(path.join(LOG_DIR, f), "utf8").split(/\r?\n/); } catch { continue; }
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try { const o = JSON.parse(t); o.date = date; out.push(o); } catch { /* 跳过坏行 */ }
    }
  }
  return out;
}

function defaultState() { return { notes: {}, testSids: [], updatedAt: "" }; }
function readState() {
  try {
    const o = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      notes: (o && typeof o.notes === "object" && o.notes) || {},
      testSids: (o && Array.isArray(o.testSids)) ? o.testSids : [],
      updatedAt: (o && o.updatedAt) || "",
    };
  } catch { return defaultState(); }
}
function writeState(st) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  st.updatedAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2), "utf8");
  fs.renameSync(tmp, STATE_FILE);
  return true;
}
const validSid = s => typeof s === "string" && s.length >= 1 && s.length <= 200;
const validName = s => typeof s === "string" && s.length <= 100;
const validLabelKey = s => typeof s === "string" && s.length >= 1 && s.length <= 160;
const validLabel = s => LABEL_VALUES.indexOf(s) >= 0;
const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
function readLabels() {
  const map = {};
  let lines = [];
  try { lines = fs.readFileSync(LABELS_FILE, "utf8").split(/\r?\n/); } catch { return map; }
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { const o = JSON.parse(t); if (o && o.key) map[o.key] = o; } catch { /* 跳过坏行 */ }
  }
  return map;
}
function appendLabel(rec) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  fs.appendFileSync(LABELS_FILE, JSON.stringify(rec) + "\n", "utf8");
  return true;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", c => {
      n += c.length;
      if (n > MAX_BODY) { reject(new Error("payload too large")); try { req.destroy(); } catch {} return; }
      chunks.push(c);
    });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

function send(res, code, type, body) {
  res.writeHead(code, {
    "Content-Type": type + "; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, "application/json", JSON.stringify(obj));

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://" + HOST + ":" + PORT);
  const p = u.pathname;
  if (req.method === "OPTIONS") return send(res, 204, "text/plain", "");
  if (p === "/" || p === "/index.html") {
    fs.readFile(HTML_FILE, (err, buf) => {
      if (err) return send(res, 500, "text/plain", "admin.html 缺失: " + err.message);
      send(res, 200, "text/html", buf);
    });
    return;
  }
  if (p === "/api/logs" && req.method === "GET") {
    const records = readAllRecords();
    return json(res, 200, { ok: true, count: records.length, records });
  }
  if (p === "/api/state" && req.method === "GET") {
    return json(res, 200, Object.assign({ ok: true }, readState()));
  }
  if (p === "/api/qa-image" && req.method === "GET") {
    const f = u.searchParams.get("f") || "";
    if (!IMG_ID_RE.test(f)) return send(res, 400, "text/plain", "bad image");
    const root = path.normalize(QA_IMG_DIR);
    const fp = path.normalize(path.join(QA_IMG_DIR, f));
    if (fp.indexOf(root + path.sep) !== 0) return send(res, 400, "text/plain", "bad path");
    fs.readFile(fp, (err, buf) => {
      if (err) return send(res, 404, "text/plain", "not found");
      const ext = path.extname(fp).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "private, max-age=3600", "Access-Control-Allow-Origin": "*" });
      res.end(buf);
    });
    return;
  }
  if (p === "/api/qa-topo" && req.method === "GET") {
    const f = u.searchParams.get("f") || "";
    if (!TOPO_ID_RE.test(f)) return send(res, 400, "text/plain", "bad topo");
    const root = path.normalize(QA_TOPO_DIR);
    const fp = path.normalize(path.join(QA_TOPO_DIR, f));
    if (fp.indexOf(root + path.sep) !== 0) return send(res, 400, "text/plain", "bad path");
    fs.readFile(fp, (err, buf) => {
      if (err) return send(res, 404, "text/plain", "not found");
      res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, max-age=3600", "Access-Control-Allow-Origin": "*" });
      res.end(buf);
    });
    return;
  }
  if (p === "/api/note" && req.method === "POST") {
    readBody(req).then(b => {
      if (!validSid(b.sid) || !validName(b.name)) return json(res, 400, { ok: false, error: "bad params" });
      const st = readState();
      const name = b.name.trim();
      if (name) st.notes[b.sid] = name; else delete st.notes[b.sid];
      writeState(st);
      return json(res, 200, { ok: true, notes: st.notes });
    }).catch(e => json(res, 400, { ok: false, error: e.message }));
    return;
  }
  if (p === "/api/test-sids" && req.method === "POST") {
    readBody(req).then(b => {
      if (!Array.isArray(b.sids) || b.sids.length > 500 || !b.sids.every(validSid)) return json(res, 400, { ok: false, error: "bad params" });
      const st = readState();
      st.testSids = Array.from(new Set(b.sids));
      writeState(st);
      return json(res, 200, { ok: true, testSids: st.testSids });
    }).catch(e => json(res, 400, { ok: false, error: e.message }));
    return;
  }
  if (p === "/api/nlu-labels" && req.method === "GET") {
    return json(res, 200, { ok: true, labels: readLabels() });
  }
  if (p === "/api/nlu-label" && req.method === "POST") {
    readBody(req).then(b => {
      if (!validLabelKey(b.key) || !validLabel(b.label) || !validSid(b.sid)) {
        return json(res, 400, { ok: false, error: "bad params" });
      }
      const rec = {
        key: b.key,
        ts: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "),
        sid: b.sid,
        source: clip(b.source, 40),
        qts: clip(b.qts, 40),
        q: clip(b.q, 3000),
        route: clip(b.route, 40),
        model: clip(b.model, 80),
        status: clip(b.status, 20),
        escalate: clip(b.escalate, 300),
        label: b.label,
        note: clip(b.note, 500),
      };
      appendLabel(rec);
      return json(res, 200, { ok: true, labels: readLabels() });
    }).catch(e => json(res, 400, { ok: false, error: e.message }));
    return;
  }
  if (p === "/api/health" && req.method === "GET") {
    return json(res, 200, { ok: true, host: HOST, port: PORT, pid: process.pid, started_at: startedAt, release });
  }
  send(res, 404, "text/plain", "Not Found");
});

server.listen(PORT, HOST, () => {
  const recs = readAllRecords();
  const fileN = fs.existsSync(LOG_DIR) ? fs.readdirSync(LOG_DIR).filter(f => /\.jsonl$/.test(f)).length : 0;
  const lans = [];
  const nets = os.networkInterfaces();
  for (const k of Object.keys(nets)) for (const n of nets[k]) if (n && n.family === "IPv4" && !n.internal) lans.push(n.address);
  console.log("[admin] 小灰机问答检测后台已启动（qa-log 只读；备注/测试收纳写入 admin-state.json）");
  console.log("[admin] 本机   : http://127.0.0.1:" + PORT + "/");
  lans.forEach(ip => console.log("[admin] 局域网 : http://" + ip + ":" + PORT + "/  （同一内网即可打开）"));
  console.log("[admin] 数据源 : " + LOG_DIR);
  console.log("[admin] 偏好存 : " + STATE_FILE);
  console.log("[admin] 自检   : " + fileN + " 个日志文件，" + recs.length + " 条问答记录" + (recs.length === 0 ? "（暂无记录，网页/企微产生新对话后出现，属正常）" : ""));
  console.log("[admin] 绑定   : " + HOST + (HOST === "0.0.0.0" ? "（同局域网可访问、无口令；ADMIN_HOST=127.0.0.1 可改为仅本机）" : "（仅本机）"));
  if (!process.env.ADMIN_NO_OPEN && process.platform === "win32") {
    try { cp.exec('cmd /c start "" "http://127.0.0.1:' + PORT + '/"'); } catch (e) {}
  }
});
