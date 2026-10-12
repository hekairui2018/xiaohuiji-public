// 编排层：一条客户文本进来的完整收发流程（序号还原 → 取历史 → 问核心 → 回正文 → 记历史）。
// 业务答案全部来自核心 3789；企业微信不发可点卡片，选项以正文序号行呈现、客户回数字选择。
import { askCore, recognizeImageCore } from "./core.mjs";
import { sendMarkdown, sendImage } from "./wecom.mjs";
import { svgToPngBuffer } from "./topo-image.mjs";

const CORE_FALLBACK = "消息处理有点慢，请稍等几秒再发一次试试。";
// 图片 OCR 失败 / 没认出字时的引导（不硬猜、不阻断）
const OCR_FALLBACK = "图片里没认出文字，请直接用文字把【设备型号】和【现场现象】发我（例如“C16L花屏一直闪”），我来帮你查资料和历史案例。";

// 去掉群聊里开头的 @机器人 称呼
function cleanText(value) {
  return String(value || "").replace(/^@[^\s@]+\s*/, "").trim();
}

export function makeResponder({ cfg, client, store, record }) {
  async function handleText(chatKey, target, rawText, images = []) {
    let text = cleanText(rawText);
    if (!text) return;

    // 客户手打序号 → 还原成上一轮选项的真实型号/动作
    const picked = store.choiceFromNumeric(chatKey, text);
    if (picked) text = picked;

    const history = store.getHistory(chatKey);
    store.remember(chatKey, "user", text);

    let data;
    try {
      data = await askCore(cfg, text, history, chatKey, images);
    } catch (error) {
      console.error("[core] 请求失败:", error?.message || error);
      await sendMarkdown(client, target, CORE_FALLBACK).catch(() => {});
      record({ chatKey, question: text, ok: false, error: String(error?.message || error) });
      return;
    }

    // 配单结果：先把接收卡连接拓扑图发出来（核心返回 SVG，本机无头浏览器转 PNG），让企微和网页一样能看到整屏走线；
    // 出图任何环节失败都静默跳过，下面的文字方案照常发，不阻断主流程。
    const topoSvg = data.ordering && data.ordering.topologySvg;
    if (topoSvg) {
      try {
        const png = await svgToPngBuffer(topoSvg);
        if (png) await sendImage(client, target, png);
      } catch (error) {
        console.warn("[topo-img] 拓扑图发送失败，已降级为纯文字:", error?.message || error);
      }
    }

    // 核心已按企微通道组好正文（含“回复数字选型”序号行）；逐级兜底
    const markdown = String(data.wecomMarkdown || data.reply || data.clarifyQuestion || "").trim() || CORE_FALLBACK;
    await sendMarkdown(client, target, markdown);

    // 记住本轮选项顺序，供客户下一条回数字时还原（不发卡片）
    const options = Array.isArray(data.wecomOptions) ? data.wecomOptions : [];
    if (options.length) store.rememberOptions(chatKey, options);

    store.remember(chatKey, "assistant", markdown, data.model || "");
    record({ chatKey, question: text, answer: markdown, model: data.model || "", ok: true, optionCount: options.length });
  }

  // 客户发图片：企微 SDK 下载解密 → 核心 OCR 转文字 → 当作客户文本走同一条问答链路。
  // 下载 / OCR / 无字任一失败都引导打字，绝不硬猜。
  async function handleImage(chatKey, target, imageUrl, aeskey) {
    let text = "", imageId = "";
    try {
      if (!imageUrl) throw new Error("image url missing");
      const dl = await client.downloadFile(imageUrl, aeskey);
      const r = await recognizeImageCore(cfg, dl.buffer);
      text = String((r && r.ok && r.text) || "").trim();
      imageId = String((r && r.ok && r.imageId) || "");
    } catch (error) {
      console.warn("[image-ocr] 图片识别失败:", error?.message || error);
    }
    if (text) {
      record({ chatKey, kind: "image-ocr", ok: true, chars: text.length });
      return handleText(chatKey, target, text, imageId ? [imageId] : []);
    }
    record({ chatKey, kind: "image-ocr", ok: false });
    return sendMarkdown(client, target, OCR_FALLBACK).catch(() => {});
  }

  // 图文混排：文本段直接用，图片段逐张下载 OCR，合并后走文本链路。
  async function handleMixed(chatKey, target, items) {
    const parts = [];
    const imageIds = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (it && it.msgtype === "text" && it.text && it.text.content) {
        parts.push(String(it.text.content));
      } else if (it && it.msgtype === "image" && it.image && it.image.url) {
        try {
          const dl = await client.downloadFile(it.image.url, it.image.aeskey);
          const r = await recognizeImageCore(cfg, dl.buffer);
          const t = String((r && r.ok && r.text) || "").trim();
          if (t) { parts.push(t); if (r && r.imageId) imageIds.push(r.imageId); }
        } catch (error) {
          console.warn("[mixed-ocr] 混排图片识别失败:", error?.message || error);
        }
      }
    }
    const text = parts.map((p) => p.trim()).filter(Boolean).join("\n").trim();
    if (text) {
      record({ chatKey, kind: "mixed-ocr", ok: true, chars: text.length });
      return handleText(chatKey, target, text, imageIds);
    }
    record({ chatKey, kind: "mixed-ocr", ok: false });
    return sendMarkdown(client, target, OCR_FALLBACK).catch(() => {});
  }

  return { handleText, handleImage, handleMixed };
}
