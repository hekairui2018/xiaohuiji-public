// topo-geometry.cjs — 小灰机连屏「结构化几何内核」（公式算图，非像素枚举）
// 零第三方依赖，纯函数。HDSet 标准模式数据模型：
//   · 箱体(可编辑)= 一张接收卡带的矩形；卡网格可不等宽/不等高(跨不同模组数)
//   · 当前信息(只读)= 蓝框(网口区域)内箱体行列个数与总宽高汇总
//   · 官网配单网口 = 全高竖条，按连续列贪心(单口≤655360点、≤4096px)，口内蛇形
// 真机/真实配单锚点：
//   · HDSet 1x2 单箱416x312 默认走线 卡1S下→卡2E上 = v-BL；图标5 = v-TL；负载39.6%==HDSet39%
//   · 官网三案(30卡4口/14卡4口/5卡1口) 口内蛇形 = h-TL，逐格与 ordering-engine 对齐
"use strict";

const PORT_CAPACITY = 655360;
const PORT_MAX_WIDTH = 4096;

const ROUTES = {
  "h-TL": { major: "h", corner: "TL" }, "h-TR": { major: "h", corner: "TR" },
  "h-BL": { major: "h", corner: "BL" }, "h-BR": { major: "h", corner: "BR" },
  "v-TL": { major: "v", corner: "TL" }, "v-TR": { major: "v", corner: "TR" },
  "v-BL": { major: "v", corner: "BL" }, "v-BR": { major: "v", corner: "BR" },
};
const ROUTE_ICON_MAP = {
  "v-BL": { icon: "default(∩向上)", evidence: "std 1x2 卡1S下卡2E上" },
  "v-TL": { icon: "5(U向下)",      evidence: "line5 1x2 卡1上卡2下" },
};

// 矩形格子范围 c∈[c0,c1),r∈[r0,r1) 内蛇形级联顺序(S→E)
function serpent(c0, c1, r0, r1, routeId) {
  const rt = ROUTES[routeId];
  if (!rt) throw new Error("topo: unknown route " + routeId);
  const { major, corner } = rt;
  const range = (a, b) => { const o = []; for (let i = a; i < b; i++) o.push(i); return o; };
  const out = [];
  if (major === "h") {
    const startTop = corner === "TL" || corner === "TR";
    const firstLR = corner === "TL" || corner === "BL";
    const rows = startTop ? range(r0, r1) : range(r0, r1).reverse();
    rows.forEach((r, k) => {
      const lr = (k % 2 === 0) ? firstLR : !firstLR;
      const cols = lr ? range(c0, c1) : range(c0, c1).reverse();
      cols.forEach(c => out.push({ c, r }));
    });
  } else {
    const startLeft = corner === "TL" || corner === "BL";
    const firstTB = corner === "TL" || corner === "TR";
    const cols = startLeft ? range(c0, c1) : range(c0, c1).reverse();
    cols.forEach((c, k) => {
      const tb = (k % 2 === 0) ? firstTB : !firstTB;
      const rows = tb ? range(r0, r1) : range(r0, r1).reverse();
      rows.forEach(r => out.push({ c, r }));
    });
  }
  return out;
}

// 全高竖条划网口：逐列贪心(列可不等宽)，colPts[c]=该列全高点数
function partitionVStrip(colPxW, totalH, portCount) {
  const cols = colPxW.length;
  const ports = [];
  if (portCount && portCount > 0) {
    const base = Math.floor(cols / portCount), rem = cols % portCount;
    let c = 0;
    for (let p = 0; p < portCount; p++) {
      const w = base + (p < rem ? 1 : 0);
      if (w <= 0) continue;
      ports.push({ id: p + 1, c0: c, c1: c + w }); c += w;
    }
    if (c < cols) ports[ports.length - 1].c1 = cols;
  } else {
    let c0 = 0;
    while (c0 < cols) {
      let c1 = c0, accW = 0;
      while (c1 < cols) {
        const w = accW + colPxW[c1];
        const pts = w * totalH;
        if (pts > PORT_CAPACITY || w > PORT_MAX_WIDTH) break;
        accW = w; c1++;
      }
      if (c1 === c0) c1 = c0 + 1;
      ports.push({ id: ports.length + 1, c0, c1 });
      c0 = c1;
    }
  }
  return ports;
}

// 归一化网格像素：支持 ①等大 cardW/cardH/cols/rows ②模组数 colWidths/rowHeights+module ③像素数组
function normalizeGrid(opt) {
  let colPxW, rowPxH;
  if (opt.colWidths && opt.rowHeights && opt.moduleW && opt.moduleH) {
    colPxW = opt.colWidths.map(m => m * opt.moduleW);
    rowPxH = opt.rowHeights.map(m => m * opt.moduleH);
  } else if (opt.colPxW && opt.rowPxH) {
    colPxW = opt.colPxW.slice(); rowPxH = opt.rowPxH.slice();
  } else {
    const { cardW, cardH, cols, rows } = opt;
    if (!(cardW > 0 && cardH > 0 && cols > 0 && rows > 0)) throw new Error("topo: bad grid");
    colPxW = Array(cols).fill(cardW); rowPxH = Array(rows).fill(cardH);
  }
  const cumX = [0]; colPxW.forEach((w, i) => cumX.push(cumX[i] + w));
  const cumY = [0]; rowPxH.forEach((h, i) => cumY.push(cumY[i] + h));
  return { colPxW, rowPxH, cumX, cumY, W: cumX[colPxW.length], H: cumY[rowPxH.length] };
}

function buildTopology(opt) {
  const route = opt.route || "h-TL";
  const g = normalizeGrid(opt);
  const cols = g.colPxW.length, rows = g.rowPxH.length;
  const strips = partitionVStrip(g.colPxW, g.H, opt.portCount || null);
  const cards = [];
  const ports = strips.map(strip => {
    const seq = serpent(strip.c0, strip.c1, 0, rows, route);
    const cardIdx = [];
    seq.forEach(cell => {
      const idx = cards.length;
      cardIdx.push(idx);
      cards.push({
        idx, gridId: cell.r * cols + cell.c, port: strip.id,
        seqInPort: cardIdx.length - 1,
        role: cardIdx.length - 1 === 0 ? "S" : (cardIdx.length - 1 === seq.length - 1 ? "E" : "M"),
        col: cell.c, row: cell.r,
        x: g.cumX[cell.c], y: g.cumY[cell.r], w: g.colPxW[cell.c], h: g.rowPxH[cell.r],
      });
    });
    const pxW = g.cumX[strip.c1] - g.cumX[strip.c0], pxH = g.H;
    const points = pxW * pxH;
    return {
      id: strip.id, c0: strip.c0, c1: strip.c1,
      cardCount: cardIdx.length, cardIdx,
      pxW, pxH, points, loadPct: +(points / PORT_CAPACITY * 100).toFixed(1),
      sCard: cardIdx[0], eCard: cardIdx[cardIdx.length - 1],
    };
  });
  const wires = [];
  for (const p of ports) for (let k = 0; k < p.cardIdx.length - 1; k++) {
    const a = cards[p.cardIdx[k]], b = cards[p.cardIdx[k + 1]];
    const dir = b.y > a.y ? "down" : b.y < a.y ? "up" : b.x > a.x ? "right" : "left";
    wires.push({ port: p.id, from: a.idx, to: b.idx, dir });
  }
  return {
    schema: "xhj-topo/1",
    screen: { w: opt.screenW || g.W, h: opt.screenH || g.H },
    grid: { cols, rows, cardCount: cols * rows },
    route: { id: route, ...ROUTES[route], icon: (ROUTE_ICON_MAP[route] || {}).icon || null },
    portCapacity: PORT_CAPACITY,
    ports, cards, wires,
  };
}

module.exports = { buildTopology, serpent, partitionVStrip, normalizeGrid, ROUTES, ROUTE_ICON_MAP, PORT_CAPACITY };
