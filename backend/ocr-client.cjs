// 小灰机 · 阿里云文字识别 OCR（OCR 统一识别 RecognizeAllText）零依赖客户端
// 职责边界：只做「图片 → 纯文本」，不做任何意图判断、不查库；识别出的文字交回现有确定性问答链路（一个脑子不变）。
// 红线：任何失败（未配 AK / 未开通服务 / 无权限 / 超时 / 图里无字）都返回 { ok:false }，绝不抛错，
//      调用方据此提示客户改打字，保证 OCR 不是单点故障。
// 凭证：优先 backend/.env 的 OCR_ACCESS_KEY_ID / OCR_ACCESS_KEY_SECRET；未配则复用 scripts/.oss-config.json 同账号 AK。
// 换账号 / 换 endpoint / 换识别类型只改 .env（OCR_ENDPOINT / OCR_TYPE），本文件不动。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// 极简 .env 加载（与 llm-client.cjs 同款，不引 dotenv）
try {
  const p = path.join(__dirname, ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch { /* .env 读取失败不影响主链路 */ }

function loadCreds() {
  let id = process.env.OCR_ACCESS_KEY_ID || "";
  let secret = process.env.OCR_ACCESS_KEY_SECRET || "";
  if (!id || !secret) {
    // 回退：复用 OSS 同账号 AccessKey（账号级，OCR 与 OSS 共用一对 AK；该账号需已开通 OCR 服务 / 有 AliyunOCRFullAccess）
    try {
      const c = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "scripts", ".oss-config.json"), "utf8"));
      id = id || c.AccessKeyId || "";
      secret = secret || c.AccessKeySecret || "";
    } catch { /* 没有配置文件就返回空，由 enabled()/recognize 报 no_credential */ }
  }
  return { id, secret };
}

const ENDPOINT = (process.env.OCR_ENDPOINT || "ocr-api.cn-hangzhou.aliyuncs.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const ACTION = "RecognizeAllText"; // OCR 统一识别：一个接口 + Type 切换场景，吃「200 次/月」免费额度
const VERSION = "2021-07-07";
const DEFAULT_TYPE = process.env.OCR_TYPE || "General"; // General=通用文字识别基础版（印刷体/截图，最便宜）；需要更强可置 Advanced
const TIMEOUT = Number(process.env.OCR_TIMEOUT_MS) || 12000;
const MAX_BYTES = 10 * 1024 * 1024; // OCR 图片二进制上限 10MB

// RFC3986 百分号编码（encodeURIComponent 基础上补 !'()* ，~ 保持不编码）
function pe(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function hmacHex(secret, msg) {
  return crypto.createHmac("sha256", secret).update(msg, "utf8").digest("hex");
}

/**
 * 识别图片文字
 * @param {Buffer} imageBuf 图片二进制（PNG/JPG/JPEG/BMP/WEBP/TIFF/GIF）
 * @param {{type?:string}} [opt] type 默认 General
 * @returns {Promise<{ok:true,text:string,words:string[],requestId?:string} | {ok:false,code:string,message:string,status?:number}>}
 */
async function recognize(imageBuf, opt = {}) {
  const type = opt.type || DEFAULT_TYPE;
  const { id, secret } = loadCreds();
  if (!id || !secret) return { ok: false, code: "no_credential", message: "未配置 OCR AccessKey" };
  if (!Buffer.isBuffer(imageBuf) || imageBuf.length === 0) return { ok: false, code: "empty_image", message: "图片为空" };
  if (imageBuf.length > MAX_BYTES) return { ok: false, code: "image_too_large", message: "图片超过 10MB 上限" };

  const method = "POST";
  const canonicalUri = "/"; // RPC 风格固定 /
  const canonicalQueryString = `Type=${pe(type)}`; // 业务参数走 query；图片二进制整体作为 HTTP body
  const payload = imageBuf;
  const payloadHash = sha256Hex(payload);
  const amzDate = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); // yyyy-MM-ddTHH:mm:ssZ（UTC）
  const nonce = crypto.randomBytes(16).toString("hex");

  // 参与签名的公共请求头（host + 5 个 x-acs-*，与官方示例一致；content-type 不签）
  const headers = {
    host: ENDPOINT,
    "x-acs-action": ACTION,
    "x-acs-version": VERSION,
    "x-acs-date": amzDate,
    "x-acs-signature-nonce": nonce,
    "x-acs-content-sha256": payloadHash,
  };
  const signedNames = Object.keys(headers).sort(); // host、x-acs-action、x-acs-content-sha256、x-acs-date、x-acs-signature-nonce、x-acs-version
  const canonicalHeaders = signedNames.map((k) => `${k}:${String(headers[k]).trim()}`).join("\n") + "\n";
  const signedHeaders = signedNames.join(";");
  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = "ACS3-HMAC-SHA256\n" + sha256Hex(Buffer.from(canonicalRequest, "utf8"));
  const signature = hmacHex(secret, stringToSign);
  headers.Authorization = `ACS3-HMAC-SHA256 Credential=${id},SignedHeaders=${signedHeaders},Signature=${signature}`;
  headers["Content-Type"] = "application/octet-stream";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`https://${ENDPOINT}/?${canonicalQueryString}`, {
      method,
      headers,
      body: payload,
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let j = {};
    try { j = JSON.parse(txt); } catch { j = {}; }
    if (!res.ok || j.Code) {
      return { ok: false, code: j.Code || `http_${res.status}`, message: j.Message || txt.slice(0, 300), status: res.status, requestId: j.RequestId };
    }
    // Data 可能是对象或 JSON 字符串。RecognizeAllText 的文字在
    // Data.SubImages[].BlockInfo.BlockDetails[].BlockContent（按 BlockId 阅读顺序）；
    // 同时兼容老单接口字段 Content / content / prism_wordsInfo。
    let data = {};
    try { data = typeof j.Data === "string" ? JSON.parse(j.Data) : (j.Data || {}); } catch { data = {}; }
    const words = [];
    if (Array.isArray(data.SubImages)) {
      for (const si of data.SubImages) {
        const details = si && si.BlockInfo && Array.isArray(si.BlockInfo.BlockDetails) ? si.BlockInfo.BlockDetails : [];
        for (const b of details) { if (b && b.BlockContent) words.push(String(b.BlockContent)); }
      }
    }
    if (!words.length && Array.isArray(data.prism_wordsInfo)) {
      for (const w of data.prism_wordsInfo) { if (w && w.word) words.push(String(w.word)); }
    }
    const text = String(data.Content || data.content || "").trim() || words.join("\n").trim();
    if (!text) return { ok: false, code: "no_text", message: "图片里没有识别到文字", requestId: j.RequestId };
    return { ok: true, text, words, requestId: j.RequestId };
  } catch (e) {
    return { ok: false, code: e.name === "AbortError" ? "timeout" : "network", message: e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { recognize, enabled: () => { const c = loadCreds(); return !!(c.id && c.secret); } };
