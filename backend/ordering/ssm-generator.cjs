"use strict";
// ssm-generator.cjs — 为「官网配单逻辑」量身定做的 HDSet 连屏「生图 + 生参数」生成器
//
// 输入：ordering-engine.calculate/answerWithContext 的成功 result（plan.ports[].cells 已按 h-TL 蛇形序排好）
// 产出：
//   1) gridXml   HDSet 标准模式「快速设置」明文网格 XML（SendCardPage 内层 IR）
//                —— 逐 cell 物理矩形(x/y/width/height) + 口内走线序，schema 已真机逆向，物理确定正确，
//                   原生支持不等宽/不等高卡（边缘口少带模组）。
//   2) frames    每口 GEOM(0x15)/INDEX(0x05)/REGION(0x52) 传输帧记录（发送卡显存仿射）
//                —— 等尺寸卡走真机逐记录验证过的仿射闭式（344×256 档 6 口 PASS）；
//                   竖高卡/不等宽高为线性推广，REGION 多口竖条闭式待真机采样，均打 warning，不伪装可信。
//   3) ssmXml    统一套同一份真机「标准快速设置」外壳(standard-2port，恒25包、外壳/ConnectPartRange/CRC 不动)，
//                仅双层 base64 回填明文网格；外壳 Packet 几何帧(INDEX/GEOM/REGION)/DeviceID/Raw 原样保留。
//
// 真机 R-IMPORT 结论（HDSet V4.0.23.0，2026-09-26，见 docs/ssm-真机验证-全口数-20260926.md）：
//   标准模式「导入」画布的分口/卡数/卡坐标/宽高/负载完全由 SendCardPage 明文网格唯一决定，
//   与外壳口数/几何帧/DeviceID 无关：1/2/4/8/16 口已真机目视完整还原（蛇形/口区色/负载全对）；
//   20/24/30/40 口网格被正确解析（当前信息水平=2N列），16口演示设备画布仅渲染前16口（硬件渲染上限），
//   >16口需对应口数处理器真机目视。gridXml 物理闭式高可信；几何帧为外壳占位、不参与导入画布，真实下发前以 HDSet 为准。
// 见 docs/ssm格式取证-20260915.md 第十五节。零第三方依赖。

const fs = require("fs");
const path = require("path");
const { parseSsm, crc32 } = require(path.join(__dirname, "ssm-codec.cjs"));

const FX = path.join(__dirname, "ssm-fixtures");
const HEAD = Buffer.from([0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0xD5]);
const enc = (pl) => {
  const c = Buffer.alloc(4); c.writeUInt32LE(crc32(pl) >>> 0, 0);
  return Buffer.concat([HEAD, pl, c]);
};
// 在模板帧（固定记录区容量）里重写记录，保留帧头与尾部；记录数超容量返回 null
function rebuild(frame, records) {
  const pl = frame.pl, head = pl.slice(0, 8);
  const cap = Math.floor((pl.length - 8) / 8);          // 该帧记录区容量（条）
  const rl = cap * 8;
  if (records.length > cap) return null;
  const rb = Buffer.alloc(rl, 0);
  records.forEach((r, i) => { for (let j = 0; j < 4; j++) rb.writeUInt16LE((r[j] || 0) & 0xffff, i * 8 + j * 2); });
  return enc(Buffer.concat([head, rb, pl.slice(8 + rl)]));
}
const b64 = s => Buffer.from(s, "utf8").toString("base64");
const unb64 = s => Buffer.from(s, "base64").toString("utf8");

// 已真机校准的卡型常数（dtype = INDEX 记录第4字）。新卡型必须真机采样后补，勿臆造。
// 344×256→5（fourports/multiport 6 口逐记录验证）；416×312→26（complex-3x3 宽卡档）。
const CARD_DTYPE = { "344x256": 5, "416x312": 26 };
const INDEX_TAIL = [8, 0, 0, 0];
const NONFIRST_X_OFFSET = 8;   // 344×256 档：非首卡 INDEX.a = GEOM.X + 8

// ---------- 1) result.plan → 口/卡结构化（与 topo-hdset 适配器同口径）----------
function buildLayout(result) {
  const plan = result.plan;
  const cg = plan.colGroups, rg = plan.rowGroups, modW = result.moduleW, modH = result.moduleH;
  const colPx = plan.colWidths.map(m => m * modW);
  const rowPx = plan.rowHeights.map(m => m * modH);
  const cumX = [0]; colPx.forEach((w, i) => cumX.push(cumX[i] + w));
  const cumY = [0]; rowPx.forEach((h, i) => cumY.push(cumY[i] + h));
  const W = cumX[cumX[cumX.length - 1]] || cumX[colPx.length];
  const ports = plan.ports.map((p, pi) => {
    const cells = (p.cells || []).map(c => ({
      row: c.row, col: c.col, x: cumX[c.col], y: cumY[c.row], w: c.pxW, h: c.pxH,
    }));
    const cols = [...new Set(cells.map(c => c.col))].sort((a, b) => a - b);
    const rows = [...new Set(cells.map(c => c.row))].sort((a, b) => a - b);
    return {
      net: pi + 1,
      c0: cols[0], c1: cols[cols.length - 1] + 1, C: cols.length, R: rows.length,
      cells, pxW: p.pxW, pxH: p.pxH, points: p.points, rectangular: p.rectangular !== false,
    };
  });
  return { colPx, rowPx, cumX, cumY, W, H: cumY[rowPx.length], cg, rg, ports };
}

// ---------- 2) 明文网格 XML（标准模式快速设置 IR，物理确定正确）----------
function buildGridXml(L) {
  const P = [];
  P.push('<?xml version="1.0" encoding="UTF-8"?>');
  P.push("<root>");
  P.push(` <rowCount value="${L.rg}"/>`);
  P.push(` <columnCount value="${L.cg}"/>`);
  // 真机 V4.0.38.11 标准模式「快速设置」另存 .ssm 逆向（样本 standard-2port-p2-160x640.ssm）：
  //  - 只输出实际用到的口（2 口设备就 2 个 <port>，不补空口；旧 4 口设备样本固定 4 个含空口自闭合）；
  //  - <port port x y> 属性字母序，port.x/y = 该口在整屏的全局起点；
  //  - <cell column height row width x y> 属性字母序；column/row 为整屏全局列行号，
  //    而 cell.x/y 是「口内相对坐标」(=全局 − port 起点)；真机口2 首卡 column=6 但 x=0、port2.x=960。
  for (let n = 1; n <= L.ports.length; n++) {
    const port = L.ports[n - 1];
    if (!port || !port.cells.length) continue;
    const gx = Math.min(...port.cells.map(c => c.x));
    const gy = Math.min(...port.cells.map(c => c.y));
    P.push(` <port port="${n}" x="${gx}" y="${gy}">`);
    // cells 已是 h-TL 走线 S→E 序
    for (const c of port.cells)
      P.push(`  <cell column="${c.col}" height="${c.h}" row="${c.row}" width="${c.w}" x="${c.x - gx}" y="${c.y - gy}"/>`);
    P.push(` </port>`);
  }
  P.push("</root>");
  return P.join("\n");
}

// ---------- 3) 传输帧记录（显存仿射）----------
// 等尺寸 h-TL（含单列退化）真机闭式；返回 {geom,index,route,uniform,note}
function framesForPort(port, dtype, warnings) {
  const { cells, C, R, net } = port;
  const W0 = cells[0].w, H0 = cells[0].h;
  const uniform = cells.every(c => c.w === W0 && c.h === H0);
  const singleCol = C === 1;
  const route = singleCol ? "h-TL(单列退化)" : "h-TL";
  const geom = [], index = [];
  cells.forEach((c, seq) => {
    const r = c.row;
    const j = c.col - port.c0;                       // 口内相对列
    const k = (r % 2 === 1) ? (C - 1 - j) : j;       // 行内沿走线步号（奇行蛇形反向）
    let X, Y, H, W;
    if (uniform) {
      W = W0; H = H0;
      X = k * H;
      Y = r * H + k * (W - H);
    } else {
      // 线性推广（未真机验证）：X=沿走线累计卡高；Y=行基线+累计(宽−高)斜切
      H = c.h; W = c.w;
      let Xa = 0; for (let t = 0; t < k; t++) Xa += c.h;
      let rowBase = 0; for (let rr = 0; rr < r; rr++) rowBase += port.cells.find(z => z.col === port.c0 && z.row === rr)?.h || c.h;
      let skew = 0;
      for (let t = 0; t < k; t++) {
        const colT = (r % 2 === 1) ? port.c1 - 1 - t : port.c0 + t;
        const ct = port.cells.find(z => z.col === colT && z.row === r);
        if (ct) skew += ct.w - c.h;
      }
      X = Xa; Y = rowBase + skew;
      warnings.push(`口${net} 含不等宽/高卡，GEOM/INDEX 为线性推广，待 R-CARD 真机校准`);
    }
    geom.push([X, Y, H, W]);
    index.push([seq === 0 ? 0 : X + NONFIRST_X_OFFSET, Y, 0, dtype]);
  });
  index.push(INDEX_TAIL.slice());
  if (!uniform) { /* 已逐条 warn，去重见外层 */ }
  else if (W0 < H0) warnings.push(`口${net} 为竖高卡(${W0}×${H0})，仿射闭式仅在横宽卡(344×256)验证，待 R-CARD`);
  return { geom, index, route, uniform, W: W0, H: H0 };
}

function buildFrames(L, result, warnings) {
  const card = result.card && result.card.name;
  const frames = [];
  L.ports.forEach(port => {
    if (!port.cells.length) { frames.push({ net: port.net, geom: [], index: [], region: null }); return; }
    const w0 = port.cells[0].w, h0 = port.cells[0].h, key = `${w0}x${h0}`;
    let dtype = CARD_DTYPE[key];
    if (dtype == null) {
      dtype = 5;   // 缺省回退 344 档常数
      warnings.push(`口${port.net} 卡型 ${card || ""}(${w0}×${h0}) 的 dtype 未采样，暂用 5，待 R-CARD`);
    }
    // 416×312 宽卡是独立仿射档（真机：首卡第三字256、斜切56、非首卡+9、尾记录带56/9），
    // 与 344 干净闭式不同构；干净样本未取，绝不拿 344 公式冒充可信。
    if (key === "416x312")
      warnings.push(`口${port.net} 为 416×312 宽卡特殊仿射档(256/56/+9)，干净闭式未建模，当前帧仅供结构占位、禁止下发，待 R-CARD`);
    const f = framesForPort(port, dtype, warnings);
    frames.push({ net: port.net, ...f, region: null });
  });
  // REGION(0x52) 规整全高竖条闭式无真机样本：不臆造，留给模板原值并整体告警
  if (L.ports.length > 1) warnings.push("多口 REGION(0x52) 区域帧为模板原值，规整竖条闭式待 R-REGION 真机采样");
  return frames;
}

// ---------- 4) 双层 base64 回填 SendCardPage 网格 ----------
function leafVal(xml, name) {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*?\\bValue="([A-Za-z0-9+/=]+)"[^>]*?/>`));
  return m ? m[1] : null;
}
function replaceGrid(xml, gridXml) {
  const spOld = leafVal(xml, "SendCardPage");
  if (!spOld) return { xml, changed: false };
  const sp = unb64(spOld);
  const grids = sp.match(/[A-Za-z0-9+/=]{120,}/g) || [];
  let sp2 = sp, innerChanged = false;
  for (const g of grids) {
    const t = (() => { try { return unb64(g); } catch { return ""; } })();
    if (t.includes("<cell") || t.includes("rowCount") || t.includes("<port")) {
      sp2 = sp.split(g).join(b64(gridXml)); innerChanged = true; break;
    }
  }
  if (!innerChanged) return { xml, changed: false };
  const spNew = b64(sp2);
  return { xml: xml.split(spOld).join(spNew), changed: true };
}

// ---------- 5) 组装 .ssm：任意口数统一复用真机「标准快速设置」外壳，只回填明文网格 ----------
// 真机 R-IMPORT（HDSet V4.0.23.0，2026-09-26）：2 口标准外壳灌入 1/4/16/40 口网格，画布一律按网格重建
// （1/2/4/8/16 口目视完整还原；>16 口网格被解析、画布受演示设备16口硬件渲染上限截断）。
// 故不再按口数切模板、不再用复杂模式(fourports)模板，一个标准外壳通吃官网全部口数档 1/2/4/6/8/10/12/16/20/24/30/40。
const STANDARD_SHELL = "standard-2port-p2-160x640.ssm";
function templateFor(/* portN：任意口数均用同一标准外壳，参数保留以兼容调用 */) {
  return STANDARD_SHELL;
}
function buildSsm(L, frames, gridXml, warnings) {
  // frames（几何帧）仅服务旧复杂模式链路；标准快速设置画布只认 SendCardPage 明文网格，
  // 外壳 Packet 几何帧(INDEX/GEOM/REGION)/DeviceID/Raw 原样占位、不重写（真机证实不参与导入画布）。
  const tpl = templateFor(L.ports.length);
  const tplPath = path.join(FX, tpl);
  let xml = fs.readFileSync(tplPath, "utf8");
  const g0 = replaceGrid(xml, gridXml);
  if (!g0.changed) { warnings.push("标准外壳 SendCardPage 明文网格回填失败，未产出 .ssm"); return null; }
  xml = g0.xml;
  // 自检：重解析 CRC（只改 SendCardPage b64、Packet 帧未动，应恒为 0）
  const chk = parseSsm(xml);
  const crcBad = chk.packets.filter(p => p.crcOk === false).length;
  if (crcBad) warnings.push(`生成 .ssm 存在 ${crcBad} 帧 CRC 异常`);
  warnings.push(L.ports.length > 16
    ? `${L.ports.length} 口网格已写入标准外壳：HDSet 导入按网格解析，>16 口画布需对应口数处理器真机目视；几何帧为外壳占位，真实下发前以 HDSet 为准`
    : "标准快速设置外壳+明文网格，HDSet 导入按网格重建（1/2/4/8/16 口真机目视通过）；几何帧为外壳占位，真实下发前以 HDSet 为准");
  return { ssmXml: xml, tpl, packetCount: chk.packetCount, crcBad };
}

// ---------- 总入口 ----------
function generate(result) {
  const warnings = [];
  if (!result || !result.ok || !result.plan || !Array.isArray(result.plan.ports) || !result.plan.ports.length)
    return { ok: false, warnings: ["输入非成功配单结果，无法生成连屏"] };
  const L = buildLayout(result);
  const gridXml = buildGridXml(L);
  // 几何帧闭式的 warning 先收进独立数组：标准「快速设置」模板导入时画布只按 SendCardPage 明文网格重建、
  // 几何帧沿用真机模板（docs 第十八节 差分+R-IMPORT 双证），"dtype 未采样/竖高卡闭式/REGION 原值"等告警对
  // standard 模板不适用，丢弃；仅复杂模式模板（画面真由几何帧决定）才并入最终 warning。
  const frameWarnings = [];
  const frames = buildFrames(L, result, frameWarnings);
  const ssm = buildSsm(L, frames, gridXml, warnings);
  if (!(ssm && String(ssm.tpl).startsWith("standard-"))) frameWarnings.forEach(w => warnings.push(w));
  const uniqWarn = [...new Set(warnings)];
  const summary = {
    screen: [result.screenW, result.screenH],
    card: result.card && result.card.name,
    processor: result.processor && result.processor.name,
    portCount: L.ports.length,
    cardCount: L.ports.reduce((s, p) => s + p.cells.length, 0),
    ports: L.ports.map(p => ({ net: p.net, cards: p.cells.length, C: p.C, R: p.R, pxW: p.pxW, pxH: p.pxH, points: p.points, loadPct: +(p.points / 655360 * 100).toFixed(1) })),
  };
  return { ok: true, gridXml, frames, ssmXml: ssm && ssm.ssmXml, ssmMeta: ssm ? { tpl: ssm.tpl, packetCount: ssm.packetCount, crcBad: ssm.crcBad } : null, summary, warnings: uniqWarn };
}

module.exports = { generate, buildLayout, buildGridXml, buildFrames, buildSsm, CARD_DTYPE };

// CLI：node ssm-generator.cjs "<配单口语>" [outDir]
if (require.main === module) {
  const msg = process.argv[2] || "1920x1080 P3 室内 全彩 同步";
  const outDir = process.argv[3] || path.join(__dirname, "..", "..", "tmp", "gen");
  const eng = require(path.join(__dirname, "ordering-engine.cjs"));
  const r = eng.answerWithContext ? eng.answerWithContext([msg]) : eng.calculate(msg);
  const result = r.result || r;
  const g = generate(result);
  if (!g.ok) { console.error(g.warnings.join("\n")); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  const safe = String(msg).replace(/[^\w\u4e00-\u9fa5]+/g, "_").slice(0, 40);
  const gridPath = path.join(outDir, safe + ".grid.xml");
  const ssmPath = path.join(outDir, safe + ".ssm");
  fs.writeFileSync(gridPath, g.gridXml, "utf8");
  if (g.ssmXml) fs.writeFileSync(ssmPath, g.ssmXml, "utf8");
  console.log(JSON.stringify(g.summary, null, 2));
  console.log("grid ->", gridPath);
  if (g.ssmXml) console.log("ssm  ->", ssmPath, "meta=", JSON.stringify(g.ssmMeta));
  console.log("warnings:"); g.warnings.forEach(w => console.log("  - " + w));
}
