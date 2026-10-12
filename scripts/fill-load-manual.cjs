// 手工补录带载（数据层）：仅用于规格书索引缺失、但有确凿内部来源的型号。
// 来源写进 _loadSource 便于审计；只填 keyParameters.load，不覆盖已有值。可重复运行。
const fs = require("fs");
const F = "D:\\xiaohuiji\\data\\product-specs-index.json";
const MANUAL = {
  "HD-VP8000M": { load: "最大带载9961万像素（2U/3U/6U/12U机箱分别1572/2097/4718/9961万）", src: "HD-VP8000M规格书V2.3.2：混合插卡机箱分档，满配12U=9961万" },
  "HD-C16C":   { load: "最大带载12万像素", src: "灰度科技2021最新培训资料：C16C 12万像素/8192宽/10×HUB75E" }
};
const raw = JSON.parse(fs.readFileSync(F, "utf8").replace(/^﻿/, ""));
let n = 0;
for (const p of raw.products || []) {
  const name = p.displayName || p.product;
  const m = MANUAL[name];
  if (!m) continue;
  p.keyParameters = p.keyParameters || {};
  if (p.keyParameters.load && p.keyParameters.load.trim()) { console.log("跳过(已有):", name); continue; }
  p.keyParameters.load = m.load;
  p._loadSource = m.src;
  n++;
  console.log("补录:", name, "->", m.load);
}
fs.writeFileSync(F, JSON.stringify(raw, null, 2) + "\n", "utf8");
console.log("补录条数:", n);
