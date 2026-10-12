"use strict";
/*
 * 小灰机 · 长条（条形/带状/门头/货架/横幅/橱窗）LED 屏异步打折配单 —— 独立确定性模块
 * ----------------------------------------------------------------------------
 * 设计红线（与《长条屏打折方案汇总 V3.3》《异步全彩产品选型 V3.1》《Cx6打折说明》
 * 《Screen Discount Instructions》一致）：
 *  1) 本模块不查库、不调模型、不重新解析自然语言；只读常规引擎已算好的确定性 result
 *     （screenW/H、cols/rows、moduleW/H、input.pitch/controlMode/colorMode、preset）。
 *  2) 长条异步优先：CX6(户外矮条) → C16L(室内HUB75) → A3L/A4L/A5L/A6L → B8L/A8(异步播放盒)
 *     →（客户未指定异步时兜底）同步 VPX20 打折；单机折叠盖不住 / 要拼接机箱 → 转人工。
 *  3) 盒/卡带载为教学权威常量（内置），不读设备库 JSON（设备库 C16C/C36 物理极限与其矛盾，
 *     长条一律以教学 PPT 为准）。
 *  4) 卡数只在能被标准开输出卡区整除时给精确值，否则只给主控+折后画布+网口并注明以
 *     HDSet 复杂模式一键连屏文件为准——绝不硬编一个可能错的数。
 *  5) 规整矩阵屏不命中（match:false），原样走常规引擎，零回归。
 */

const WAN = 10000;
// 单网口不打折长条 = 标准一行接收卡网格，复用统一纯拓扑（随列加宽、每卡四行高清、灯箱/下载/企微一致）
const { renderTopoOnly } = require("./topo-hdset.cjs");

// 长条全彩统一推荐接收卡 R712（HUB75E×12，推荐带载 256×1024≈26.2万）
const R712 = { name: "R712", hubPorts: 12, recW: 256, recH: 1024, maxPoints: 256 * 1024 };
const CARD_AREA_384x256 = 384 * 256; // 三开标准卡区（大播放盒/同步VPX20通用；教学：3板宽×4板高=384×256=98304）
const PORT_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#dc2626", "#ca8a04", "#4f46e5", "#0d9488", "#be185d", "#854d0e", "#1d4ed8", "#15803d", "#c2410c", "#7e22ce", "#0e7490"];

// 盒/控制器权威带载（像素）。foldWidth=打折宽，maxPoints=折后画布总点上限，physW/H=物理极限
const CX6 = {
  C16C: { maxPoints: 640 * 320, physW: 8192, physH: 512, cardStripW: 384 },   // 20.48万
  C36C: { maxPoints: 1024 * 512, physW: 8192, physH: 1024, cardStripW: 256 },  // 52.43万
};
const CX6_FOLDS = [1024, 768, 512]; // 画布仅支持的三组打折宽（档宽，算带载按此计）
const C16L = { name: "C16L", maxPoints: 1280 * 510, physW: 8192, physH: 1920, foldW: 1920, foldWCustom: 2048 };
const A_SERIES = [ // ports=物理千兆网口（级联）路数：A3L 1路、A4L 2路、A5L 2路、A6L 4路
  { name: "A3L", maxPoints: 655360, physW: 8192, physH: 3840, ports: 1 },
  { name: "A4L", maxPoints: 655360, physW: 16384, physH: 4096, ports: 2 },
  { name: "A5L", maxPoints: 1310720, physW: 16384, physH: 4096, ports: 2 },
  { name: "A6L", maxPoints: 2600000, physW: 16384, physH: 4096, ports: 4 },
];
const PER_PORT_POINTS = 655360; // A 系列单网口带载上限 65万
const A_MAX_PORT_WIDTH = 4096;  // A 系列连接设置单行最宽
// 异步播放盒（官方配单工具 data.huidu.cn/selection-tool 的 playBox 表，字段逐字取自官方 bundle）。
// 选档严格复刻官网 ComputePlayBoxFilterRules + 打折 P()：设备按 totalPoints 升序（即下表顺序），逐机型从
// 最小折数 D=ceil(长/discount.minWidth) 起逐档试，取第一个「折后画布≤canvasPoint 且所需网口≤cascadePort」的
// 机型与折法（表首=最小满足档）。候选池再按「场景」收窄（见下方 PLAYBOX_SCENES，1:1 复刻官网过滤）：
// 客户默认「通用 A 系列」，只在 A4L/A5L/A6L/A7/A8 里取表首（故 15360×256=393万 默认给 A7，而非会议档 H6）；
// 点「会议屏」只留 H6/H8（官网 meetingScreen），点「海报屏」只留 B6L/A6L/B8L（官网 posterScreen）。
// 红线：H4K 是 LED&LCD 4K 多媒体“播放器”（作信号源接处理器、可替换成笔记本），不开千兆网口、不直接带接收卡，
//       不是 LED 带载主控，绝不能作为长条主控推荐，故不在此表。
// 字段：totalPoints 总点、ports=cascadePort 物理千兆口、minWidth=打折最小折宽、canvas=discount.canvasPoint 折后画布上限、maxWidth。
const OFFICIAL_PLAYBOX = [
  { name: "A4L", totalPoints: 655360,  ports: 1,  minWidth: 4096, canvas: 655360,  maxWidth: 16384 }, // 65万/1口
  { name: "A5L", totalPoints: 1310720, ports: 2,  minWidth: 4096, canvas: 1310720, maxWidth: 16384 }, // 131万/2口
  { name: "B6L", totalPoints: 2603520, ports: 2,  minWidth: 4096, canvas: 1310720, maxWidth: 16384 }, // 260万/2口（海报屏候选）
  { name: "A6L", totalPoints: 2621440, ports: 4,  minWidth: 4096, canvas: 2621440, maxWidth: 65536 }, // 262万/4口（海报屏候选）
  { name: "H6",  totalPoints: 3932160, ports: 6,  minWidth: 4096, canvas: 3932160, maxWidth: 65536 }, // 393万/6口（会议屏候选）
  { name: "A7",  totalPoints: 5160960, ports: 8,  minWidth: 3840, canvas: 5160960, maxWidth: 65536 }, // 516万/8口
  { name: "H8",  totalPoints: 5242880, ports: 8,  minWidth: 4096, canvas: 5242880, maxWidth: 65536 }, // 524万/8口（会议屏候选）
  { name: "B8L", totalPoints: 5242880, ports: 8,  minWidth: 4096, canvas: 5242880, maxWidth: 65536 }, // 524万/8口（海报屏候选）
  { name: "A8",  totalPoints: 8294400, ports: 16, minWidth: 3840, canvas: 8294400, maxWidth: 65536 }, // 829万/16口
];
// 异步播放盒场景白名单（1:1 复刻官网 ComputePlayBoxFilterRules 的 posterScreen/meetingScreen 过滤）：
// 官网默认（两个场景都不勾）是全集取表首；小灰机按客户偏好把默认收窄为「通用 A 系列」（A 开头的播放盒）。
// 场景只过滤播放盒 playBox，不影响 CX6/C16L/A 系列直连与同步处理器。
const PLAYBOX_SCENES = {
  official: { label: "官方默认", models: null },  // 官网两个场景都不勾＝打折播放盒全集取表首（小灰机默认，与官网 1:1）
  generic: { label: "通用A系列", models: ["A4L", "A5L", "A6L", "A7", "A8"] },
  meeting: { label: "会议屏", models: ["H6", "H8"] },                          // 官网 meetingScreen
  poster: { label: "海报屏", models: ["B6L", "A6L", "B8L"] },                   // 官网 posterScreen
};
function playBoxPool(scene) {
  const sc = PLAYBOX_SCENES[scene] || PLAYBOX_SCENES.official;
  if (!sc.models) return OFFICIAL_PLAYBOX.slice(); // 官方默认：9 款打折播放盒全集（已按 totalPoints 升序）
  return OFFICIAL_PLAYBOX.filter((d) => sc.models.includes(d.name));
}

const SYNC_FOLD_W = 3840; // VPX20 4K 输入最宽
const SYNC_PROCESSORS = [ // 同步处理器：按网口数与带载选最省
  { name: "VP210", ports: 2, maxPoints: 1300000 },
  { name: "VP410", ports: 4, maxPoints: 2600000 },
  { name: "VP620", ports: 6, maxPoints: 3900000 },
  { name: "VP820", ports: 8, maxPoints: 5200000 },
  { name: "VP1620", ports: 16, maxPoints: 10400000 },
];

const STRIP_WORD_RE = /长条|条形|带状|条屏|门头|货架|横幅|橱窗|长屏|飘眉|眉条|走字横幅/;
const ceilDiv = (a, b) => Math.ceil(a / b);
const alignFloor = (v, step) => (step > 0 ? Math.floor(v / step) * step : v);
const wan = (n) => (n / WAN).toFixed(2);

function detectStrip(r, raw) {
  if (!r || !r.ok) return { isStrip: false };
  const inp = r.input || {};
  if (inp.colorMode && inp.colorMode !== "full") return { isStrip: false };     // 单/双色直连不走
  // 注意：全彩异步直连卡（C16C/C36C 等 CX6，directControllerMode=true）恰恰是户外单元板矮条的正解，不能排除；
  // 单双色已由上面 colorMode 拦住。仅排除箱体租赁屏与拼接机箱。
  if (r.cabinetMode || r.isSplicer) return { isStrip: false };
  const { screenW: W, screenH: H, cols, rows } = r;
  if (!W || !H || !cols || !rows) return { isStrip: false };
  const pitch = Number(inp.pitch) || 0;
  const outdoor = pitch >= 6; // P8/P10 户外单元板矮条；P<6 室内 HUB75 模组
  const byWord = STRIP_WORD_RE.test(String(raw || ""));
  // 几何：物理宽>1920、物理高≤400点（矮条，覆盖 P10 五板高80点 / A6L例344点）、长宽比≥8
  const byGeom = W > 1920 && H <= 400 && W / H >= 8;
  return { isStrip: byWord || byGeom, outdoor, pitch, reason: byWord ? "word" : "geom" };
}

// —— CX6（户外单元板矮条）：枚举 1024/768/512 三档 × C16C/C36C，取盒最省、折数最少 ——
function tryCX6(c) {
  const candidates = [];
  for (const foldBase of CX6_FOLDS) {
    const foldW = Math.max(alignFloor(foldBase, c.mw), c.mw); // 按模组像素对齐
    const folds = ceilDiv(c.W, foldW);
    const foldedH = c.H * folds;
    const points = foldBase * foldedH; // 教学：算带载宽按档宽(256取整)计
    for (const [devName, dev] of Object.entries(CX6)) {
      if (c.W > dev.physW || c.H > dev.physH) continue;
      if (points > dev.maxPoints || foldedH > dev.physH) continue;
      candidates.push({ rank: devName === "C16C" ? 0 : 1, folds, points, devName, foldBase, foldW, foldedH });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.rank - b.rank || a.folds - b.folds || a.points - b.points);
  const x = candidates[0];
  const zones = [];
  for (let i = 0; i < x.folds; i++) {
    const segPhysW = Math.min(x.foldW, c.W - i * x.foldW);
    zones.push({ label: `折${i + 1}`, physW: segPhysW, foldW: x.foldBase, foldH: c.H, cards: null });
  }
  return {
    family: "CX6", controller: { name: x.devName, qty: 1 }, receiver: null,
    folds: x.folds, foldW: x.foldBase, foldedH: x.foldedH, foldedPoints: x.points,
    ports: x.folds, zones,
    setting: `屏幕打折宽设 ${x.foldBase}（折 ${x.folds} 折，折后画布 ${x.foldBase}×${x.foldedH}，约${wan(x.points)}万点），在 HDSet 复杂模式按折后画布排布。`,
    cardNote: `接收卡按折后画布在 HDSet 复杂模式自动排布（${x.devName} 每卡约 ${CX6[x.devName].cardStripW} 像素宽），具体张数与连线以一键生成的连屏文件为准。`,
  };
}

// —— C16L（室内 HUB75 长条）：折宽1920，复杂模式横排，每折 1 张 R712 ——
function tryC16L(c) {
  const foldW = Math.max(alignFloor(C16L.foldW, c.mw), c.mw);
  const folds = ceilDiv(c.W, foldW);
  const foldedH = c.H * folds;
  const points = foldW * foldedH;
  if (c.W > C16L.physW || foldedH > C16L.physH) return null;
  if (points > C16L.maxPoints) return null;
  if (foldW * c.H > R712.maxPoints) return null; // 每折区一张 R712 带得下（否则降 A 系列）
  const zones = [];
  let r = 0;
  for (let i = 0; i < folds; i++) {
    const segPhysW = Math.min(foldW, c.W - i * foldW);
    r += 1;
    zones.push({ label: `折${i + 1}`, physW: segPhysW, foldW, foldH: c.H, cards: 1, rStart: r, rEnd: r });
  }
  return {
    family: "C16L", controller: { name: "C16L", qty: 1 }, receiver: { name: "R712", count: folds },
    folds, foldW, foldedH, foldedPoints: points, ports: folds, zones,
    setting: `屏幕打折宽设 ${foldW}（折 ${folds} 折，折后高 ${foldedH}，折后画布约 ${foldW}×${foldedH}）；HDSet≥3.0.19.0、HDPlayer≥7.10.26.0，复杂模式横排。`,
    cardNote: `每折 1 张 R712 在复杂模式横排带该折区，共 ${folds} 张；连屏文件可按 HUB 口数微调。`,
  };
}

// —— A3L/A4L/A5L/A6L：物理网口切分（单口≤65万、单行≤4096），折数=网口数，二开/三开配卡 ——
function tryA(c) {
  let maxBoards = Math.floor(PER_PORT_POINTS / c.H / c.mw); // 单口最多带几块板宽
  let portWidth = maxBoards * c.mw;
  if (portWidth > A_MAX_PORT_WIDTH) { maxBoards = Math.floor(A_MAX_PORT_WIDTH / c.mw); portWidth = maxBoards * c.mw; }
  if (maxBoards < 1) return null;
  const ports = ceilDiv(c.cols, maxBoards);
  // 均分板宽（末口可少）
  const boards = [];
  let remain = c.cols;
  for (let i = 0; i < ports; i++) {
    const b = Math.min(maxBoards, Math.ceil(remain / (ports - i)));
    boards.push(b); remain -= b;
  }
  const foldedH = c.H * ports;
  // 每卡横带板宽上限 nMax：纵带 rows 板高，受 R712 的 12 个 HUB 口（n×rows≤12）与单卡 26 万点约束
  let nMaxCard = 1;
  for (let n = R712.hubPorts; n >= 2; n--) {
    if (n * c.rows <= R712.hubPorts && n * c.mw * c.H <= R712.maxPoints) { nMaxCard = n; break; }
  }
  // 口内配卡：优先每卡等板宽（口内板宽能被 n 整除，排布整齐、与官方口径一致）；
  // 找不到整除时（网口均分后末口常是 31 这类质数块数），不再退化成“一卡只带 1 板宽”把卡数撑爆，
  // 改为每卡 nMax 板宽 + ceil，末卡少带几块（连屏文件允许末卡不满配）。
  function cardLayout(bpp) {
    for (let n = nMaxCard; n >= 2; n--) {
      if (bpp % n === 0) return { n, cards: bpp / n, partial: false };
    }
    const cards = Math.max(1, Math.ceil(bpp / nMaxCard));
    return { n: nMaxCard, cards, partial: cards > 1 }; // cards>1 时末卡必不满 nMax 板宽
  }
  const dev = A_SERIES.find((d) => c.W <= d.physW && foldedH <= d.physH && c.total <= d.maxPoints
    && ports <= d.ports && boards[0] * c.mw <= A_MAX_PORT_WIDTH);
  if (!dev) return null;
  const zones = [];
  let r = 0;
  let totalCards = 0;
  let anyPartial = false;
  for (let i = 0; i < ports; i++) {
    const bpp = boards[i];
    const L = cardLayout(bpp);
    if (L.partial) anyPartial = true;
    const rStart = r + 1, rEnd = r + L.cards;
    r = rEnd; totalCards += L.cards;
    zones.push({ label: `网口${i + 1}`, physW: bpp * c.mw, foldW: bpp * c.mw, foldH: c.H, cards: L.cards, rStart, rEnd, n: L.n, partial: L.partial });
  }
  const n0 = zones[0] ? zones[0].n : 1;
  const cards0 = zones[0] ? zones[0].cards : 0;
  const leadW = boards[0] * c.mw;
  const setting = ports === 1
    ? `整屏 ${leadW}×${c.H}（约${wan(c.total)}万点）在单网口 65万带载内、单行宽≤4096，无需屏幕打折；在 控制-设备信息 输 hdadmin 开自定义画布（主版本≥7.6.40），按整屏 ${c.W}×${c.H} 点对点。`
    : `超 1920×1080 在 控制-设备信息 输 hdadmin 开自定义画布（主版本≥7.6.40）；连接设置单行最宽 4096，按 ${ports} 个网口折 ${ports} 折，折后画布约 ${leadW}×${foldedH}。`;
  let cardNote;
  if (ports === 1) {
    cardNote = `单网口带 ${boards[0]} 块模组宽，每张 R712 带 ${n0} 块宽×${c.rows} 块高模组，共 ${totalCards} 张。`;
  } else if (!anyPartial) {
    cardNote = `每个网口带 ${boards[0]} 块模组宽，每张 R712 带 ${n0} 块宽×${c.rows} 块高模组、每口 ${cards0} 张，共 ${totalCards} 张。`;
  } else {
    cardNote = `每张 R712 最多带 ${nMaxCard} 块宽×${c.rows} 块高模组，${ports} 个网口共 ${totalCards} 张；各网口余下的零头模组由最后一张卡带，最终以 HDSet 一键连屏文件排布为准。`;
  }
  return {
    family: "A", controller: { name: dev.name, qty: 1 }, receiver: { name: "R712", count: totalCards },
    folds: ports, foldW: leadW, foldedH, foldedPoints: c.total, ports, zones,
    outputsN: n0, setting, cardNote,
  };
}

// —— 异步播放盒(B8L/A8) / 同步 VPX20 共用：折宽3840，一折点超65万则该折占多口 ——
function fold3840(c) {
  const folds = ceilDiv(c.W, 3840);
  const foldedH = c.H * folds;
  const points = 3840 * foldedH;
  const portsPerFold = Math.max(1, ceilDiv(3840 * c.H, PER_PORT_POINTS));
  const ports = portsPerFold * folds;
  // 卡数：折后画布能被三开标准卡区 384×256 整除才给精确值
  let cards = null;
  if (foldedH % 256 === 0 && points % CARD_AREA_384x256 === 0) cards = points / CARD_AREA_384x256;
  const zones = [];
  let r = 0;
  const perPortW = Math.floor(3840 / portsPerFold);
  const cardsPerZone = cards ? cards / ports : null;
  for (let f = 0; f < folds; f++) {
    for (let p = 0; p < portsPerFold; p++) {
      const zi = zones.length + 1;
      const z = { label: `网口${zi}`, physW: Math.min(perPortW, c.W - (zi - 1) * perPortW), foldW: perPortW, foldH: c.H };
      if (cardsPerZone) { z.cards = cardsPerZone; z.rStart = r + 1; z.rEnd = r + cardsPerZone; r += cardsPerZone; }
      else z.cards = null;
      zones.push(z);
    }
  }
  return { folds, foldedH, points, portsPerFold, ports, cards, zones };
}

// 官方 playBox 打折选档（复刻官网 selection-tool 打折 P()）：逐机型（表序）×逐折数 D 找首个可行，返回表首。
// 每折宽 M=对齐模组的 ceil(长/D)；折后画布 M×高×D ≤ canvas；每折网口 ae=ceil(折宽模组 / 单口宽向模组容量 te)，
// 另用 he=ceil(每折点/655360) 兜底，要求 he×D 与 ae×D 都 ≤ 机型物理网口 cascadePort。
function officialFoldPlayBox(c, scene = "official") {
  for (const dev of playBoxPool(scene)) {
    if (c.W > dev.maxWidth || !dev.minWidth) continue;
    const I0 = Math.ceil(c.W / dev.minWidth);
    const Smax = Math.min(32, c.cols);
    const cp = dev.ports;
    for (let D = I0; D < Smax; D++) {
      const M = Math.ceil(Math.ceil(c.W / D) / c.mw) * c.mw; // 折宽，向上对齐到模组像素
      if (M * c.H * D > dev.canvas) break;                  // 折后画布超 canvasPoint（D 再增 M 递减，官方此处 break）
      if (!(cp >= D)) continue;
      const perFoldPts = M * c.H;
      const he = Math.ceil(perFoldPts / PER_PORT_POINTS);
      const te = Math.floor(Math.floor(PER_PORT_POINTS / c.H) / c.mw); // 单口宽向可容纳模组数
      if (te < 1) continue;
      const ae = Math.ceil(Math.ceil(M / c.mw) / te);                 // 每折所需网口
      if (he * D <= cp && ae * D <= cp) {
        return { dev, folds: D, foldW: M, portsPerFold: ae, ports: ae * D, foldedPoints: M * c.H * D };
      }
    }
  }
  return null;
}

function tryPlayBox(c, scene = "official") {
  const pick = officialFoldPlayBox(c, scene);
  if (!pick) return null; // 全表到 A8(829万/16口) 都盖不住 → 交同步 VPX 兜底，仍不行转人工
  const { dev, folds, foldW, portsPerFold, ports } = pick;
  const foldedH = c.H * folds;
  // R712 三开配卡：每卡宽向最多带 nMax 块模组（n×rows≤12 个 HUB 口、n×mw×H≤26万），逐口 ceil（同官方 C() 宽支）
  let nMax = 0;
  for (let n = R712.hubPorts; n >= 1; n--) {
    if (n * c.rows <= R712.hubPorts && n * c.mw * c.H <= R712.maxPoints) { nMax = n; break; }
  }
  const canCard = nMax >= 1;
  const zones = [];
  let r = 0, totalCards = 0;
  for (let f = 0; f < folds; f++) {
    const segPhys = Math.min(foldW, c.W - f * foldW);     // 末折用物理余量
    const segBoards = Math.round(segPhys / c.mw);
    const Lb = Math.ceil(segBoards / portsPerFold), Kb = Math.floor(segBoards / portsPerFold), Tb = segBoards % portsPerFold;
    for (let p = 0; p < portsPerFold; p++) {
      const boards = p < Tb ? Lb : Kb;                    // 官网：前 Tb 口 ceil、其余 floor
      const physW = boards * c.mw;
      const z = { label: `网口${zones.length + 1}`, physW, foldW: physW, foldH: c.H };
      if (canCard) {
        const cards = Math.max(1, Math.ceil(boards / nMax));
        z.cards = cards; z.rStart = r + 1; z.rEnd = r + cards; r += cards; totalCards += cards;
      } else {
        z.cards = null;
      }
      zones.push(z);
    }
  }
  const receiver = canCard ? { name: "R712", count: totalCards } : null;
  return {
    family: "PLAYBOX", controller: { name: dev.name, qty: 1 }, receiver,
    folds, foldW, foldedH, foldedPoints: pick.foldedPoints, ports, zones,
    setting: `${dev.name} 异步播放盒，屏幕打折宽设 ${foldW}（${folds} 折，折后画布 ${foldW}×${foldedH}，约${wan(pick.foldedPoints)}万点），每折 ${portsPerFold} 口、共 ${ports} 路网口；在 HDPlayer 控制-设备信息-屏幕打折里设置。`,
    cardNote: receiver
      ? `折后画布按每张 R712 带 ${nMax} 块宽×${c.rows} 块高模组（三开卡区）排布，共 ${totalCards} 张；${dev.name} 自带 ${dev.ports} 路网口，本方案用 ${ports} 口。`
      : `接收卡按折后画布在 HDSet 复杂模式排布（${dev.name} 共 ${dev.ports} 路网口，本方案用 ${ports} 口），具体张数以一键连屏文件为准。`,
  };
}

function trySync(c) {
  const f = fold3840(c);
  const proc = SYNC_PROCESSORS.find((p) => p.ports >= f.ports && p.maxPoints >= f.points);
  if (!proc) return null; // 口数>16 或带载盖不住 → 多机/拼接 → 转人工
  return {
    family: "SYNC", controller: { name: proc.name, qty: 1 }, receiver: f.cards ? { name: "R712", count: f.cards } : null,
    folds: f.folds, foldW: 3840, foldedH: f.foldedH, foldedPoints: f.points, ports: f.ports, zones: f.zones,
    setting: `同步打折：4K 输入最宽 3840，屏幕打折宽设 3840（${f.folds} 折，折后画布 3840×${f.foldedH}）；一折 3840×${c.H}=${wan(3840 * c.H)}万点${f.portsPerFold > 1 ? `，超过单口65万，该折占 ${f.portsPerFold} 口` : ""}，共 ${f.ports} 路网口。`,
    cardNote: f.cards
      ? `折后画布按每张 R712 带 384×256 像素分区排布，共 ${f.cards} 张 R712。`
      : `接收卡按折后画布在 HDSet 复杂模式排布（${f.ports} 路网口），具体张数以一键连屏文件为准。`,
  };
}

// 客户显式选了某播放盒场景、但该场景系列盖不住时的说明（1:1 官网场景白名单；可换更宽场景或人工）
function sceneOversizedMessage(scene, c) {
  const pool = playBoxPool(scene);
  const maxDev = pool[pool.length - 1];
  const scName = PLAYBOX_SCENES[scene].label;
  const use = scene === "meeting"
    ? "会议屏（H6/H8）面向常规会议平板比例"
    : scene === "poster"
      ? "海报屏（B6L/A6L/B8L）面向灯箱、海报竖屏"
      : "通用 A 系列（A4L~A8）是异步播放盒主力机型";
  return `这块长条整屏 ${c.W}×${c.H}（约${wan(c.total)}万点），折后已超出${scName}最大机型 ${maxDev.name}（折后画布上限约${wan(maxDev.canvas)}万点、${maxDev.ports} 路网口）的带载。${use}；可换其它场景重算，或联系人工拆段、多机级联。`;
}
// 四个播放盒视图里哪些盖得住当前长条（盖不住的场景按钮不显示；盖不住的显式选择走 scene-oversized）
function evalSceneAvail(c) {
  return {
    official: !!tryPlayBox(c, "official"),
    generic: !!tryPlayBox(c, "generic"),
    meeting: !!tryPlayBox(c, "meeting"),
    poster: !!tryPlayBox(c, "poster"),
  };
}

function planStrip(r, raw, opts = {}) {
  const scene = (opts && opts.scene) || "official";
  const d = detectStrip(r, raw);
  if (!d.isStrip) return { match: false };
  const c = {
    W: r.screenW, H: r.screenH, cols: r.cols, rows: r.rows,
    mw: r.moduleW, mh: r.moduleH, total: r.totalPx,
  };
  const mode = (r.input && r.input.controlMode) || "unspecified";
  const explicitScene = scene !== "official"; // 客户主动点了 通用A/会议/海报：只在该场景白名单里选
  let pick = null;
  if (explicitScene) {
    // 客户显式切到会议屏/海报屏：只在该场景播放盒白名单里选（官网 ComputePlayBoxFilterRules 口径），
    // 盖不住直接说明，不被 CX6/C16L/A 直连或同步兜底顶替成别的机型
    pick = tryPlayBox(c, scene);
    if (!pick) {
      return { match: true, covered: false, escalateKind: "scene-oversized", scene, sceneAvail: evalSceneAvail(c), message: sceneOversizedMessage(scene, c) };
    }
  } else if (mode === "sync") {
    pick = trySync(c);
  } else if (d.outdoor) {
    pick = tryCX6(c) || tryC16L(c) || tryA(c) || tryPlayBox(c, "official");
  } else {
    const a = tryA(c);
    // 室内异步：单网口即可点对点带完（≤65万、单行≤4096）→ A3L 播放盒最省，无需打折；
    // 单口带不下再 C16L 打折（教学室内方案）→ 多口 A4L/A5L/A6L → 播放盒（默认通用 A 系列）。
    if (a && a.ports === 1) pick = a;
    else pick = tryC16L(c) || a || tryPlayBox(c, "official");
  }
  if (!explicitScene && !pick && mode !== "async") pick = trySync(c); // 未指定同/异步时，同步打折兜底
  if (!pick) {
    return {
      match: true, covered: false, escalateKind: "strip-oversized", sceneAvail: evalSceneAvail(c),
      message: `这块长条屏整屏 ${c.W}×${c.H}（约${wan(c.total)}万点），折叠后已超出单台异步播放盒/同步处理器的最大带载，可能需要多台级联或拼接组网。为避免配错设备，请联系技术支持人工出连屏方案，也可以把它拆成几段分别估算。`,
    };
  }
  // 哪些播放盒场景盖得住当前长条（只对播放盒类方案：PLAYBOX 打折 / A 系列多口物理切分；单口 A3L、CX6/C16L、同步不挂）
  const isPlayboxLike = pick.family === "PLAYBOX" || (pick.family === "A" && pick.ports > 1);
  const sceneAvail = isPlayboxLike ? evalSceneAvail(c) : { official: false, generic: false, meeting: false, poster: false };
  return { match: true, covered: true, ctx: c, detect: d, scene, sceneAvail, ...pick };
}

// —— 文案 ——
function buildReply(p) {
  const c = p.ctx;
  const env = p.detect.outdoor ? "户外单元板" : "室内";
  const single = p.ports === 1;
  const L = [];
  L.push(single
    ? `这是一块${env}长条屏：整屏 ${c.W}×${c.H} 点（约${wan(c.total)}万点），${c.cols}×${c.rows} 块模组（单块 ${c.mw}×${c.mh}）。整屏在单网口 65万带载内、单行宽≤4096，一台异步播放盒单网口即可点对点带完、无需屏幕打折，配单如下：`
    : `这是一块${env}长条屏：整屏 ${c.W}×${c.H} 点（约${wan(c.total)}万点），${c.cols}×${c.rows} 块模组（单块 ${c.mw}×${c.mh}）。长条形屏用「屏幕打折」把超长画面折叠到控制器带载内，异步方案最省，配单如下：`);
  L.push(`【主控】${p.controller.qty}×${p.controller.name}`);
  if (p.receiver) L.push(`【接收卡】${p.receiver.count}×${p.receiver.name}`);
  L.push(`【${single ? "画布设置" : "打折设置"}】${p.setting}`);
  if (p.cardNote) L.push(`【接收卡排布】${p.cardNote}`);
  L.push(`【布线】每个千兆网口 1 根超五类/六类网线、距离≤80米；超过80~100米会出现数据异常，需改光纤，每 8 路网口配 1 对 HD-FT08 光纤收发器（LC单模10KM、近远端成对）。`);
  L.push(`下方拓扑按网口/折区着色，R 为接收卡级联序号；最终连线可在 HDSet 复杂模式一键生成连屏文件。`);
  return L.join("\n");
}

// —— 彩边蛇形拓扑：上=物理长条按口分段，下=折后画布堆叠色带 ——
function renderSvg(p) {
  const zones = p.zones || [];
  const W = 880, marginL = 70, marginR = 30, top = 64, contentW = W - marginL - marginR;
  const maxFoldW = Math.max(...zones.map((z) => z.foldW), 1);
  const sx = contentW / maxFoldW;
  const bandH = 40, gap = 6, physH = 30;
  const foldedTop = top + physH + 46;
  const foldedH = zones.length * (bandH + gap);
  const legendTop = foldedTop + foldedH + 18;
  const H = legendTop + zones.length * 17 + 30;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Microsoft YaHei,Segoe UI,sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${marginL}" y="26" font-size="15" font-weight="700" fill="#111827">长条屏打折连接拓扑（${p.controller.name}${p.receiver ? " + " + p.receiver.count + "×" + p.receiver.name : ""}）</text>`);
  parts.push(`<text x="${marginL}" y="46" font-size="11" fill="#6b7280">整屏 ${p.ctx.W}×${p.ctx.H}（${wan(p.ctx.total)}万点）→ ${p.ports === 1 ? "单网口点对点（不打折），画布 " + p.foldW + "×" + p.foldedH : "折 " + p.folds + " 折 / " + p.ports + " 网口，折后画布 " + p.foldW + "×" + p.foldedH}</text>`);

  // 物理长条（按 zone 横向分段）
  parts.push(`<text x="${marginL}" y="${top - 6}" font-size="11" fill="#374151">物理整屏（网线分区）</text>`);
  const physTotal = zones.reduce((s, z) => s + z.physW, 0) || 1;
  let xc = marginL;
  zones.forEach((z, i) => {
    const segW = Math.max((z.physW / physTotal) * contentW, 2);
    const col = PORT_COLORS[i % PORT_COLORS.length];
    parts.push(`<rect x="${xc.toFixed(1)}" y="${top}" width="${segW.toFixed(1)}" height="${physH}" fill="${col}" fill-opacity="0.82" stroke="#fff" stroke-width="1"/>`);
    if (segW > 34) parts.push(`<text x="${(xc + segW / 2).toFixed(1)}" y="${top + physH / 2 + 4}" font-size="9" fill="#fff" text-anchor="middle">${z.label}</text>`);
    xc += segW;
  });
  parts.push(`<line x1="${marginL}" y1="${top + physH + 16}" x2="${marginL + contentW}" y2="${top + physH + 16}" stroke="#9ca3af" stroke-width="1" marker-end="url(#arr)"/>`);
  parts.push(`<text x="${marginL + contentW + 2}" y="${top + physH + 20}" font-size="9" fill="#9ca3af">物理长度→</text>`);
  parts.push(`<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#9ca3af"/></marker></defs>`);

  // 折后画布（每 zone 一条水平色带，自上而下折1..折N，蛇形）
  parts.push(`<text x="${marginL}" y="${foldedTop - 8}" font-size="11" fill="#374151">折后画布（每带=一个网口/折区，R 为接收卡级联序号）</text>`);
  // 每折恰好一口（H6/A3L/C16L 等）：色带内画「网口标签块 + cards 个接收卡小格」，R 号水平、沿蛇形走线；
  // 每折多口（A7/A8/多口同步）维持整带 + 文字范围，避免格子过密。
  const onePortPerFold = Number.isInteger(p.folds) && p.folds >= 1 && zones.length === p.folds && zones.every((z) => z.cards >= 1);
  zones.forEach((z, i) => {
    const y = foldedTop + i * (bandH + gap);
    const bw = Math.max(z.foldW * sx, 30);
    const col = PORT_COLORS[i % PORT_COLORS.length];
    parts.push(`<rect x="${marginL}" y="${y}" width="${bw}" height="${bandH}" rx="5" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-width="2.4"/>`);
    if (onePortPerFold && z.cards >= 1) {
      const labW = 46;
      parts.push(`<rect x="${(marginL + 0.6).toFixed(1)}" y="${y + 0.6}" width="${labW - 1.2}" height="${bandH - 1.2}" rx="4" fill="${col}"/>`);
      parts.push(`<text x="${marginL + labW / 2}" y="${y + bandH / 2 + 3.6}" font-size="9.5" font-weight="700" fill="#fff" text-anchor="middle">${z.label}</text>`);
      const gridX = marginL + labW, gridW = bw - labW;
      const n = z.cards, cw = gridW / n;
      const fs = cw >= 44 ? 11 : cw >= 27 ? 9.5 : 8.5;
      for (let k = 0; k < n; k++) {
        // 蛇形：偶数折(0基)左→右递增，奇数折右→左递增，保证相邻折在侧端首尾相接、走线不交叉
        const rNum = (i % 2 === 0) ? (z.rStart + k) : (z.rEnd - k);
        const gx = gridX + k * cw;
        parts.push(`<rect x="${(gx + 1).toFixed(1)}" y="${y + 5}" width="${(cw - 2).toFixed(1)}" height="${bandH - 10}" rx="3" fill="#ffffff" stroke="${col}" stroke-width="1"/>`);
        parts.push(`<text x="${(gx + cw / 2).toFixed(1)}" y="${y + bandH / 2 + 3.5}" font-size="${fs}" font-weight="600" fill="#1f2937" text-anchor="middle">R${rNum}</text>`);
      }
    } else {
      const rTxt = z.cards ? `R${z.rStart}${z.rEnd > z.rStart ? "→R" + z.rEnd : ""} · ${z.cards}张` : "卡数见连屏文件";
      parts.push(`<text x="${marginL + 10}" y="${y + bandH / 2 + 4}" font-size="11" font-weight="600" fill="${col}">${z.label}　${z.foldW}×${z.foldH}　${rTxt}</text>`);
    }
  });

  // 图例
  parts.push(`<text x="${marginL}" y="${legendTop}" font-size="11" font-weight="700" fill="#111827">网口明细</text>`);
  zones.forEach((z, i) => {
    const y = legendTop + 16 + i * 17;
    const col = PORT_COLORS[i % PORT_COLORS.length];
    const zonePts = z.foldW * z.foldH;
    const legendRev = onePortPerFold && z.cards && z.rEnd > z.rStart && (i % 2 === 1);  // 奇数折蛇形折回，图例按走线方向标大→小
    const rTxt = z.cards ? (legendRev ? `R${z.rEnd}→R${z.rStart}` : `R${z.rStart}${z.rEnd > z.rStart ? "→R" + z.rEnd : ""}`) + `，${z.cards} 张 R712` : "卡数以连屏文件为准";
    parts.push(`<rect x="${marginL}" y="${y - 9}" width="11" height="11" rx="2" fill="${col}"/>`);
    parts.push(`<text x="${marginL + 17}" y="${y}" font-size="10.5" fill="#374151">${z.label}：${z.foldW}×${z.foldH}，${wan(zonePts)}万点，${rTxt}</text>`);
  });
  parts.push(`</svg>`);
  return parts.join("");
}

// 总入口：specialist 调用
function tryStrip(result, rawText, opts = {}) {
  const p = planStrip(result, rawText, opts);
  if (!p.match) return { match: false };
  if (!p.covered) return { match: true, covered: false, escalateKind: p.escalateKind, scene: p.scene, sceneAvail: p.sceneAvail, message: p.message };
  const reply = buildReply(p);
  // 单网口点对点（不打折）长条本质是标准一行卡网格，用统一纯拓扑出随列加宽的高清全图；
  // 多网口打折才用 renderSvg 的“物理长条 + 折后色带”双视图表达折叠关系。
  const topologySvg = (p.ports === 1)
    ? (renderTopoOnly(result) || renderSvg(p))
    : renderSvg(p);
  const bom = [{ name: p.controller.name, qty: p.controller.qty, kind: "controller" }];
  if (p.receiver) bom.push({ name: p.receiver.name, qty: p.receiver.count, kind: "receiver" });
  return {
    match: true, covered: true, state: "formal", family: p.family, scene: p.scene,
    reply, topologySvg, bom,
    ordering: {
      state: "formal", assumptions: [], bom,
      hasTopology: true, topologySvg,
      strip: { family: p.family, scene: p.scene, sceneAvail: p.sceneAvail, folds: p.folds, foldW: p.foldW, foldedH: p.foldedH, ports: p.ports },
    },
  };
}

module.exports = { detectStrip, planStrip, tryStrip, buildReply, renderSvg };
