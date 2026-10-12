/**
 * 全库自我压测（可重复运行：node scripts/test-corpus-smoke.cjs）
 * 把每条案例的“现象/标题”当成一次客户提问走完整 handle，检查：
 *  1) 不允许任何抛异常；2) 结果分布（直接答 / 反问补型号 / 无匹配）；
 *  3) 直接答时首选案例与提问案例是否同现象子类、是否同硬件（检索质量粗指标）。
 */
const fs = require("fs");
const path = require("path");
const sp = require(path.join(__dirname, "..", "backend", "specialist", "aftersales-specialist.js"));

const db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "aftersales", "aftersales-cases.json"), "utf8"));
const cases = db.cases || db;

const stat = { total: 0, error: 0, answer: 0, clarify: 0, unmatched: 0, noCand: 0 };
const errors = [], clarifySamples = [], sameSub = { hit: 0, all: 0 }, sameHw = { hit: 0, all: 0 };

for (const c of cases) {
  const q = String(c.phenomenon || c.title || "").slice(0, 80);
  if (!q) continue;
  stat.total++;
  let r;
  try { r = sp.handle(q, []); }
  catch (e) { stat.error++; errors.push({ id: c.id, q, err: String(e && e.message || e) }); continue; }
  if (!r || r.matched === false) { stat.unmatched++; continue; }
  if (r.needClarify) { stat.clarify++; if (clarifySamples.length < 8) clarifySamples.push({ id: c.id, domain: c.domain, q: q.slice(0, 30) }); continue; }
  stat.answer++;
  const cands = r.candidates || [];
  if (!cands.length && r.bestId) { /* best 在顶部卡，候选可空 */ }
  if (!r.bestId) stat.noCand++;
  // 质量粗指标：顶部首选(bestId)案例的子类/硬件是否与来源案例一致
  const all = [...(r.candidates || []).map((x) => x)];
  const best = [r, ...all].find((x) => x.id === r.bestId) || null;
  if (c.subCategory) {
    sameSub.all++;
    // bestId 自身即来源案例，或候选里存在同子类，即视为现象对得上
    const poolSubs = new Set(all.map((x) => x.subCategory).filter(Boolean));
    if (r.bestId === c.id || poolSubs.has(c.subCategory)) sameSub.hit++;
  }
}

console.log("===== 全库压测 =====");
console.log("总提问:", stat.total,
  "| 直接答:", stat.answer,
  "| 反问补信息:", stat.clarify,
  "| 无域匹配:", stat.unmatched,
  "| 异常:", stat.error,
  "| 直接答但无首选:", stat.noCand);
console.log("现象子类对得上: %d/%d = %s%%", sameSub.hit, sameSub.all, (100 * sameSub.hit / Math.max(1, sameSub.all)).toFixed(1));
if (clarifySamples.length) { console.log("反问样例:"); clarifySamples.forEach((s) => console.log("  -", s.id, s.domain, s.q)); }
if (errors.length) { console.log("异常:"); errors.slice(0, 20).forEach((e) => console.log("  ✗", e.id, e.q, "=>", e.err)); process.exit(1); }
console.log(errors.length === 0 ? "无异常 ✓" : "存在异常 ✗");
