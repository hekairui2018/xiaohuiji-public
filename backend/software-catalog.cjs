/*
 * software-catalog.cjs —— 软件下载「数据层 + 轻业务」
 * 职责（单一）：维护 HD 自有 PC 软件目录，识别客户话术中的软件，组装“用途 + 下载 + 官网资料”回答。
 * 不做：HTTP、展示（网页卡片/企微 markdown 由各自展示层负责）。
 *
 * 口径（用户既定）：客户问软件，只回答 ①软件用途（一句话，按说明书口径）②阿里云OSS下载链接 ③官网资料页；
 *   下载器是几十 KB 的在线安装引导程序，已上传到 OSS 桶 he-mo 的 software/ 前缀（公共读，走云带宽）；
 *   运行后由客户电脑再从灰度官网 CDN 拉取完整安装包。软件升级后重新生成下载器并重传即可。
 * 仅收录 HD 自有软件；第三方远程工具（ToDesk/向日葵）不在此列（再分发授权 + 版本易过时，需要时给官网链接）。
 */

"use strict";

// 软件下载器固定走 OSS 公共直链（与规格书同桶，单独 software/ 前缀）；中文对象名需 URL 编码
const SOFTWARE_OSS_BASE = "https://he-mo.oss-cn-shenzhen.aliyuncs.com/software/";
const DOWNLOAD_CENTER = "https://www.huidu.cn/CnDownload/index_100000010716522.html#download";
// 企微/微信里视频不发裸 mp4（OSS 默认域名会强制下载），统一引导到小灰机网页深链，由内嵌播放器在线看
const HUIAI_BASE = "http://9vh47rq28469.vicp.fun/huiai";
const watchUrl = (name) => HUIAI_BASE + "?q=" + encodeURIComponent(name);

// 版本号来自各下载器内嵌的官网完整安装包文件名（权威，不手填猜测）
const SOFTWARE = [
  {
    id: "HDSet",
    name: "HDSet",
    file: "下载HDSet.exe",
    version: "V4.0.38.11",
    line: "全彩屏调试",
    aliases: ["hdset", "调试软件", "调屏软件", "屏参软件", "接收卡调试", "发送卡调试", "智能设置软件", "参数调试软件"],
    purpose: "全彩 LED 屏发送卡/接收卡调试软件，用于连接设备、读取与设置屏参、智能设置、接收卡固件升级和测试画面。",
    manualUrl: DOWNLOAD_CENTER,
    manualLabel: "HDSet 官网下载页"
  },
  {
    id: "HDPlayer",
    name: "HDPlayer",
    file: "下载HDPlayer.exe",
    version: "7.11.18.0",
    line: "异步全彩节目",
    aliases: ["hdplayer", "hd player", "异步软件", "播放软件", "节目编辑软件", "发节目软件", "节目发送软件", "异步播放软件"],
    purpose: "异步全彩控制卡/播放盒的电脑端软件，用来编辑图文、视频、字幕节目，再通过网络或 U 盘发送到设备播放。",
    manualUrl: "https://www.huidu.cn/CnDownload/index_100000010721638.html#download",
    manualLabel: "HDPlayer 官网下载页"
  },
  {
    id: "HDShow",
    name: "HD Show",
    file: "下载HD Show.exe",
    version: "2.1.1.0",
    line: "全彩节目/中控",
    aliases: ["hdshow", "hd show", "show软件", "hdshow软件", "多媒体服务器软件", "网络中控软件", "c2软件"],
    purpose: "新一代全彩节目编辑播放软件，支持多媒体播放与 C2/C2 Cloud 网络中控，适配新款播放盒和多媒体服务器。",
    manualUrl: "https://www.huidu.cn/CnDownload/index_100000011583929.html",
    manualLabel: "HD Show 官网下载页"
  },
  {
    id: "HD2020",
    name: "HD2020",
    file: "下载HD2020.exe",
    version: "V1.3.2.1",
    line: "全彩节目（旧版线）",
    aliases: ["hd2020", "2020软件", "hd 2020"],
    purpose: "全彩 LED 屏节目编辑播放软件，是 HD Show 的前代版本，供对应型号的设备使用。",
    manualUrl: "https://www.huidu.cn/CnDownload/index_100000011573672.html",
    manualLabel: "HD2020 官网下载页"
  },
  {
    id: "HD2018",
    name: "HD2018",
    file: "下载HD2018.exe",
    version: "v1.0.35",
    line: "老款设备兼容",
    aliases: ["hd2018", "2018软件", "hd 2018"],
    purpose: "早期型号控制卡配套的节目编辑播放软件，主要用于兼容老款设备；新设备建议用 HDPlayer 或 HD Show。",
    manualUrl: "https://www.huidu.cn/CnDownload/index_100000011553448.html",
    manualLabel: "HD2018 官网下载页"
  },
  {
    id: "HDSign",
    name: "HDSign",
    file: "下载HDSign.exe",
    version: "V2.0.2",
    line: "单双色/条屏",
    aliases: ["hdsign", "hd sign", "单双色软件", "条屏软件", "字幕软件", "门头条屏软件", "单双色编辑软件"],
    purpose: "单双色 LED 屏、门头条屏的字幕节目编辑发送软件，适合文字通知、滚动字幕这类内容。",
    manualUrl: "https://www.huidu.cn/CnDownload/index_100000011517239.html",
    manualLabel: "HDSign 官网下载页"
  },
  {
    id: "LCDPlayer",
    name: "LCD Player",
    file: "下载LCD Player.exe",
    version: "V1.1.26.0",
    line: "LCD 商显",
    aliases: ["lcdplayer", "lcd player", "lcd软件", "商显软件", "液晶商显软件", "lcd播放软件"],
    purpose: "LCD 液晶商显屏的节目编辑与播放软件，用于商显屏的内容编排和循环播放。",
    manualUrl: "https://www.huidu.cn/CnDownload/index_100000011545712.html",
    manualLabel: "LCD Player 官网下载页"
  },
  {
    id: "PingZhangKong",
    name: "屏掌控",
    file: "",
    version: "手机版",
    line: "手机 APP",
    aliases: ["屏掌控", "屏掌控app", "ledart", "手机软件", "手机app", "全彩app", "单色app", "app软件", "手机控制软件"],
    purpose: "手机/平板上的 LED 屏移动管理 APP，支持无线配屏、节目编辑与发送、亮度调节、定时开关屏和截屏管理；主「屏掌控」（LedArt）为全彩/单双色/LCD 通用版，外出和现场调试更方便。",
    manualUrl: "",
    manualLabel: "",
    mobile: {
      iosUrl: "https://apps.apple.com/cn/app/id1144062386",
      iosLabel: "iPhone 下载「屏掌控」（全彩通用版）",
      // 官网统一下载页 qrcode.html 的安卓“完整版/通用版”即跳转此应用宝中转（包名 cn.huidu.huiduapp），微信/手机点开即下；
      // 旧值 User_Manual_APP.html 实为「单双色屏掌控入门」说明页，会把全彩客户引到单色版，已废弃。
      androidUrl: "https://a.app.qq.com/o/simple.jsp?pkgname=cn.huidu.huiduapp",
      androidLabel: "安卓下载「屏掌控」（全彩通用版）",
      storeHint: "安卓在华为、小米、OPPO、vivo、应用宝等商店搜「屏掌控」，认准开发者「灰度科技」的全彩通用版（单双色/全彩/LCD 系列通用，包名 cn.huidu.huiduapp）；纯单双色老卡若搜不到通用版，可改用「屏掌控单色版」。官网统一下载页：www.huidu.cn/qrcode.html（屏掌控商显版已下架，勿下）"
    }
  },
  {
    id: "XiaoHuiYun",
    name: "小灰云",
    file: "",
    version: "云平台",
    line: "云平台",
    aliases: ["小灰云", "小灰云平台", "云平台", "c2cloud", "云发布", "信息发布系统", "云端发布", "云平台软件", "小灰云信息发布"],
    purpose: "云端 LED 信息发布与集群管理平台，可远程发布节目、集中管理多块屏幕、查看设备在线状态，适合连锁门店和多点位屏幕的统一运维。",
    manualUrl: "",
    manualLabel: "",
    mobile: {
      webUrl: "https://www.xiaohuiyun.com",
      webLabel: "小灰云网页版（浏览器登录·免安装）",
      webNote: "B/S 架构，浏览器登录即可使用，账号需开通，可联系客服",
      iosUrl: "https://apps.apple.com/cn/app/id6769718646",
      iosLabel: "iPhone 下载「小灰云星空」",
      storeHint: "安卓在应用商店搜「小灰云星空」；小灰云主平台为网页版、无需安装"
    }
  }
];

// 软件分组（网页全家桶清单与企微清单共用同一数据源，展示层各自渲染）
const SOFTWARE_GROUPS = [
  { key: "led", label: "LED 主控软件（电脑端）", ids: ["HDSet", "HDPlayer", "HDShow", "HD2020", "HD2018", "HDSign"] },
  { key: "mobile", label: "手机 APP · 云平台", ids: ["PingZhangKong", "XiaoHuiYun"] },
  { key: "lcd", label: "LCD 商显软件", ids: ["LCDPlayer"] }
];
function groupOfId(id) {
  for (const g of SOFTWARE_GROUPS) if (g.ids.includes(id)) return { key: g.key, label: g.label };
  return { key: "other", label: "其他软件" };
}

function norm(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, "");
}

function downloadUrlOf(soft) {
  return SOFTWARE_OSS_BASE + encodeURIComponent(soft.file);
}

// 命中具体软件：软件名/别名归一化后做“相等或包含”匹配，按 id 长度（更具体）优先，最多返回命中项
function matchSoftware(message) {
  const q = norm(message);
  if (!q) return [];
  const hits = [];
  for (const s of SOFTWARE) {
    const keys = [s.name, s.id, ...(s.aliases || [])].map(norm).filter(Boolean);
    // 完整词相等优先；中文别名（如“调试软件”）用包含匹配；英文软件名要求边界，避免 hd 撞词
    const hit = keys.some((k) => {
      if (/^[a-z0-9.]+$/.test(k)) return q === k || q.includes(k); // 英文/数字名：子串即可（hdplayer/hdset 足够特异）
      return q.includes(k);
    });
    if (hit) hits.push(s);
  }
  // 去重并按名称长度降序（更具体的在前）
  const uniq = [];
  const seen = new Set();
  hits.sort((a, b) => (b.name.length - a.name.length) || a.id.localeCompare(b.id));
  for (const h of hits) if (!seen.has(h.id)) { seen.add(h.id); uniq.push(h); }
  return uniq;
}

// 泛软件“获取”动作：光出现“软件”二字不算（OCR/陈述里常有“LED软件界面”，并非要软件），
// 必须是在要下载/安装包/客户端，或向软件名要手册/教程。
const SOFTWARE_ACQUIRE_RE = /(在哪|哪里|哪儿|怎么|如何|怎样|求|给我|发我|提供|有没有|想要|能不能给|麻烦).{0,6}(下载|下一下|安装包|安装程序|客户端|安装软件|软件|程序)|下载.{0,6}(软件|程序|安装|HDSet|HDPlayer|HD\s?Show|HD20\d\d|HDSign|LCD\s?Player|屏掌控)|安装(软件|程序|包)|重装(软件|程序|系统)|软件(安装包|客户端|在哪里?下载|怎么下载|如何下载|手册|说明书|教程)|^(软件|客户端|安装包|安装程序)$/;
function isSoftwareIntent(message) {
  return SOFTWARE_ACQUIRE_RE.test(String(message || ""));
}

// 点名 HD 软件 / 屏掌控，要“资料或教学”（手册/说明书/教程/指导·操作视频/怎么用）→ 软件域。
// 容错“指导视频”打成“直到视频”：软件名后短距离内出现 视频/教程/手册 等资料词即命中。
const SOFTWARE_DOC_RE = /(HDSet|HDPlayer|HD\s?Show|HD20\d\d|HDSign|LCD\s?Player|屏掌控|灰度软件|调试软件|调屏软件|播放软件|单双色软件|商显软件|异步软件)[\s\S]{0,12}(手册|说明书|教程|教学|视频|怎么用|如何用|操作方法|使用方法|下载|安装包|客户端)/;
// 显式配单/配卡语：即便 OCR 文本夹带“LED软件界面”，也交配单，不被软件域抢走
const ORDERING_HINT_RE = /(怎么配|如何配|配单|配卡|配屏|配一块|配一张|配几张|几张(接收卡|控制卡|卡)|多少张(卡|接收卡|控制卡)|需要.{0,6}几张)/;

// 故障/操作异常语境词：客户在问“软件出问题”而不是“要软件”时，让售后通道接走
const TROUBLE_CTX_RE = /(发不出|发送失败|连不上|连接失败|连接不上|失败|不显示|黑屏|花屏|闪屏|闪烁|卡顿|卡死|闪退|崩溃|报错|错误码|无法|不能|打不开|无法打开|不能打开|停止运行|已停止|用不了|无响应|怎么设置|怎么编辑|不同步|丢包|异常|没反应|不播放|偏色|错位|死机|重启|离线|没信号|灰屏)/;
// 即便带故障词，只要明确是要“下载/重装包/客户端”，仍按软件获取处理
const ACQUIRE_FORCE_RE = /(下载|安装包|安装程序|客户端|在哪.{0,3}下|重装|重新安装)/;
// 软件获取意图（路由用）：①软件名+资料/教学词；②命中具体HD软件名且非纯故障；③明确的下载/安装获取语。
// 裸“软件/软件界面/操作系统”这类陈述或 OCR 前缀不在此列，交语义层判断。
function isSoftwareAcquire(message) {
  const text = String(message || "");
  if (TROUBLE_CTX_RE.test(text) && !ACQUIRE_FORCE_RE.test(text)) return false;
  if (ORDERING_HINT_RE.test(text) && !/(下载|安装包|客户端|手册|说明书|教程)/.test(text)) return false;
  if (SOFTWARE_DOC_RE.test(text)) return true;
  if (matchSoftware(text).length) return true;
  return SOFTWARE_ACQUIRE_RE.test(text);
}


// —— 操作视频 / 中文说明书清单（由上传脚本生成；缺失则降级为空，不影响下载器与原有功能）——
const fs = require("fs");
const path = require("path");
function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
const VIDEO_MANIFEST = loadJson(path.join(__dirname, "..", "data", "video-manifest.json"));
const MANUAL_MANIFEST = loadJson(path.join(__dirname, "..", "data", "software-manuals-manifest.json"));

function sizeText(bytes) {
  if (!bytes) return "";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + "MB";
  return Math.round(bytes / 1024) + "KB";
}
// 各软件归属的视频分类（manifest 里 ossKey 形如 video/<cat>/<file>.mp4）
function videoItemsOf(swId) {
  if (!VIDEO_MANIFEST || !Array.isArray(VIDEO_MANIFEST.items)) return [];
  const all = VIDEO_MANIFEST.items.filter((v) => v && v.status === "uploaded");
  const cat = (k) => (v) => String(v.ossKey || "").split("/")[1] === k;
  const has = (s) => (v) => String(v.name || "").includes(s);
  switch (swId) {
    case "HDSet": return all.filter(cat("hdset"));
    case "HDPlayer": return all.filter(cat("hdplayer"));
    case "HDShow": return all.filter(cat("hdshow"));
    case "HDSign": return all.filter(cat("hdsign")).filter((v) => !has("屏掌控")(v) && !has("HD2020")(v));
    case "HD2020": return all.filter(cat("hdsign")).filter(has("HD2020"));
    // 立方屏是独立 APP（com.huidu.cubescreen / LEDCube），不属屏掌控，需从软件卡排除（视频大全仍可搜到）
    case "PingZhangKong": return all.filter((v) => cat("app")(v) || cat("misc")(v) || (cat("hdsign")(v) && has("屏掌控")(v)))
      .filter((v) => !/立方屏/.test(String(v.name || "")));
    case "XiaoHuiYun": return all.filter(cat("cloud"));
    default: return [];
  }
}
// 每个软件挑一个最通用的主视频（按文件名关键串），其余收进“更多”
const PRIMARY_HINT = {
  HDSet: "HDset操作",
  HDPlayer: "HDPlayer操作视频",
  HDShow: "HD Show 操作视频",
  HDSign: "单双色节目编辑",
  HD2020: "HD2020操作",
  PingZhangKong: "APP基本操作",
  XiaoHuiYun: "小灰云操作教程"
};
function videoView(v) {
  return { name: String(v.name || "").replace(/\.mp4$/i, ""), url: v.publicUrl, sizeText: sizeText(v.sizeBytes) };
}
function buildVideos(swId) {
  const list = videoItemsOf(swId);
  if (!list.length) return { primary: null, more: [] };
  const hint = PRIMARY_HINT[swId];
  let pi = hint ? list.findIndex((v) => String(v.name || "").includes(hint)) : -1;
  if (pi < 0) pi = 0;
  const primary = videoView(list[pi]);
  // 软件卡只保留 1 个最通用的使用说明教学（primary）；其余视频不挂软件卡，仍在「视频」分类按主题全量可查
  const more = [];
  return { primary, more };
}
function buildManuals(swId) {
  if (!MANUAL_MANIFEST || !Array.isArray(MANUAL_MANIFEST.items)) return [];
  return MANUAL_MANIFEST.items
    .filter((m) => m && m.softwareId === swId && m.status === "uploaded")
    .map((m) => ({ label: m.label, url: m.publicUrl }));
}

// 对外视图对象（补全下载地址 / 视频 / 中文说明书；无 PC 下载器的 APP、云平台 downloadUrl 为空）
function toView(s) {
  const grp = groupOfId(s.id);
  return {
    id: s.id, name: s.name, version: s.version, line: s.line,
    group: grp.key, groupLabel: grp.label,
    purpose: s.purpose,
    hasDownloader: !!s.file,
    downloadUrl: s.file ? downloadUrlOf(s) : "",
    downloadFile: s.file || "",
    manualUrl: s.manualUrl || "", manualLabel: s.manualLabel || "",
    mobile: s.mobile || null,
    manuals: buildManuals(s.id),
    videos: buildVideos(s.id)
  };
}

// 组装软件回答：命中具体软件→逐个给“用途+下载+资料”；只泛问→给软件清单
// 返回 { reply(企微/兜底 markdown), items(结构化，网页渲染), isList }
function buildSoftwareAnswer(message) {
  const matched = matchSoftware(message);
  if (matched.length) {
    const items = matched.map(toView);
    const L = [];
    items.forEach((s, i) => {
      L.push(`【${s.name} ${s.version}】`);
      L.push(`· 用途：${s.purpose}`);
      if (s.videos && s.videos.primary) {
        L.push(`· 操作视频（手机在线看，含全部演示）：[点我看「${s.name}」视频与资料](${watchUrl(s.name)})`);
      }
      if (s.manuals && s.manuals.length) {
        L.push(`· 中文使用说明书：`);
        s.manuals.forEach((m) => L.push(`    - [${m.label}](${m.url})`));
      }
      if (s.hasDownloader) {
        L.push(`· 电脑下载：[点此下载 ${s.name}](${s.downloadUrl})（下载后运行，按提示联网完成安装）`);
      } else if (s.mobile) {
        const mb = s.mobile;
        if (mb.webUrl) L.push(`· 网页版（免安装）：[${mb.webLabel}](${mb.webUrl})；${mb.webNote || ""}`);
        if (mb.iosUrl) L.push(`· 手机下载（iPhone）：[${mb.iosLabel}](${mb.iosUrl})`);
        if (mb.androidUrl) L.push(`· 安卓：[${mb.androidLabel}](${mb.androidUrl})`);
        if (mb.storeHint) L.push(`· ${mb.storeHint}`);
      } else {
        L.push(`· ${s.name}为${s.line}，无电脑下载器，请在手机应用商店搜索安装或查看上方说明书。`);
      }
      if (s.manualUrl) L.push(`· 官网资料：[${s.manualLabel}](${s.manualUrl})`);
      if (i < items.length - 1) L.push("");
    });
    L.push("");
    L.push("安装或操作中有问题，直接在这里描述现象即可。");
    return { reply: L.join("\n"), items, isList: false };
  }
  // 泛问：列出 HD 自有软件全家桶（含手机 APP、云平台），列表保持精简，详情点“视频/资料”或回复软件名
  const items = SOFTWARE_GROUPS.flatMap((g) => g.ids.map((id) => SOFTWARE.find((x) => x.id === id)).filter(Boolean).map(toView));
  const L = ["灰度 HD 软件全家桶如下，回复软件名可看用途、操作视频、说明书和下载：", ""];
  let __lastGrp = "";
  items.forEach((s) => {
    if (s.group && s.group !== __lastGrp) { if (__lastGrp) L.push(""); L.push("【" + s.groupLabel + "】"); __lastGrp = s.group; }
    // 手机 APP / 云平台已由分组标题标注，清单行不再放版本/分类括号与下载尾标，避免重复
    const dl = s.hasDownloader ? ` [下载](${s.downloadUrl})` : "";
    const tag = s.hasDownloader ? `（${s.version} · ${s.line}）` : "";
    const media = (s.videos.primary || s.manuals.length) ? ` [视频/资料](${watchUrl(s.name)})` : "";
    L.push(`· **${s.name}**${tag}${dl}${media}`);
  });
  L.push("");
  L.push(`也可到官网下载中心查看：[灰度下载中心](${DOWNLOAD_CENTER})`);
  return { reply: L.join("\n"), items, isList: true };
}

module.exports = {
  SOFTWARE,
  SOFTWARE_GROUPS,
  groupOfId,
  downloadUrlOf,
  matchSoftware,
  isSoftwareIntent,
  isSoftwareAcquire,
  toView,
  buildSoftwareAnswer,
  DOWNLOAD_CENTER
};
