// 配置层：统一从 .env 读取并做一次启动校验，业务代码不直接碰 process.env
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, "..", ".env") });

function required(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) {
    console.error(`[config] 缺少必填配置 ${name}，请检查 wecom-bridge/.env`);
    process.exit(1);
  }
  return v;
}
function num(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const cfg = {
  botId: required("WECOM_BOT_ID"),
  secret: required("WECOM_BOT_SECRET"),
  coreUrl: String(process.env.CORE_URL || "http://localhost:3789/api/ai/chat").trim(),
  // 核心用 source 区分网页(quick-site)与企微；企微必须不是 quick-site，才会走企微文案/序号分支
  coreSource: String(process.env.CORE_SOURCE || "wecom").trim(),
  port: num("BRIDGE_PORT", 3790),
  coreTimeoutMs: num("CORE_TIMEOUT_MS", 45000),
  historyMax: num("HISTORY_MAX", 10),
  historyWindowMs: num("HISTORY_WINDOW_MIN", 30) * 60 * 1000,
  optionTtlMs: num("OPTION_TTL_MIN", 15) * 60 * 1000,
};
