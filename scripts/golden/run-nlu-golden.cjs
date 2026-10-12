#!/usr/bin/env node
// 路由 NLU golden 回归
//   node scripts/golden/run-nlu-golden.cjs         默认：禁用模型，跑确定性层(layer=det)，任一失败 exit 1
//   node scripts/golden/run-nlu-golden.cjs --llm   开启 DeepSeek，仅跑端到端语义层(layer=llm)，失败仅告警(模型有波动)
// require backend/server.js 不会监听端口（listen 仅在 require.main===module）。
const fs = require("fs");
const path = require("path");

const useLlm = process.argv.includes("--llm");
if (!useLlm) process.env.LLM_API_KEY = ""; // 必须在 require server/llm-client 之前
const wantLayer = useLlm ? "llm" : "det";

const casesFile = path.join(__dirname, "nlu-golden-cases.json");
const data = JSON.parse(fs.readFileSync(casesFile, "utf8"));
const cases = data.cases.filter((c) => c.layer === wantLayer);
const srv = require(path.join(__dirname, "..", "..", "backend", "server.js"));

(async () => {
  let pass = 0, fail = 0;
  const fails = [];
  for (const c of cases) {
    let intent = "?", bk = "?", src = "?", esc = "-", lang = "-";
    try {
      const r = await srv.resolveRoute(c.q, []);
      intent = r.intent;
      bk = r.detail && r.detail.boundary ? r.detail.boundary.kind : "normal";
      src = r.detail ? r.detail.source : "?";
      esc = r.detail && r.detail.boundary ? r.detail.boundary.escalate : "-";
      lang = r.detail ? r.detail.language : "-";
    } catch (e) {
      fail++; fails.push({ c, got: `THROW ${e.message}` });
      console.log(`FAIL | ${c.id} 抛异常: ${e.message}`);
      continue;
    }
    const okIntent = intent === c.intent;
    const okBk = bk === c.boundary;
    const ok = okIntent && okBk;
    if (ok) pass++; else { fail++; fails.push({ c, got: `${intent}/${bk}` }); }
    console.log(
      (ok ? "PASS" : "FAIL") +
      ` | ${c.id} | ${intent}${okIntent ? "" : "(要" + c.intent + ")"}` +
      ` / ${bk}${okBk ? "" : "(要" + c.boundary + ")"}` +
      ` | src=${src} esc=${esc} lang=${lang} | ${c.note || ""} :: ${c.q}`
    );
  }
  console.log(`\n[${wantLayer}] ${pass} 通过 / ${fail} 失败 / 共 ${cases.length} 条`);
  if (!useLlm && fail > 0) {
    console.error("确定性 golden 存在失败，已 exit 1：");
    for (const f of fails) console.error("  -", f.c.id, "得到", f.got, "期望", f.c.intent + "/" + f.c.boundary);
    process.exit(1);
  }
  if (useLlm && fail > 0) {
    console.warn("模型层有用例未达期望（不阻塞），建议人工复核是否需要补确定性规则或优化 prompt：");
    for (const f of fails) console.warn("  -", f.c.id, "得到", f.got, "期望", f.c.intent + "/" + f.c.boundary);
  }
})();
