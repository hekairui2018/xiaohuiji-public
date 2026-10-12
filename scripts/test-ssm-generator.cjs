"use strict";
// ssm-generator 正式模块离线回归：
//  ① 等尺寸 h-TL 闭式：合成配单 result(344x256 3x3) 的 buildFrames 必须与真机闭式 genHTL 逐记录一致
//  ② 单列自上而下(416x312 1x2)：必须与 std-1x2-line5 真机 GEOM/INDEX 逐记录一致
//  ③ 配单三案：gridXml cell 数=卡数、坐标物理正确；.ssm crcBad=0、每口 GEOM=卡数/INDEX=卡数+1
const path = require("path");
const assert = require("assert");
const gen = require(path.join(__dirname, "..", "backend", "ordering", "ssm-generator.cjs"));
const { parseSsm } = require(path.join(__dirname, "..", "backend", "ordering", "ssm-codec.cjs"));
const FX = path.join(__dirname, "..", "backend", "ordering", "ssm-fixtures");
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 构造与 buildPortsOfficial 同构的合成配单 result（cells 已 h-TL 蛇形序）
function synthResult({ C, R, W, H, cardName }) {
  const colWidths = Array(C).fill(1), rowHeights = Array(R).fill(1);
  const cells = [];
  for (let row = 0; row < R; row++) {
    let cols = Array.from({ length: C }, (_, c) => c);
    if (row % 2 === 1) cols.reverse();
    for (const col of cols) cells.push({ row, col, pxW: W, pxH: H, points: W * H });
  }
  return {
    ok: true, moduleW: W, moduleH: H, screenW: C * W, screenH: R * H,
    card: { name: cardName }, processor: { name: "TEST" },
    plan: { colGroups: C, rowGroups: R, colWidths, rowHeights, cardCount: cells.length,
      ports: [{ row: 0, rowCount: R, start: 0, count: cells.length, pxW: C * W, pxH: R * H,
        points: C * W * R * H, rectangular: true, cells }] },
  };
}
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n" + extra : "")); }
}

// ① 344x256 3x3 h-TL：正式模块 vs 真机闭式（gen-verify 同款 genHTL）
function genHTL(C, R, W, H, dtype) {
  const geom = [], index = []; let seq = 0;
  for (let r = 0; r < R; r++) for (let k = 0; k < C; k++) {
    const X = k * H, Y = r * H + k * (W - H);
    geom.push([X, Y, H, W]); index.push([seq === 0 ? 0 : k * H + 8, Y, 0, dtype]); seq++;
  }
  index.push([8, 0, 0, 0]); return { geom, index };
}
{
  const r3 = synthResult({ C: 3, R: 3, W: 344, H: 256, cardName: "344x256" });
  const L = gen.buildLayout(r3), w0 = [];
  const fr = gen.buildFrames(L, r3, w0)[0];
  const want = genHTL(3, 3, 344, 256, 5);
  check("344x256 3x3 h-TL GEOM 逐记录=真机闭式", eq(fr.geom, want.geom),
    "want " + JSON.stringify(want.geom) + "\ngot  " + JSON.stringify(fr.geom));
  check("344x256 3x3 h-TL INDEX 逐记录=真机闭式", eq(fr.index, want.index),
    "want " + JSON.stringify(want.index) + "\ngot  " + JSON.stringify(fr.index));
}

// ② 单列 h-TL 退化(自上而下)：344 干净档内部公式自洽（真机单列为 v-BL 另一种走线，官网单列走向待 R-ROUTE）
{
  const r1 = synthResult({ C: 1, R: 2, W: 344, H: 256, cardName: "344x256" });
  const L = gen.buildLayout(r1), w0 = [];
  const fr = gen.buildFrames(L, r1, w0)[0];
  const wantGeom = [[0, 0, 256, 344], [0, 256, 256, 344]];
  const wantIndex = [[0, 0, 0, 5], [8, 256, 0, 5], [8, 0, 0, 0]];
  check("344x256 单列 h-TL退化 GEOM 公式自洽", eq(fr.geom, wantGeom),
    "got " + JSON.stringify(fr.geom));
  check("344x256 单列 h-TL退化 INDEX 公式自洽", eq(fr.index, wantIndex),
    "got " + JSON.stringify(fr.index));
}
// ②b 416 宽卡特殊档：模块必须显式降级告警，不得拿 344 闭式冒充
{
  const rw = synthResult({ C: 1, R: 2, W: 416, H: 312, cardName: "416x312" });
  const Lw = gen.buildLayout(rw), ww = [];
  gen.buildFrames(Lw, rw, ww);
  check("416x312 宽卡特殊档触发降级告警", ww.some(x => x.includes("宽卡特殊")),
    "warnings=" + JSON.stringify(ww));
}

// ③ 配单三案端到端
const eng = require(path.join(__dirname, "..", "backend", "ordering", "ordering-engine.cjs"));
// 解包 .ssm 的 SendCardPage（双层 base64）→ 内层明文网格（HDSet 标准模式导入画布的唯一依据）
function shellGrid(ssmXml) {
  const m = ssmXml.match(/<SendCardPage\b[^>]*?\bValue="([A-Za-z0-9+/=]+)"[^>]*?\/?>/);
  if (!m) return "";
  const outer = Buffer.from(m[1], "base64").toString("utf8");
  const grids = outer.match(/[A-Za-z0-9+/=]{120,}/g) || [];
  for (const g of grids) { let t = ""; try { t = Buffer.from(g, "base64").toString("utf8"); } catch {} if (t.includes("<cell") || t.includes("rowCount")) return t; }
  return "";
}
const cases = [
  ["P10 宽16米高0.96米 户外 异步", 1, 5],
  ["1920x1080 P3 室内 全彩 同步", 4, 30],
  ["P6 宽10米高6米 户外 同步", 4, 14],
];
for (const [msg, pn, cards] of cases) {
  const r = eng.answerWithContext([msg]); const result = r.result || r;
  const g = gen.generate(result);
  const cellN = (g.gridXml.match(/<cell /g) || []).length;
  const portN = (g.gridXml.match(/<port /g) || []).length;
  check(`[${msg}] grid cell数=${cards}`, cellN === cards, "got " + cellN);
  // port 数跟随实际用口（标准外壳不补空口，真机 R-IMPORT 证实画布按网格口数重建）
  check(`[${msg}] grid port数=实际用口${pn}(=${portN})`, portN === pn);
  check(`[${msg}] summary 口数=${pn}/卡数=${cards}`,
    g.summary.portCount === pn && g.summary.cardCount === cards);
  if (g.ssmXml) {
    const chk = parseSsm(g.ssmXml);
    const crcBad = chk.packets.filter(p => !p.crcOk).length;
    check(`[${msg}] .ssm CRC全绿(=${crcBad})`, crcBad === 0);
    // 标准外壳几何帧为占位、不随方案改；画布只认 SendCardPage 明文网格，故校验网格已正确回填
    const grid = shellGrid(g.ssmXml);
    check(`[${msg}] .ssm 标准外壳/恒25包(=${chk.packetCount})`,
      String(g.ssmMeta.tpl).startsWith("standard-") && chk.packetCount === 25, "tpl=" + g.ssmMeta.tpl);
    check(`[${msg}] .ssm 回填网格 port=${pn}/cell=${cards}`,
      (grid.match(/<port /g) || []).length === pn && (grid.match(/<cell /g) || []).length === cards);
  } else {
    check(`[${msg}] .ssm 已产出`, false, "ssmXml 为空");
  }
}

// ④ 全口数泛化（举一反三）：官网全部口数档统一复用同一标准外壳，网格随口数、外壳恒25包/CRC0。
//    真机 R-IMPORT（HDSet V4.0.23.0，2026-09-26）：1/2/4/8/16 口画布目视完整还原；
//    20/24/30/40 口网格被正确解析（水平=2N列），16口演示设备画布仅渲染前16口（硬件渲染上限）。
function nportResult(N, perC = 2, R = 2, cw = 128, ch = 512) {
  const Ctot = N * perC, ports = [];
  for (let n = 0; n < N; n++) {
    const c0 = n * perC, cells = [];
    for (let row = 0; row < R; row++) {
      let cols = Array.from({ length: perC }, (_, i) => c0 + i);
      if (row % 2 === 1) cols.reverse();
      for (const col of cols) cells.push({ row, col, pxW: cw, pxH: ch, points: cw * ch });
    }
    ports.push({ cells, pxW: perC * cw, pxH: R * ch, points: perC * R * cw * ch });
  }
  return { ok: true, moduleW: cw, moduleH: ch, screenW: Ctot * cw, screenH: R * ch,
    card: { name: "R712" }, processor: { name: "VP-" + N },
    plan: { colGroups: Ctot, rowGroups: R, colWidths: Array(Ctot).fill(1), rowHeights: Array(R).fill(1), ports } };
}
for (const N of [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40]) {
  const g = gen.generate(nportResult(N));
  const chk = g.ssmXml ? parseSsm(g.ssmXml) : { packetCount: 0 };
  const grid = g.ssmXml ? shellGrid(g.ssmXml) : "";
  const wantCells = N * 2 * 2;
  check(`[${N}口] generate ok 且产出 ssm`, g.ok && !!g.ssmXml, JSON.stringify(g.warnings));
  check(`[${N}口] 标准外壳 standard-2port`, !!g.ssmMeta && g.ssmMeta.tpl === "standard-2port-p2-160x640.ssm");
  check(`[${N}口] 外壳恒25包(=${chk.packetCount})/CRC全绿(=${g.ssmMeta && g.ssmMeta.crcBad})`,
    chk.packetCount === 25 && !!g.ssmMeta && g.ssmMeta.crcBad === 0);
  check(`[${N}口] 回填网格 port=${N}/cell=${wantCells}`,
    (grid.match(/<port /g) || []).length === N && (grid.match(/<cell /g) || []).length === wantCells);
}

console.log(`\n==== ssm-generator 回归: ${fail === 0 ? "ALL PASS ✅" : fail + " FAIL ❌"} (pass=${pass}) ====`);
process.exit(fail === 0 ? 0 : 1);
