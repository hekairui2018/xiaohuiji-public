/* 校验：对 firmware-manifest.json 里全部对象做匿名 HEAD，确认公共可读、大小一致；抽查特殊文件名下载头。 */
const fs = require("fs");
const path = require("path");
const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "firmware-manifest.json"), "utf8"));

async function head(url, n = 0) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r;
  } catch (e) {
    if (n < 2) { await new Promise((s) => setTimeout(s, 800)); return head(url, n + 1); }
    throw e;
  }
}
(async () => {
  const items = m.items;
  console.log(`manifest: ${m.count} 个, ${m.totalMB} MB, 更新于 ${m.updatedAt}`);
  const conc = 8;
  let ok = 0, bad = 0;
  const bads = [];
  for (let i = 0; i < items.length; i += conc) {
    const batch = items.slice(i, i + conc);
    const res = await Promise.all(batch.map(async (it) => {
      const r = await head(it.publicUrl);
      const len = Number(r.headers.get("content-length"));
      const good = r.status === 200 && len === it.sizeBytes;
      return { it, status: r.status, len, good, disp: r.headers.get("content-disposition") };
    }));
    for (const x of res) {
      if (x.good) ok++; else { bad++; bads.push(x); }
    }
  }
  console.log(`匿名 HEAD：通过 ${ok}/${items.length}，失败 ${bad}`);
  if (bads.length) for (const x of bads.slice(0, 20)) console.log("  ✗", x.status, x.len, "/", x.it.sizeBytes, x.it.publicUrl);

  // 特殊文件名下载头抽查：中文(贴膜屏)、空格目录(R5s Plus)、双点(R512 ..bin)、显式ICN2065
  const probes = ["RB6/RB6_贴膜屏_V23.68.23.33.bin", "R5s Plus/R5s_Plus_FPGA_V24.24.63.37_MCU_V24.01.23.20_MCU2_V25.00.05.21.bin",
    "R512/R512_V22.06.01.81..bin", "R500S/R500S_ICN2065_23.00.65.85.bin", "R708/R708_FPGA_V25.26.65.32.bin"];
  const base = `https://${m.bucket}.${m.region}.aliyuncs.com/${m.prefix}/`;
  console.log("\n特殊文件名下载头：");
  for (const rel of probes) {
    const url = base + rel.split("/").map(encodeURIComponent).join("/");
    const r = await head(url);
    console.log(`  [${r.status}] ${rel}`);
    console.log(`     disposition: ${r.headers.get("content-disposition")}`);
  }

  // 每卡型“最新正式版（无变体）”分组概览
  console.log("\n各卡型默认将展示的最新正式版（每系列一条，专用/变体折叠）：");
  const byCard = {};
  for (const it of items) (byCard[it.card] = byCard[it.card] || []).push(it);
  for (const card of Object.keys(byCard).sort()) {
    const latest = byCard[card].filter((x) => x.latestInSeries).map((x) => x.series);
    const variants = byCard[card].filter((x) => x.variant).map((x) => `${x.series}:${x.variant}`);
    console.log(`  ${card.padEnd(9)} 正式系列[${latest.join(",")}]${variants.length ? `  专用/变体[${variants.join("; ")}]` : ""}`);
  }
})();
