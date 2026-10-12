// 会话层（纯内存）：每个会话的最近对话历史 + 最近一次序号选项，用于“手打序号还原”。
// 企业微信不下发可点卡片，统一靠正文序号行引导客户回数字，因此只按会话记忆选项。
// 重启即清空，可接受：核心 3789 是唯一大脑，桥不长期保存业务状态。
export class SessionStore {
  constructor({ historyMax = 10, historyWindowMs = 30 * 60000, optionTtlMs = 15 * 60000 } = {}) {
    this.historyMax = historyMax;
    this.historyWindowMs = historyWindowMs;
    this.optionTtlMs = optionTtlMs;
    this.histories = new Map();   // chatKey -> [{role, content, at}]
    this.optionsByChat = new Map(); // chatKey -> {options:[{label,value}], expiresAt}
  }

  // ---- 对话历史 ----
  remember(chatKey, role, content, model) {
    const now = Date.now();
    let hist = this.histories.get(chatKey);
    const last = hist?.[hist.length - 1];
    if (!hist || !last || now - last.at > this.historyWindowMs) hist = [];
    // assistant 带上 core 返回的 model，使核心侧多轮路由（配单/售后续算的上下文判断）与网页口径一致
    hist.push(model ? { role, content, at: now, model } : { role, content, at: now });
    while (hist.length > this.historyMax) hist.shift();
    this.histories.set(chatKey, hist);
    return hist;
  }
  getHistory(chatKey) {
    const hist = this.histories.get(chatKey);
    if (!hist) return [];
    if (Date.now() - hist[hist.length - 1].at > this.historyWindowMs) {
      this.histories.delete(chatKey);
      return [];
    }
    return hist.map(({ role, content, model }) => (model ? { role, content, model } : { role, content }));
  }

  // ---- 序号选项（核心下发的 wecomOptions，顺序即序号）----
  rememberOptions(chatKey, options) {
    if (!Array.isArray(options) || !options.length) return;
    this.optionsByChat.set(String(chatKey), { options: options.slice(), expiresAt: Date.now() + this.optionTtlMs });
  }
  // 手打序号：1 / 1) / 1、 / 1. / ①；多位型号(如 410/6363)不在此替换，避免误吞型号
  choiceFromNumeric(chatKey, text) {
    const rec = this.optionsByChat.get(String(chatKey || ""));
    if (!rec) return "";
    if (rec.expiresAt < Date.now()) { this.optionsByChat.delete(String(chatKey)); return ""; }
    const raw = String(text || "").trim();
    const circled = raw.match(/[①②③④⑤⑥⑦⑧⑨⑩]/);
    const plain = raw.match(/^(\d{1,2})[.、)）]?$/);
    let idx = -1;
    if (circled) idx = "①②③④⑤⑥⑦⑧⑨⑩".indexOf(circled[0]);
    else if (plain) idx = parseInt(plain[1], 10) - 1;
    if (idx < 0 || idx >= rec.options.length) return "";
    const choice = rec.options[idx];
    return choice ? String(choice.value || choice.label || "") : "";
  }
  sweep() {
    for (const [k, v] of this.optionsByChat) if (v.expiresAt < Date.now()) this.optionsByChat.delete(k);
  }
}
