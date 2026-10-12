// 转发层：把一条文本 + 最近历史 POST 给本地核心 3789，拿回统一结果。
// 核心响应已由 attachWeCom 附好 wecomMarkdown / wecomCard / wecomOptions，本层不做业务加工。
export async function askCore({ coreUrl, source, coreTimeoutMs = 45000 }, message, history, sessionId = "", images = []) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), coreTimeoutMs);
  try {
    const resp = await fetch(coreUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, source, sessionId, images }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`core http ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// 图片 OCR：把企微客户发的图片二进制 POST 给核心 /api/ocr，拿回 {ok,text,message}。
// 与 askCore 同一台核心（取 coreUrl 的 origin）。OCR 只做“图片→文字”，不判意图；
// 识别出的文字仍交回 handleText → /api/ai/chat 走原确定性链路（一个脑子不变）。
export async function recognizeImageCore({ coreUrl, coreTimeoutMs = 20000 }, imageBuffer) {
  const origin = new URL(coreUrl).origin;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), coreTimeoutMs);
  try {
    const resp = await fetch(`${origin}/api/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: imageBuffer.toString("base64") }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`ocr http ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}
