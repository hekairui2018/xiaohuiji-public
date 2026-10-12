"use strict";
/*
 * video-catalog.cjs —— 操作/教学视频数据层（快查站「视频」大类 + AI/企微视频回答）
 * 背景：视频原本只按 OSS 目录(=软件)挂在软件卡内，客户按“操作主题”（复位/恢复出厂、WiFi、U 盘…）
 *       查找时命中不到（如 A6/D15 复位视频埋在 HDPlayer 目录）。本文件把视频按操作主题组织：
 *         · 功能场景组优先：复位 / U 盘 / WiFi 联网 / 连接拼接多画面 / 智能设置 / 节目编辑发送
 *         · 通用演示按平台兜底：手机 APP 屏掌控 / 小灰云 / HDSet / HDPlayer / HD Show / 单双色 HDSign / 其他
 * 只读 data/video-manifest.json 中 status=uploaded 的条目；零依赖、不做 HTTP/展示。
 * 一个脑子：网页与企微共用本文件，差异只在展示层（企微给快查站“在线看”深链，不发裸 mp4）。
 */
const fs = require("fs");
const path = require("path");

const PUBLIC_ORIGIN = "http://9vh47rq28469.vicp.fun"; // 花生壳外网 → 127.0.0.1:3789

let _items = null;
function manifestItems() {
  if (_items) return _items;
  const p = path.join(__dirname, "..", "data", "video-manifest.json");
  let raw = { items: [] };
  try { raw = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.error("[video-catalog] manifest 读取失败:", e.message); }
  const arr = Array.isArray(raw.items) ? raw.items : [];
  _items = arr.filter((it) => it && it.status === "uploaded" && it.publicUrl && it.name);
  return _items;
}

function humanSize(n) {
  const b = Number(n) || 0;
  if (b >= 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(1) + " GB";
  if (b >= 1024 * 1024) return Math.round(b / 1024 / 1024) + " MB";
  if (b >= 1024) return Math.round(b / 1024) + " KB";
  return b + " B";
}
function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, ""); }
function dirOf(ossKey) { return String(ossKey || "").split("/")[1] || ""; }

// 功能场景组（按顺序第一命中为主组）
const FUNCTION_TOPICS = [
  { key: "reset",   label: "复位 · 恢复出厂", re: /复位|恢复出厂|出厂设置|断电重启|重置|reset/i },
  { key: "usb",     label: "U 盘操作",        re: /u\s?盘|优盘|usb/i },
  { key: "wifi",    label: "WiFi · 联网 · 密码", re: /wi[-\s]?fi|wifi|密码|station|局域网|固定\s?ip|开放式|桥接|无线路由|联网|连网|热点/i },
  { key: "connect", label: "连接配屏 · 拼接 · 多画面", re: /连接设置|多屏同步|多开|接线|级联|开窗|两画面|多画面|拼接|异型|错位|旋转安装|投屏|自适应|同步参数|分区播放/i },
  { key: "smart",   label: "智能设置（读灯/走线）", re: /智能设置/ },
  { key: "program", label: "节目编辑 · 发送 · 功能", re: /节目|表格|时钟|天气|动画字|动态数据|多节目|开机画面|计数|回读|视频转码|loading|隐藏功能|设备锁|二次开发|第三方应用|按钮功能|发布/i },
];
// 功能组未命中时，按 OSS 目录兜底到平台组
const PLATFORM_BY_DIR = {
  app:      { key: "app",      label: "手机 APP · 屏掌控" },
  cloud:    { key: "cloud",    label: "云平台 · 小灰云" },
  hdset:    { key: "hdset",    label: "HDSet 调试" },
  hdplayer: { key: "hdplayer", label: "HDPlayer 综合操作" },
  hdshow:   { key: "hdshow",   label: "HD Show · 视频处理器" },
  hdsign:   { key: "hdsign",   label: "单双色 · HDSign · HD2020" },
};
const PLATFORM_FALLBACK = [
  { key: "cloud",    re: /小灰云|云平台|设备绑定|信息发布|云端|集群/i },
  { key: "app",      re: /屏掌控|全彩\s?app|app\s?操作|立方屏|手机/i },
  { key: "hdset",    re: /hdset/i },
  { key: "hdshow",   re: /hd\s?show|视频处理器|vp\s?\d|vpx/i },
  { key: "hdsign",   re: /hdsign|单双色|单色|双色|条屏|hd\s?20\d{2}|w\s?f?系列|字幕/i },
  { key: "hdplayer", re: /hd\s?player/i },
];
const OTHER = { key: "other", label: "其他操作" };
const TOPIC_ORDER = ["reset", "usb", "wifi", "connect", "smart", "program", "app", "cloud", "hdset", "hdplayer", "hdshow", "hdsign", "other"];
const TOPIC_LABEL = {};
[...FUNCTION_TOPICS, ...Object.values(PLATFORM_BY_DIR), OTHER].forEach((t) => { TOPIC_LABEL[t.key] = t.label; });

function primaryTopic(it) {
  const n = it.name || "";
  for (const t of FUNCTION_TOPICS) if (t.re.test(n)) return t.key;
  const d = PLATFORM_BY_DIR[dirOf(it.ossKey)];
  if (d) return d.key;
  for (const t of PLATFORM_FALLBACK) if (t.re.test(n) || t.re.test(it.ossKey || "")) return t.key;
  return OTHER.key;
}

function viewOf(it) {
  const topic = primaryTopic(it);
  return {
    name: it.name,
    url: it.publicUrl,
    sizeText: humanSize(it.sizeBytes),
    sizeBytes: it.sizeBytes || 0,
    kind: it.kind || "",
    topic,
    topicLabel: TOPIC_LABEL[topic] || OTHER.label,
  };
}
function allViews() { return manifestItems().map(viewOf); }

// 检索同义词：query 含某词 → 给对应主题/名称加权（覆盖客户口语）
const SYNONYMS = [
  { topic: "reset",    words: ["复位", "重置", "恢复出厂", "出厂", "重启", "reset", "清零", "断电"] },
  { topic: "usb",      words: ["u盘", "u 盘", "优盘", "usb", "插盘", "盘更新"] },
  { topic: "wifi",     words: ["wifi", "wi-fi", "wi fi", "无线", "联网", "连网", "网络", "密码", "热点", "局域网", "固定ip", "ip", "桥接", "station", "在线", "连不上网", "找不到网"] },
  { topic: "connect",  words: ["拼接", "级联", "多画面", "开窗", "两画面", "多屏", "投屏", "接线", "连接", "同步", "旋转", "错位", "异型", "处理器", "多开", "分区", "二合一"] },
  { topic: "smart",    words: ["智能设置", "智能", "读灯", "走线", "模组配置", "屏参"] },
  { topic: "program",  words: ["节目", "发送", "编辑", "表格", "时钟", "天气", "动画", "动态数据", "开机画面", "计数", "回读", "转码", "设备锁", "二次开发", "发布", "字幕", "内容"] },
  { topic: "cloud",    words: ["小灰云", "云平台", "云端", "云", "绑定", "集群", "信息发布", "c2cloud", "网页版"] },
  { topic: "app",      words: ["app", "手机", "屏掌控", "移动端", "平板", "立方屏", "安卓", "苹果", "ios"] },
  { topic: "hdset",    words: ["hdset", "调试软件", "发送卡调试", "接收卡调试"] },
  { topic: "hdplayer", words: ["hdplayer", "hd player", "异步软件", "播放软件"] },
  { topic: "hdshow",   words: ["hd show", "hdshow", "c2", "多媒体", "中控", "vp", "vpx", "处理器软件"] },
  { topic: "hdsign",   words: ["hdsign", "单色", "双色", "单双色", "条屏", "门头", "字幕机", "hd2020", "2020", "w系列", "wf系列"] },
];

function matchVideos(query, limit) {
  const q = norm(query);
  if (!q) return [];
  const tokens = String(query || "").split(/[\s,，、。.;；!?！？·\-_/\\]+/).map(norm).filter((t) => t.length >= 2);
  if (q.length >= 2 && !tokens.includes(q)) tokens.unshift(q);
  const scored = [];
  for (const v of allViews()) {
    const n = norm(v.name);
    let score = 0;
    if (n.includes(q)) score += 100;
    for (const tk of tokens) if (tk.length >= 2 && n.includes(tk)) score += 40;
    for (const syn of SYNONYMS) {
      const hitWord = syn.words.find((w) => q.includes(norm(w)));
      if (hitWord) {
        if (v.topic === syn.topic) score += 25;
        if (n.includes(norm(hitWord))) score += 30;
      }
    }
    if (score > 0) scored.push({ v, score });
  }
  scored.sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name, "zh"));
  let out = scored.map((x) => x.v);
  const seen = new Set(); // 同名去重（同一标题可能有 original/720p 两条，只保留相关度最高的一条）
  out = out.filter((v) => { if (seen.has(v.name)) return false; seen.add(v.name); return true; });
  return limit ? out.slice(0, limit) : out;
}

function groupViews(views, preserveOrder) {
  const map = new Map();
  views.forEach((v) => {
    if (!map.has(v.topic)) map.set(v.topic, []);
    map.get(v.topic).push(v);
  });
  const groups = [];
  TOPIC_ORDER.forEach((key) => {
    if (!map.has(key)) return;
    let list = map.get(key);
    if (!preserveOrder) list = list.slice().sort((a, b) => a.name.localeCompare(b.name, "zh"));
    groups.push({ key, label: TOPIC_LABEL[key] || OTHER.label, count: list.length, videos: list });
  });
  return groups;
}

// 快查站「视频」分类：q 空 = 全主题分组浏览；q 非空 = 按相关度过滤后分组
function buildVideoCategory(query) {
  const q = String(query || "").trim();
  if (!q) {
    const views = allViews().slice().sort((a, b) =>
      a.topic === b.topic ? a.name.localeCompare(b.name, "zh") : TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic));
    return { query: "", groups: groupViews(views, false), total: views.length };
  }
  const hits = matchVideos(q);
  return { query: q, groups: groupViews(hits, true), total: hits.length };
}

// 在线看深链：网页同域走相对路径；企微等外网通道走花生壳绝对地址（打开快查站视频分类并定位）
function watchHref(q, source) {
  const rel = "/quick?cat=video&q=" + encodeURIComponent(q);
  return source === "quick-site" ? rel : PUBLIC_ORIGIN + rel;
}
function videoHomeHref(source) {
  return source === "quick-site" ? "/quick?cat=video" : PUBLIC_ORIGIN + "/quick?cat=video";
}

// AI/企微：明确要操作视频时的回答；命中不到返回 null（调用方回退软件清单）
function buildVideoAnswer(message, opts) {
  const source = (opts && opts.source) || "";
  const hits = matchVideos(message, 6);
  if (!hits.length) return null;
  const L = ["为你找到以下操作视频，手机点「在线看」可在产品速查页直接播放，也可点「下载」保存："];
  hits.forEach((v) => {
    L.push(`· [${v.name} · 在线看](${watchHref(v.name, source)})　[下载](${v.url})`);
  });
  L.push("");
  L.push(`更多视频可在产品速查页「视频」分类按 复位 / WiFi / U盘 / 拼接 / 节目 等关键词查找：${videoHomeHref(source)}`);
  return { reply: L.join("\n"), items: hits };
}

// 明确在要“操作/教学视频”，或问“怎么复位/如何投屏”等操作方法。
// 保守：带强故障词且没有明确要视频/教程的，仍归售后，避免抢排障。
const TOPIC_RE = /复位|恢复出厂|重置|wi[-\s]?fi|wifi|无线|联网|连网|密码|u\s?盘|优盘|投屏|拼接|级联|开窗|多画面|多屏|节目|智能设置|接线|分区播放|视频转码|开机画面|设备锁|二次开发|回读|计数|时钟|天气|表格|动态数据|连接设置|多开/i;
const FAULT_RE = /花屏|黑屏|闪屏|闪烁|一直闪|不亮|点不亮|偏色|色块|鬼影|拖影|水波纹|摩尔纹|坏了|坏掉|故障|异常|失败|变砖|刷不上|连不上|搜不到|掉线|丢包|错误包|死机|卡死|闪退|崩溃/;
function isVideoAcquire(text) {
  const t = String(text || "");
  const wantVideo = /(?:操作|教学|演示|指导|教程|使用)?\s*视频|录像/.test(t) && TOPIC_RE.test(t);
  const howTo = /(?:怎么|如何|怎样).{0,8}(?:复位|恢复出厂|重置|投屏|拼接|级联|开窗|分屏|多屏|联网|连网|连.{0,3}wi[-\s]?fi|找回.{0,4}密码|u\s?盘更新|多画面|接线|分区播放|连接设置)/.test(t);
  const resetHow = /(?:复位|恢复出厂|重置).{0,10}(?:怎么操作|怎么用|如何用|用法|使用方法|操作方法|视频|教程|怎么做|如何|步骤|方法|演示|操作)/.test(t);
  const haveVideo = /(?:有没有|有没有.{0,6}|发个.{0,6}|给个.{0,6})(?:视频|教程|演示)/.test(t) && TOPIC_RE.test(t);
  if (!(wantVideo || howTo || resetHow || haveVideo)) return false;
  if (FAULT_RE.test(t) && !/(?:视频|教程|演示|录像)/.test(t)) return false;
  return true;
}

module.exports = { buildVideoCategory, buildVideoAnswer, matchVideos, isVideoAcquire, watchHref, videoHomeHref };
