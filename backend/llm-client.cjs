// 小灰机 · 大模型统一客户端（OpenAI 兼容 /chat/completions）
// 现在接 DeepSeek，以后切火山方舟 / 本地 vLLM / Ollama 只改 backend/.env，本文件不动。
// 铁律：大模型只做「意图判断 / 一句拟人开场白」两件窄事，不查库、不返回实体当最终结果；
//      任何失败（无 key / 超时 / 非 200 / 坏 JSON）都返回 null、绝不抛错，由调用方回退确定性正则，保证不是单点故障。
const fs = require("fs"), path = require("path");
try {
  // 极简 .env 加载（不引 dotenv 第三方依赖）
  const p = path.join(__dirname, ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch { /* .env 读取失败不影响主链路 */ }

const BASE = (process.env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "deepseek-chat";
const TIMEOUT = Number(process.env.LLM_TIMEOUT_MS) || 4000;

// 统一对话调用：json=true 返回解析后的对象（失败 null）；json=false 返回纯文本（失败 null）
async function chat({ system, user, history = [], json = true, temperature = 0, maxTokens = 400, timeoutMs = 0 }) {
  if (!KEY) return null; // 没配 key 全程零调用、零成本（清掉 key 即纯本地）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || TIMEOUT); // 复杂抽取（如多屏拆分）可单独放宽超时
  try {
    const body = {
      model: MODEL,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, ...history, { role: "user", content: user }],
    };
    if (json) body.response_format = { type: "json_object" }; // 只有要求 JSON 时才加
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) { console.error("[llm] http", res.status); return null; }
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || "").trim();
    if (!text) return null;
    if (!json) return text;
    try { return JSON.parse(text); } catch { return null; }
  } catch (e) {
    console.error("[llm]", e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chat, enabled: () => !!KEY };
