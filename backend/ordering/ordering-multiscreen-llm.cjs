// ============================================================================
// ordering-multiscreen-llm.cjs —— 多屏工程的“大模型语义兜底”
//
// 定位（严格遵守总纲：大模型只做判断，不查库、不选型、不写数字结论）：
//   确定性规则 ordering-multiscreen.cjs 已覆盖绝大多数明确多屏写法（数量词、多组
//   尺寸、多 P 值、主屏/副屏、场景词、分离宽高、米数超大）。本文件只兜底【措辞隐晦、
//   正则抓不全】的多屏表达（如“舞台中间一块、两边各一块、柱子再包两块”）。
//
// 模型只把客户的话切成“几块物理屏 + 每块的位置/原文尺寸”，是否采纳由本地严格校验：
//   置信度≥0.85、数出≥2 块、且有≥2 个位置标签或≥2 组能在【客户原文】里核对到的尺寸，
//   才判多屏。模型超时 / 失败 / 低置信 / 证据不足 / 未配置 → 一律返回 null（回退单屏），
//   绝不抛错、绝不误伤单块屏、绝不成为单点故障。
// ============================================================================

"use strict";

const llm = require("../llm-client.cjs");

const SYSTEM = [
  "你是 LED 显示屏配单的“屏体数量判断器”，只做一件事：判断客户这段话描述了几块【彼此独立、需要分别组网的物理屏】，并把每块屏拆成结构化条目。不选型、不写设备、不写参数、不回答客户。",
  "判定标准：",
  "1) 一块完整 LED 屏，无论客户报的是整屏像素(如1920x1080)、模组物理尺寸(如320mm×160mm)、模组排列张数(如10宽9高/横向10张纵向9张)、还是宽高米数，都仍是【1块屏】，screenCount=1。",
  "2) 模组尺寸、单张接收卡带载点数、分辨率、模组排列张数、电源/边框/控制设备，都不是“多块屏”。",
  "3) 只有出现以下【多个物理位置或多套独立屏】时才算多块屏：主屏/副屏、一主两副、会议厅(宴会厅/大厅/舞台)屏+门口或走廊或前台或立柱屏、左右侧屏、“N块/台/面屏分别是…”、一块大屏旁边/另外/背后还有一块屏等。",
  "4) 拿不准、只有一块屏、客户没说清、或只是同一屏的不同部件时，一律 screenCount=1、multiScreen=false，严禁把单块屏判成多块。",
  "每块屏给出：location(位置，如“主屏/门口左侧竖屏/柱子包屏”，没有位置就留空字符串)、pitch(P后面的数字，没有给null)、pixelsW/pixelsH(整屏宽/高像素，没有给null)、meterW/meterH(整屏宽/高米数，没有给null)。所有数字必须原样来自客户原文，禁止脑补、禁止把毫米当米、禁止换算。",
  "只输出 JSON，不要任何多余文字：",
  '{"screenCount":1,"multiScreen":false,"confidence":0.0,"screens":[{"location":"","pitch":null,"pixelsW":null,"pixelsH":null,"meterW":null,"meterH":null}]}',
].join("\n");

// 数字回原文核对：模型给的数字必须真的出现在客户原话里（去千分位后比较）
function numInRaw(num, raw) {
  if (num == null || num === "") return false;
  const n = String(num).replace(/[,，\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(n)) return false;
  return raw.replace(/[,，\s]/g, "").includes(n);
}
// 米数回原文核对：数字后必须真跟“米/公尺/m”，且 m 后不能再是字母（排除 mm 毫米）
function meterInRaw(num, raw) {
  if (!numInRaw(num, raw)) return false;
  const n = String(num).replace(/[,，\s]/g, "");
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(esc + "\\s*(?:米|公尺|m)(?![a-zA-Z])", "i").test(raw);
}

// 返回 "multi-screen" 或 null
async function detectMultiScreenLLM(text) {
  try {
    const t = String(text || "");
    if (!llm.enabled()) return null;
    if (t.length < 10) return null;
    // LED / 配单语境（客户口语可能不带“屏”字，如“楼上一块楼下一块”，故不能只认“屏”）
    const ledCtx = /P\s*\d|屏|显示|幕|LED|模组|走字|箱体|接收卡|处理器|播放盒|控制卡/i.test(t);
    if (!ledCtx) return null;
    if (/一块屏|单个屏|就一块|单块|只有一块|仅有一块|一块整屏/.test(t)) return null; // 明确单屏
    // 只在“像多屏工程但确定性没抓到”时才花一次模型调用：
    //  有并列/位置线索；塞了多个尺寸数字；≥2 个量词条（一块…一块…）；≥2 个不同位置词（楼上/楼下、大厅/门口、室内/户外）
    const hint = /还|另外|另加|再加|又一|各一|各\s*[一两三四五六七八九\d两]|旁边|边上|侧|门口|大厅|厅|楼|前台|舞台|背景|主屏|副屏|柱/.test(t);
    const manyNums = (t.match(/\d{3,}/g) || []).length >= 3;
    const qtyCount = (t.match(/[一二两俩三四五六七八九十几多数\d]\s*[块面台套个]/g) || []).length;
    const locSet = new Set(t.match(/楼上|楼下|大厅|门口|前台|舞台|走廊|宴会厅|会议厅|展厅|展馆|左侧|右侧|左边|右边|正反|背面|背后|室内|户外|柱|入口|进门|头顶/g) || []);
    if (!(hint || manyNums || qtyCount >= 2 || locSet.size >= 2)) return null;

    const r = await llm.chat({ system: SYSTEM, user: t, json: true, temperature: 0, maxTokens: 300, timeoutMs: 4000 });
    if (!r || typeof r !== "object") return null;
    if (!(Number(r.confidence) >= 0.85)) return null;
    const screens = Array.isArray(r.screens) ? r.screens : [];
    if (screens.length < 2) return null;

    // 证据校验：≥2 块屏必须有可核对线索——≥2 个非空位置，或≥2 组原文里真实存在的尺寸
    let locations = 0;
    let sized = 0;
    for (const s of screens) {
      if (s && typeof s.location === "string" && s.location.trim()) locations++;
      const w = s.pixelsW != null ? s.pixelsW : s.pixels_w;
      const h = s.pixelsH != null ? s.pixelsH : s.pixels_h;
      const mw = s.meterW != null ? s.meterW : s.meter_w;
      const mh = s.meterH != null ? s.meterH : s.meter_h;
      const hasPx = w != null && h != null && numInRaw(w, t) && numInRaw(h, t);
      const hasMeter = mw != null && mh != null && meterInRaw(mw, t) && meterInRaw(mh, t);
      if (hasPx || hasMeter) sized++;
    }
    if (locations >= 2 || sized >= 2) return "multi-screen";
    return null;
  } catch {
    return null; // 任何异常都回退单屏，绝不阻塞配单
  }
}

module.exports = { detectMultiScreenLLM };
