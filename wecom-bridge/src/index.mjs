// 入口：装配企业微信文本事件 → 编排层；起本地 /health 供看门狗判断存活。
// 企业微信通道只用文本序号，不监听/不下发按钮卡片。
import http from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
const release = createRequire(import.meta.url)("../../backend/release-info.cjs");
import { cfg } from "./config.mjs";
import { SessionStore } from "./session.mjs";
import { createBot, sendMarkdown } from "./wecom.mjs";
import { makeResponder } from "./responder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
await mkdir(dataDir, { recursive: true });
const recordsPath = path.join(dataDir, "records.jsonl");
const startedAt = Date.now();

const store = new SessionStore({
  historyMax: cfg.historyMax,
  historyWindowMs: cfg.historyWindowMs,
  optionTtlMs: cfg.optionTtlMs,
});
const { client, state } = createBot(cfg);

async function record(obj) {
  await appendFile(recordsPath, JSON.stringify({ time: new Date().toISOString(), ...obj }) + "\n").catch(() => {});
}
const { handleText, handleImage, handleMixed } = makeResponder({ cfg, client, store, record });

// 单聊按人、群聊按群区分会话；回复目标：单聊发给本人，群聊发回群
const bodyOf = (frame) => frame?.body || {};
function chatKeyOf(body) {
  return body.chattype === "single" ? `u:${body.from?.userid || ""}` : `g:${body.chatid || body.from?.userid || ""}`;
}
function targetOf(body) {
  return body.chattype === "single"
    ? String(body.from?.userid || "")
    : String(body.chatid || body.from?.userid || "");
}

// 文本消息：唯一主通道
client.on("message.text", async (frame) => {
  const body = bodyOf(frame);
  const text = body?.text?.content || "";
  try {
    await handleText(chatKeyOf(body), targetOf(body), text);
  } catch (error) {
    console.error("[message.text] 处理失败:", error?.message || error);
  }
});

// 图片 / 图文混排：下载解密 → 核心 OCR 转文字 → 走同一文本问答链路；语音暂不识别，引导打字
const UNSUPPORTED = "请直接用文字把【设备型号】和【现场现象】发我（例如“C16L花屏一直闪”），我来帮你查资料和历史案例。";
client.on("message.image", async (frame) => {
  const body = bodyOf(frame);
  try {
    await handleImage(chatKeyOf(body), targetOf(body), body?.image?.url, body?.image?.aeskey);
  } catch (error) {
    console.error("[message.image] 处理失败:", error?.message || error);
    await sendMarkdown(client, targetOf(body), UNSUPPORTED).catch(() => {});
  }
});
client.on("message.mixed", async (frame) => {
  const body = bodyOf(frame);
  try {
    await handleMixed(chatKeyOf(body), targetOf(body), body?.mixed?.msg_item || []);
  } catch (error) {
    console.error("[message.mixed] 处理失败:", error?.message || error);
    await sendMarkdown(client, targetOf(body), UNSUPPORTED).catch(() => {});
  }
});
client.on("message.voice", async (frame) => {
  const body = bodyOf(frame);
  await sendMarkdown(client, targetOf(body), UNSUPPORTED).catch(() => {});
});

// 本地健康检查（仅本机，看门狗消费）
const healthServer = http.createServer((req, res) => {
  if (String(req.url || "").startsWith("/health")) {
    const payload = {
      service: "xiaohuiji-wecom-bridge",
      ok: true,
      authenticated: state.authenticated,
      connection: { healthy: state.authenticated },
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      pid: process.pid,
      release,
    };
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(cfg.port, "127.0.0.1", () => {
  console.log(`[bridge] health http://127.0.0.1:${cfg.port}/health ; core=${cfg.coreUrl}`);
});

setInterval(() => store.sweep(), 60000).unref();
process.on("uncaughtException", (error) => console.error("[uncaughtException]", error?.message || error));
process.on("unhandledRejection", (error) => console.error("[unhandledRejection]", error?.message || error));

// 所有事件注册完毕后再发起企业微信长连接（官方 SDK 不会自动连接）
client.connect();
console.log("[bridge] connecting to WeCom...");
