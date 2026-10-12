// topo-hdset.cjs — 配单结果(result.plan) → HDSet 拓扑 SVG 的适配器
// 原则：分组/蛇形/负载全部以 ordering-engine 已算好的 plan.ports[].cells 为唯一真相，
//       本文件只做「坐标化 + 塑形」，不重新划网口、不重新选型（图与配单文字永远一致）。
// 两个出口：
//   renderHdsetFromResult — HDSet「显示屏配置·连接设置」高保真仿真画布（含外壳/右侧面板/负载）
//   renderTopoOnly       — 纯拓扑画布（无外壳，配单直接出图/网页/企微用）
"use strict";

const { render } = require("./render-hdset.cjs");
const { renderTopoOnly } = require("./render-topo-only.cjs");
const PORT_CAPACITY = 655360;

// result = calculate/answerWithContext 的成功结果；返回 topology 对象 t，数据不齐返回 null。
function buildTopo(result) {
  const plan = result && result.plan;
  if (!plan || !Array.isArray(plan.ports) || !plan.ports.length) return null;
  const cg = plan.colGroups, rg = plan.rowGroups;
  const modW = result.moduleW, modH = result.moduleH;
  if (!(cg > 0 && rg > 0 && modW > 0 && modH > 0)) return null;
  if (!Array.isArray(plan.colWidths) || !Array.isArray(plan.rowHeights)) return null;

  // 列/行像素宽高与累计偏移（卡网格可不等宽/不等高）
  const colPx = plan.colWidths.map(m => m * modW);
  const rowPx = plan.rowHeights.map(m => m * modH);
  const cumX = [0]; colPx.forEach((w, i) => cumX.push(cumX[i] + w));
  const cumY = [0]; rowPx.forEach((h, i) => cumY.push(cumY[i] + h));
  const W = cumX[cumX.length - 1], H = cumY[cumY.length - 1];

  const cards = [];
  const ports = [];
  plan.ports.forEach((p, pi) => {
    const id = pi + 1;
    const cells = Array.isArray(p.cells) ? p.cells : [];
    if (!cells.length) return;
    const cardIdx = [];
    cells.forEach((cell, k) => {
      const idx = cards.length;
      cardIdx.push(idx);
      cards.push({
        idx,
        gridId: cell.row * cg + cell.col,
        port: id,
        seqInPort: k,
        role: k === 0 ? "S" : (k === cells.length - 1 ? "E" : "M"),
        col: cell.col, row: cell.row,
        x: cumX[cell.col], y: cumY[cell.row],
        w: colPx[cell.col], h: rowPx[cell.row]
      });
    });
    const colsUsed = [...new Set(cells.map(c => c.col))].sort((a, b) => a - b);
    const pxW = Number.isFinite(p.pxW) ? p.pxW : (cumX[colsUsed[colsUsed.length - 1] + 1] - cumX[colsUsed[0]]);
    const pxH = Number.isFinite(p.pxH) ? p.pxH : H;
    // 负载：规则矩形=实际像素；异形按外接矩形保守计点（与选型口径一致）
    const loadBase = (p.rectangular === false && Number.isFinite(p.boundingPoints))
      ? p.boundingPoints : (Number.isFinite(p.points) ? p.points : pxW * pxH);
    ports.push({
      id,
      c0: colsUsed[0], c1: colsUsed[colsUsed.length - 1] + 1,
      cardCount: cardIdx.length, cardIdx,
      pxW, pxH, points: pxW * pxH,
      loadPct: +(loadBase / PORT_CAPACITY * 100).toFixed(1),
      sCard: cardIdx[0], eCard: cardIdx[cardIdx.length - 1]
    });
  });
  if (!cards.length || !ports.length) return null;

  const wires = [];
  for (const p of ports) for (let k = 0; k < p.cardIdx.length - 1; k++) {
    const a = cards[p.cardIdx[k]], b = cards[p.cardIdx[k + 1]];
    const dir = b.y > a.y ? "down" : b.y < a.y ? "up" : b.x > a.x ? "right" : "left";
    wires.push({ port: p.id, from: a.idx, to: b.idx, dir });
  }

  return {
    schema: "xhj-topo/1",
    screen: { w: W, h: H },
    grid: { cols: cg, rows: rg, cardCount: cards.length },
    route: { id: "h-TL", major: "h", corner: "TL", icon: null },
    portCapacity: PORT_CAPACITY,
    ports, cards, wires
  };
}

// HDSet 高保真仿真画布（含外壳）；数据不齐返回 ""（调用方回退）。
function renderHdsetFromResult(result) {
  const t = buildTopo(result);
  if (!t) return "";
  return render(t, { proc: result.processor && result.processor.name });
}

// 纯拓扑画布（无外壳）；数据不齐返回 ""。
function renderTopoOnlyFromResult(result) {
  const t = buildTopo(result);
  if (!t) return "";
  return renderTopoOnly(t);
}

module.exports = {
  renderHdsetFromResult,
  renderTopoOnly: renderTopoOnlyFromResult,
  buildTopo,
  PORT_CAPACITY
};
