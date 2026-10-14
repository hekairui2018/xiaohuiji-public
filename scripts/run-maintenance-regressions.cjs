'use strict';
// Local regression receipt. Never changes expectations or overwrites prior runs.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, process.argv[2] || 'tmp/maintenance-tests.json');
if (!output.startsWith(path.join(root, 'tmp') + path.sep)) throw Error('Receipts belong in workspace tmp');
if (fs.existsSync(output)) throw Error('Preserve previous test receipt');
const tests = [
  'scripts/golden/run-nlu-golden.cjs', 'scripts/test-ssm-generator.cjs',
  'scripts/test-ssm-grid-golden-p2.cjs', 'scripts/test-feishu-bitable.cjs',
  'scripts/test-wecom-core-source.cjs', 'scripts/test-phenomenon-recognition.cjs',
  'scripts/test-data-provenance.cjs', 'scripts/test-aftersales-model-identity.cjs',
  'scripts/test-aftersales-source-claims.cjs', 'scripts/test-corpus-smoke.cjs',
  ...process.argv.slice(3)
];
const rows = tests.map(file => {
  const run = cp.spawnSync(process.execPath, [file], {cwd:root, encoding:'utf8', timeout:120000,
    env:{...process.env, LLM_API_KEY:''}, maxBuffer:16*1024*1024});
  const row = {file, exitCode:run.status, signal:run.signal, error:run.error?.message,
    stdout:run.stdout, stderr:run.stderr};
  console.log(`${run.status === 0 ? 'PASS' : 'FAIL'} ${file}`);
  return row;
});
fs.mkdirSync(path.dirname(output), {recursive:true});
fs.writeFileSync(output, JSON.stringify({date:new Date().toISOString(), rows}, null, 2));
if (rows.some(row=>row.exitCode!==0)) process.exitCode=1;
