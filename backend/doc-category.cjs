// 资料分类浏览：把硬件型号确定性归到客户能看懂的大类。
// 判定优先级（关键：产品描述常“提到”别的设备，如“A4 与接收卡之间用网线”，不能因此被带偏）：
//  0) 型号即配件/传感器，最先判；
//  1) 品类稳定的型号前缀直接定性（R/K=接收卡、T=发送、A/B/H=播放盒、VP/KV/VS/H264H265=处理器、
//     VM/MS/DCS=矩阵服务器、D=单双色门头、纯数字=安卓板、WF=传感器）；
//  2) 品类混杂前缀（W/E/U/S/C）用官方“定性句”区分：先判“是传感器/外接传感器/百叶箱”，
//     再判“是单双色/Wi-Fi/USB/门头控制卡”，避免控制卡“可显示温湿度”被误判成传感器；
//  3) 剩余 C 前缀兜底控制板；
//  4) 真判不出落“其他设备”，绝不臆造。
// 纯函数、零运行时依赖，可被 server 端点与离线单测同时引用。

const DOC_CATEGORIES = [
  { key: "receiver",   label: "接收卡" },
  { key: "player",     label: "异步播放盒 · 播放器" },
  { key: "board",      label: "异步控制板 · 安卓主板" },
  { key: "processor",  label: "视频处理器 · 拼接器" },
  { key: "sender",     label: "发送卡 · 发送盒" },
  { key: "matrix",     label: "矩阵 · 服务器 · 分布式" },
  { key: "mono",       label: "单双色 · 门头屏控制卡" },
  { key: "sensor",     label: "传感器 · 环境监测" },
  { key: "accessory",  label: "控制器 · 配件周边" },
  { key: "other",      label: "其他设备" }
];
const DOC_CATEGORY_LABEL = Object.fromEntries(DOC_CATEGORIES.map((c) => [c.key, c.label]));

function bareModel(name) {
  return String(name || "").toUpperCase().replace(/^HD[-_ ]?/i, "").replace(/\s+/g, "");
}

// 显式配件/周边型号（型号即定性）
const ACCESSORY_EXACT = new Set([
  "USB_HUB", "USB无线传屏器", "IR-SENSOR", "T568B", "T600", "T600A", "Y1", "SN1",
  "FT01", "FT08", "HT01", "HT02", "AP0X0X", "K524CONNECTION"
]);

function classifyDocModel(name, seriesText) {
  const m = bareModel(name);
  const t = " " + String(seriesText || "") + " ";

  // ---- 0) 型号即配件 / 传感器 ----
  if (ACCESSORY_EXACT.has(m)) return "accessory";
  if (/^USB/.test(m) || /^IR[-_]/.test(m)) return "accessory";
  if (m === "K524") return "sensor"; // K524 专用亮度传感器（非接收卡）

  // ---- 1) 品类稳定前缀：型号即品类 ----
  if (/^(RB|RP)/.test(m) || /^R\d/.test(m) || /^R[A-Z]\d/.test(m) || /^R[A-Z]{1,2}$/.test(m)) return "receiver";
  if (/^K(08|12|0|1|6)\b/.test(m) || /^K(08|12)$/.test(m) || /^K[016]$/.test(m)) return "receiver"; // K08/K12/K0/K1/K6
  if (/^VM/.test(m) || /^MS/.test(m) || /^DCS/.test(m)) return "matrix";
  if (/^(VP|KV|VS)/.test(m) || /^H26[45]/.test(m)) return "processor";
  if (/^T\d/.test(m) || /^T$/.test(m)) return "sender"; // T08/T16/T90/T901/T902/T0（T600/T568B 已在配件拦截）
  if (/^A[3-8](L|LS)?(\D|$)/.test(m) || /^A[3-8]LS$/.test(m)) return "player"; // A3/A3L…A8 全系播放盒
  if (/^B[A-Z0-9]/.test(m) || /^B\d/.test(m)) return "player"; // B 系列双模/异步播放盒、海报屏、广告机
  if (/^H(4K|4|5|6|8|16|20)\b/.test(m) || /^H\d/.test(m)) return "player"; // H 系列多媒体播放盒（H264/H265 已处理器）
  if (/^D\d/.test(m) || /^D[0-9]/.test(m)) return "mono"; // D 系列单双色/门头控制卡
  if (/^WF/.test(m)) return "mono"; // WF 系列是单双色 Wi-Fi 门头控制卡（“外接传感器”是其可外接传感器的能力，非传感器本体）
  if (/^S(40|70|90|107|108|207|208)$/.test(m)) return "sensor"; // S 系列明确的亮度/多功能传感器与百叶箱
  if (/^E7$/.test(m)) return "sensor"; // E7 一体式百叶箱环境监测
  if (/^\d/.test(m)) return "board"; // 纯数字 RK 方案安卓主板 / BOX

  // ---- 1.5) 官方配单工具「产品系列」标签（selector 规整结构化字段，最高置信兜底）----
  // 必须晚于上面的稳定型号前缀：A/B/H 播放盒形态（含官方写作“广告机版卡/中小屏异步控制板”的 A3L/A4L/B6L，
  // 已与何铠江拍板“都算异步播放盒”、客户也按播放盒找资料）已在前缀步定为 player，不被官方板卡标签带走；
  // 此处只给前缀混杂（W/E/U/S/C）或无前缀的型号一个官方锚点，以官网为准。
  const osMatch = t.match(/产品系列[：:]\s*([^\s，,。;；)]+)/);
  if (osMatch) {
    const os = osMatch[1];
    if (/视频处理器|视频拼接器|拼接器/.test(os)) return "processor";
    if (/同步发送卡|发送卡|发送盒/.test(os)) return "sender";
    if (/多媒体播放盒|双模播放器|4K播放器|播放盒|播放器/.test(os)) return "player";
    if (/中小屏异步控制板|广告机版卡|异步控制板|安卓主板|安卓/.test(os)) return "board";
    if (/Wi-?Fi控制卡|网口控制卡|U盘控制卡|门头屏控制卡|控制卡/.test(os)) return "mono";
    if (/多媒体服务器|分布式系统|分布式|矩阵/.test(os)) return "matrix";
    if (/接收卡/.test(os)) return "receiver";
    if (/中央控制器|控制器/.test(os)) return "accessory";
  }

  // 定性句正则
  // 单双色窄定性（C 系列用）：只认真“门头/单双色/条屏招牌”，避免全彩控制板说明书里的英文 control card 误伤
  const MONO_NARROW = /单双色|单色\s*LED|双色\s*LED|门头|条屏|招牌|single\s?\/?\s?dual|monochrome|door\s?header|store\s?sign|banner\s?screen/i;
  // 单双色宽定性（W/E/U/WF 系列用）：规格表虽写“外接传感器：温湿度…”，但那是控制卡可外接传感器的能力，本体是 control card
  const MONO_RE = new RegExp(MONO_NARROW.source + "|wi-?fi控制卡|wi-?fi\\s*control|usb接口通信|usb\\s*interface|u\\s?盘更新节目|control\\s*card|核心板|core part", "i");
  // 传感器：只认“自身是传感器/百叶箱”的定性句，不认控制卡规格表里的“外接传感器：”能力字段
  const SENSOR_RE = /百叶|one-?piece\s*shutter|shutter|environmental\s*detection|是一款[^。]{0,14}传感器|亮度传感|多功能传感|brightness sensor|multifunctional sensor|sensor\s?box|亮度随周围|随周围环境亮度/i;

  // ---- 2) 品类混杂前缀（W/E/U/S/C）：官方“定性句” ----
  // 2.0) C 系列是控制卡：仅门头/单双色窄定性归 mono，其余一律全彩异步控制板，不参与传感器/发送（描述会提到外接传感器/发送设备）
  if (/^C\d/.test(m)) return MONO_NARROW.test(t) ? "mono" : "board";
  // 2a) 先认“控制卡”强定性（单双色/Wi-Fi/USB/门头控制卡“可外接传感器”，不能因提到传感器误判）
  if (MONO_RE.test(t)) return "mono";
  // 2b) 再认“自身是传感器”强定性
  if (SENSOR_RE.test(t)) return "sensor";
  // 2c) 异步控制板 / 安卓主板
  if (/异步控制板|中小屏异步|控制板|安卓|android|主板|rockchip|rk\d/i.test(t)) return "board";
  // 2d) 其余品类（接收卡已被 R/K 前缀全覆盖，此处不再用宽泛“接收卡”字样，避免“提到接收卡”误判）
  if (/分布式|矩阵|多媒体服务器|播放服务器/.test(t)) return "matrix";
  if (/视频处理器|三合一|二合一|拼接器|视频处理|视频分配|同步信号输入|路同步信号/.test(t)) return "processor";
  if (/发送盒|发送卡|同步发送|发送设备|sending card|gigabit network port output/i.test(t)) return "sender";
  if (/海报屏|广告机|播放盒|播放器|多媒体播放|4k播放|双模播放|信发/.test(t)) return "player";
  if (/传感器/.test(t)) return "sensor"; // 弱传感器措辞兜底
  if (/lte\s?模块|4g模块|mini\s?pcie|lte module/i.test(t)) return "accessory"; // 通信模块配件
  if (/中央控制器|ktv|智能控制器|综合控制/.test(t)) return "accessory";

  // ---- 3) 真判不出 ----
  return "other";
}

module.exports = { DOC_CATEGORIES, DOC_CATEGORY_LABEL, bareModel, classifyDocModel };
