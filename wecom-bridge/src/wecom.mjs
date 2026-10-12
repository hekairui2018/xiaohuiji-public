// 连接层：只负责建立/维护与企业微信智能机器人的长连接，以及最底层的文本下发。
// 不认识任何业务字段，业务装配在 index.mjs。
import AiBot from "@wecom/aibot-node-sdk";

function ts() { return new Date().toISOString(); }

// SDK 要求 logger 是带级别方法的对象；全部静默，关键生命周期由我们自己监听打印
const noopLogger = { debug() {}, log() {}, info() {}, warn() {}, error() {} };

export function createBot({ botId, secret }) {
  const state = { authenticated: false, connectedAt: 0, lastInboundAt: 0 };
  // 无限自动重连/鉴权重试，连接保活由 SDK 负责
  const client = new AiBot.WSClient({
    botId,
    secret,
    maxReconnectAttempts: -1,
    maxAuthFailureAttempts: -1,
    logger: noopLogger,
  });

  client.on("connected", () => { state.connectedAt = Date.now(); console.log(ts(), "[wecom] connected"); });
  client.on("authenticated", () => { state.authenticated = true; console.log(ts(), "[wecom] authenticated OK"); });
  client.on("reconnecting", (attempt) => console.warn(ts(), `[wecom] reconnecting #${attempt}`));
  client.on("disconnected", (reason) => { state.authenticated = false; console.warn(ts(), "[wecom] disconnected:", reason || ""); });
  client.on("error", (error) => console.error(ts(), "[wecom] error:", error?.message || error));
  client.on("message", () => { state.lastInboundAt = Date.now(); });
  client.on("event", () => { state.lastInboundAt = Date.now(); });

  return { client, state };
}

export function sendMarkdown(client, target, content) {
  if (!target || !content) return Promise.resolve(null);
  return client.sendMessage(String(target), { msgtype: "markdown", markdown: { content: String(content) } });
}

// 主动下发一张图片（如配单接收卡拓扑图）：先分片上传临时素材拿 media_id，再走主动推送通道发 image。
// 任一步失败抛错给调用方，由调用方决定是否静默降级（配单场景：图失败不影响文字方案）。
export async function sendImage(client, target, buffer, filename = "topology.png") {
  if (!target || !buffer) return null;
  const uploaded = await client.uploadMedia(buffer, { type: "image", filename });
  const mediaId = uploaded && (uploaded.media_id || uploaded.mediaid);
  if (!mediaId) throw new Error("uploadMedia 未返回 media_id");
  return client.sendMediaMessage(String(target), "image", mediaId);
}
