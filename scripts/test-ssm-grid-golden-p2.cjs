// Golden：生成器 buildGridXml(P2 10宽8高) 必须逐字等于真机 standard-2port-p2-160x640.ssm 解出的明文网格
const path = require("path"), fs = require("fs");
const gen = require(path.join(__dirname, "..", "backend", "ordering", "ssm-generator.cjs"));
const eng = require(path.join(__dirname, "..", "backend", "ordering", "ordering-engine.cjs"));
const root = path.join(__dirname, "..");

const msg = process.argv[2] || "p2，10宽8高";
const r = eng.answerWithContext([msg]);
const result = r.result || r;
if (!result || !result.ok) { console.error("配单失败:", (r && r.resultState) || r); process.exit(2); }
const L = gen.buildLayout(result);
const got = gen.buildGridXml(L);

const fx = fs.readFileSync(path.join(root, "backend", "ordering", "ssm-fixtures", "standard-2port-p2-160x640.ssm"), "utf8");
const m = fx.match(/<SendCardPage\b[^>]*?\bValue="([A-Za-z0-9+/=]+)"[^>]*?\/>/);
const outer = Buffer.from(m[1], "base64").toString("utf8");
let want = null;
for (const g of (outer.match(/[A-Za-z0-9+/=]{120,}/g) || [])) {
  const t = Buffer.from(g, "base64").toString("utf8");
  if (/<cell|rowCount|<port/.test(t)) { want = t; break; }
}
const norm = s => String(s).replace(/\r/g, "").trim();
const ok = norm(got) === norm(want);
console.log("ports=", L.ports.map(p => p.cells.length).join("+"), " card=", result.card && result.card.name);
console.log("--- GOT (generator) ---"); console.log(got);
console.log("--- WANT (real HDSet export) ---"); console.log(want);
console.log("GRID_GOLDEN_MATCH =", ok);
process.exit(ok ? 0 : 1);
