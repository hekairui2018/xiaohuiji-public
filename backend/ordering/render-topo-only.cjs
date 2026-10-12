// render-topo-only.cjs — 纯拓扑画布（无 HDSet 软件外壳）
// 只保留：卡格 / 网口分区粗彩边 / 整屏蓝框 / 蛇形走线+每段方向三角 / S-E 透明圈 /
//         卡内真实宽高（全黑字、走线留白带不压字）/ 底部每口图例（R范围·像素·万点·卡数·带载）
// 用途：配单直接出图（网页试玩页 / 企微兜底 / 一键导出），紧凑自适应、卡格放大撑满、字号随卡。
// 与 render-hdset.cjs 的 HDSet 仿真模式共用色板与几何常量，但不画标题栏/工具栏/右侧面板/底部按钮。
"use strict";

const {
  PORT_COLORS, pc, shade, nd,
  BASE_CW, BASE_CH, RY, FONT,
  BLUE, RED, SGREEN, EPINK
} = require("./render-hdset.cjs");

function renderTopoOnly(t) {
  const ports = t.ports, cards = t.cards, cols = t.grid.cols, rows = t.grid.rows;
  const portN = ports.length;

  const BASE_VW = 1180, ML = 24, MT = 22;
  const BASE_CONTENT_W = BASE_VW - ML * 2;
  const legRowsN = Math.max(1, Math.ceil(portN / 2));
  const LEG_H = 26 + legRowsN * 20 + 18;
  // 卡格放大撑满内容宽（上限 2.4），同时约束整屏格高，避免极少卡时过大
  const sV = Math.min(560 / (rows * BASE_CH), 2.4);
  const sH = BASE_CONTENT_W / (cols * BASE_CW);
  let s = Math.min(sV, sH);
  let VW = BASE_VW;
  // 超宽屏（列数很多）：不再把卡压窄到丢字降级，改为每张卡保最小可读宽度（四行阈值 66，取 70 留裕量），
  // 整图随列数横向加宽。网页正文 CSS max-width:100% 会把它缩成一屏缩略，点开灯箱/下载 PNG·SVG/企微
  // 拿到的则是这张“随列数加宽、每张卡都看得清四行字”的超宽高清全图（等价把 HDSet 要横滚的画布拍成一张图）。
  const MIN_CW = 70;
  if (BASE_CW * s < MIN_CW) {
    s = Math.min(sV, MIN_CW / BASE_CW); // 又高又宽的超大拼接仍受纵向 sV 限，维持密档
    VW = Math.max(BASE_VW, Math.ceil(ML * 2 + 36 + cols * (BASE_CW * s)));
  }
  const CONTENT_W = VW - ML * 2;
  const cw = BASE_CW * s, ch = BASE_CH * s;
  const lx = ML + 18, ly = MT + 18, lw = cols * cw, lh = rows * ch;
  const VH = Math.ceil(ly + lh + LEG_H + 12);

  const rectOf = cd => ({ x: lx + cd.col * cw, y: ly + cd.row * ch, w: cw - 1.5, h: ch - 1.5 });
  const portOffset = {}; let acc = 0;
  ports.forEach(p => { portOffset[p.id] = acc; acc += p.cardCount; });
  const globalR = cd => portOffset[cd.port] + cd.seqInPort + 1;

  const P = [];
  P.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}" font-family="${FONT}">`);
  P.push(`<rect width="${VW}" height="${VH}" fill="#ffffff"/>`);

  // 淡逻辑网格 + 列/行号
  if (cw >= 18) {
    for (let c = 0; c <= cols; c++) { const xx = lx + c * cw;
      P.push(`<line x1="${nd(xx)}" y1="${ly}" x2="${nd(xx)}" y2="${nd(ly + lh)}" stroke="#ececec" stroke-dasharray="1,4"/>`); }
    for (let r = 0; r <= rows; r++) { const yy = ly + r * ch;
      P.push(`<line x1="${lx}" y1="${nd(yy)}" x2="${nd(lx + lw)}" y2="${nd(yy)}" stroke="#ececec" stroke-dasharray="1,4"/>`); }
  }
  if (cw >= 20) for (let c = 0; c < cols; c++)
    P.push(`<text x="${nd(lx + c * cw + cw / 2)}" y="${ly - 7}" font-size="10" text-anchor="middle" fill="#a9a9a9">${c + 1}</text>`);
  if (ch >= 20) for (let r = 0; r < rows; r++)
    P.push(`<text x="${lx - 9}" y="${nd(ly + r * ch + ch / 2 + 3.5)}" font-size="10" text-anchor="middle" fill="#a9a9a9">${r + 1}</text>`);

  // 卡填充（口内同色）
  cards.forEach(cd => { const r = rectOf(cd);
    P.push(`<rect x="${nd(r.x)}" y="${nd(r.y)}" width="${nd(r.w)}" height="${nd(r.h)}" fill="${pc(cd.port - 1)}" stroke="${shade(pc(cd.port - 1), 0.72)}" stroke-width="1"/>`); });

  // 每个网口分区粗彩边
  ports.forEach(p => {
    let c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
    p.cardIdx.forEach(i => { const c = cards[i]; c0 = Math.min(c0, c.col); c1 = Math.max(c1, c.col); r0 = Math.min(r0, c.row); r1 = Math.max(r1, c.row); });
    const x = lx + c0 * cw - 1.5, y = ly + r0 * ch - 1.5, w = (c1 - c0 + 1) * cw + 1.5, h = (r1 - r0 + 1) * ch + 1.5;
    P.push(`<rect x="${nd(x)}" y="${nd(y)}" width="${nd(w)}" height="${nd(h)}" fill="none" stroke="${shade(pc(p.id - 1), 0.42)}" stroke-width="2.6"/>`);
  });
  // 整屏蓝粗框
  P.push(`<rect x="${nd(lx - 1.5)}" y="${nd(ly - 1.5)}" width="${nd(lw + 1.5)}" height="${nd(lh + 1.5)}" fill="none" stroke="${BLUE}" stroke-width="2"/>`);

  // 红色蛇形走线（卡内 0.46 留白带）+ 每段方向三角
  ports.forEach(p => {
    const ids = p.cardIdx, pts = [];
    ids.forEach((ci, k) => {
      const cd = cards[ci], r = rectOf(cd);
      const cy = ly + cd.row * ch + ch * RY.wire, cx = r.x + r.w / 2;
      if (k > 0) { const prev = cards[ids[k - 1]], pr = rectOf(prev);
        if (prev.row !== cd.row) {
          const pcy = ly + prev.row * ch + ch * RY.wire;
          const edgeX = cd.col < prev.col ? Math.max(pr.x + pr.w, r.x + r.w) : Math.min(pr.x, r.x);
          pts.push([edgeX, pcy]); pts.push([edgeX, cy]);
        } }
      pts.push([cx, cy]);
    });
    if (pts.length > 1)
      P.push(`<polyline points="${pts.map(q => nd(q[0]) + "," + nd(q[1])).join(" ")}" fill="none" stroke="${RED}" stroke-width="2.3" stroke-opacity="0.92" stroke-linejoin="round" stroke-linecap="round"/>`);
    const bs = Math.max(3.5, Math.min(cw, ch) * 0.075);
    for (let k = 1; k < ids.length; k++) {
      const prev = cards[ids[k - 1]], cd = cards[ids[k]];
      const cy = ly + cd.row * ch + ch * RY.wire;
      if (prev.row !== cd.row) {
        const pr = rectOf(prev), cr = rectOf(cd);
        const pcy = ly + prev.row * ch + ch * RY.wire;
        const edgeX = cd.col < prev.col ? Math.max(pr.x + pr.w, cr.x + cr.w) : Math.min(pr.x, cr.x);
        const mY = (pcy + cy) / 2;
        P.push(`<polygon points="${nd(edgeX - bs)},${nd(mY - bs)} ${nd(edgeX + bs)},${nd(mY - bs)} ${nd(edgeX)},${nd(mY + bs + 1)}" fill="${BLUE}"/>`);
      } else {
        const cr = rectOf(cd), dir = cd.col > prev.col ? 1 : -1;
        const tx = cr.x + cr.w / 2 - dir * cw * 0.34;
        if (dir > 0) P.push(`<polygon points="${nd(tx - bs)},${nd(cy - bs)} ${nd(tx - bs)},${nd(cy + bs)} ${nd(tx + bs + 1)},${nd(cy)}" fill="${BLUE}"/>`);
        else P.push(`<polygon points="${nd(tx + bs)},${nd(cy - bs)} ${nd(tx + bs)},${nd(cy + bs)} ${nd(tx - bs - 1)},${nd(cy)}" fill="${BLUE}"/>`);
      }
    }
  });

  // S/E 透明空心圈：贴走线起点/终点所在的卡缘（跟随该处水平走线方向）
  // 横排左→右：S 贴首卡左缘、E 贴末卡右缘；蛇形回行右→左：末卡在左，E 贴左缘。
  const edgeFrac = (which, p) => {
    const ids = p.cardIdx;
    if (ids.length < 2) return which === "S" ? 0.16 : 0.84;
    if (which === "S") {
      const a = cards[ids[0]], b = cards[ids[1]];
      return b.col < a.col ? 0.84 : 0.16; // 右起 S 在右缘，否则左缘
    }
    const pre = cards[ids[ids.length - 2]], e = cards[ids[ids.length - 1]];
    return e.col < pre.col ? 0.16 : 0.84;    // 向左到达末卡 E 在左缘，否则右缘
  };
  // 整屏走线起点=首口首卡、终点=末口尾卡，这两处保留大圈+「首/尾」汉字；
  // 口与口交界处（前口尾卡与后口首卡物理相邻）只画小色圈、不写字，避免两个空心圈叠在一起时「尾/首」两字糊成一团。
  const gStart = ports[0].sCard, gEnd = ports[ports.length - 1].eCard;
  ports.forEach(p => {
    [[p.sCard, SGREEN, "S", "首"], [p.eCard, EPINK, "E", "尾"]].forEach(([ci, col, key, han]) => {
      const cd = cards[ci], r = rectOf(cd);
      const isGlobal = (key === "S" && ci === gStart) || (key === "E" && ci === gEnd);
      const cx = r.x + cw * edgeFrac(key, p), cy = ly + cd.row * ch + ch * RY.wire;
      const rad = isGlobal ? Math.max(6, Math.min(cw, ch) * 0.18) : Math.max(3.5, Math.min(cw, ch) * 0.105);
      P.push(`<circle cx="${nd(cx)}" cy="${nd(cy)}" r="${nd(rad)}" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-width="${isGlobal ? 2.3 : 1.6}"/>`);
      if (isGlobal && rad >= 8.5)
        P.push(`<text x="${nd(cx)}" y="${nd(cy)}" font-size="${nd(rad * 1.34)}" text-anchor="middle" dominant-baseline="central" fill="${col}" font-weight="800">${han}</text>`);
    });
  });

  // 卡内文字（全黑；字号随卡放大；窄卡分级降级）
  const fsPort = Math.max(9, Math.min(15, cw / 7));
  const fsWH = Math.max(8.5, Math.min(19, cw / 5.8));
  const fsCard = Math.max(11, Math.min(24, cw / 4.6));
  cards.forEach(cd => {
    const r = rectOf(cd); const isSE = cd.role !== "M";
    const txt = (yy, fs, col, bold, t) => P.push(`<text x="${nd(r.x + r.w / 2)}" y="${nd(r.y + ch * yy)}" font-size="${nd(fs)}" text-anchor="middle" fill="${col}" ${bold ? 'font-weight="700"' : ""}>${t}</text>`);
    if (cw >= 66) {
      // 对齐真机卡面四行：网口:N(小号灰字·顶部) / 卡:N(大号加粗·走线上方) / 宽度 / 高度(走线下方)；
      // 红走线在 0.46 中部穿过、不压字。网口用小号、卡号略缩并下移，四行垂直拉开不粘连；首/尾卡同样印全。
      txt(0.13, fsPort, "#555", false, `网口:${cd.port}`);
      txt(0.32, fsCard, "#000", true, `卡:${cd.seqInPort + 1}`);
      txt(0.68, fsWH, "#1a1a1a", false, `宽度:${cd.w}`);
      txt(0.90, fsWH, "#1a1a1a", false, `高度:${cd.h}`);
    } else if (cw >= 40) {
      // 中密度窄卡：卡号 + 宽/高（缩写），不标网口号
      txt(0.30, fsCard, "#000", true, `卡:${cd.seqInPort + 1}`);
      txt(0.68, fsWH, "#1a1a1a", false, `宽:${cd.w}`);
      txt(0.90, fsWH, "#1a1a1a", false, `高:${cd.h}`);
    } else if (cw >= 22) {
      txt(0.60, Math.max(8, fsCard), "#000", true, `${cd.seqInPort + 1}`);
    } else {
      if (!isSE) { const ds = String(cd.seqInPort + 1).split(""), vfs = Math.max(6, Math.min(10, ch / (ds.length + 1))), y0 = r.y + r.h / 2 - (ds.length - 1) * vfs / 2;
        ds.forEach((d2, i) => P.push(`<text x="${nd(r.x + r.w / 2)}" y="${nd(y0 + i * vfs)}" font-size="${nd(vfs)}" text-anchor="middle" fill="#1a1a1a" font-weight="700">${d2}</text>`)); }
    }
  });

  // 底部图例：每口 R 范围 / 像素 / 万点 / 卡数 / 带载
  const legX = ML, legY = ly + lh + 16, legW = CONTENT_W, legH = LEG_H - 12;
  P.push(`<rect x="${legX}" y="${legY}" width="${legW}" height="${legH}" rx="4" fill="#fafbfc" stroke="#dcdfe4"/>`);
  P.push(`<text x="${legX + 12}" y="${legY + 18}" font-size="12" font-weight="700" fill="#333">网口分配（走线 首→尾：绿圈=首卡起点，粉圈=尾卡终点；R=接收卡全局序号）</text>`);
  const colW = (legW - 24) / 2;
  ports.forEach((p, i) => {
    const cl = i % 2, rrn = Math.floor(i / 2);
    const bx = legX + 12 + cl * colW, by = legY + 36 + rrn * 20;
    const first = cards[p.cardIdx[0]], last = cards[p.cardIdx[p.cardIdx.length - 1]];
    const rA = globalR(first), rB = globalR(last);
    const wan = ((p.points || p.pxW * p.pxH) / 10000);
    const over = p.loadPct > 100;
    P.push(`<rect x="${bx}" y="${by - 10}" width="13" height="11" rx="2" fill="${pc(p.id - 1)}" stroke="${shade(pc(p.id - 1), 0.5)}"/>`);
    P.push(`<text x="${bx + 19}" y="${by}" font-size="11.5" font-weight="700" fill="#333">网口${p.id}</text>`);
    P.push(`<text x="${bx + 66}" y="${by}" font-size="11.5" fill="#444">R${rA}→R${rB}</text>`);
    P.push(`<text x="${bx + 128}" y="${by}" font-size="11.5" fill="#444">${p.pxW}×${p.pxH}</text>`);
    P.push(`<text x="${bx + 196}" y="${by}" font-size="11.5" fill="#444">${wan >= 10 ? Math.round(wan) : wan.toFixed(1)}万点</text>`);
    P.push(`<text x="${bx + 248}" y="${by}" font-size="11.5" fill="#444">${p.cardCount}张</text>`);
    P.push(`<text x="${bx + 286}" y="${by}" font-size="11.5" font-weight="700" fill="${over ? "#e23c3c" : "#1f8a9e"}">${Math.floor(p.loadPct)}%</text>`);
  });

  P.push(`</svg>`);
  return P.join("");
}

module.exports = { renderTopoOnly };
