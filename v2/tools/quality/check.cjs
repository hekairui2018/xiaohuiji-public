'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const acorn = require('./node_modules/acorn');
const root = path.resolve(__dirname, '../../..');
const baselinePath = path.join(__dirname, 'baseline.json');
const canonical = (value) => value.replace(/\s+/g, '');
const digest = (value) => crypto.createHash('sha256').update(canonical(value)).digest('hex');

function inspect(file, source) {
  const violations = [];
  const add = (rule, node, text) => violations.push({ file, rule, line: node, hash: digest(text) });
  source.split('\n').forEach((line, index) => {
    if (line.length > 160) add('max-line-160', index + 1, line);
  });
  const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  function walk(node, functions = 0, ternaries = 0) {
    if (!node || typeof node.type !== 'string') return;
    const depth = /^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)
      ? functions + 1
      : functions;
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require' &&
      functions
    ) {
      add('function-require', node.loc.start.line, source.slice(node.start, node.end));
    }
    const conditionalDepth = node.type === 'ConditionalExpression' ? ternaries + 1 : 0;
    if (conditionalDepth > 2) add('ternary-depth-2', node.loc.start.line, source.slice(node.start, node.end));
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => walk(child, depth, conditionalDepth));
      else if (value && typeof value === 'object') walk(value, depth, conditionalDepth);
    }
  }
  walk(tree);
  return violations;
}

function trackedFiles() {
  return cp
    .execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'v2'], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => /\.(?:cjs|js)$/.test(file) && !file.startsWith('v2/tools/quality/node_modules/'));
}

function violationKey(value) {
  return JSON.stringify([value.file, value.rule, value.hash]);
}

function main() {
  if (process.argv.includes('--record-head-baseline')) {
    if (fs.existsSync(baselinePath)) throw Error('Baseline exists; do not silently reset existing debt');
    const counts = {};
    for (const file of trackedFiles()) {
      const source = cp.execFileSync('git', ['show', 'HEAD:' + file], { cwd: root, encoding: 'utf8' });
      for (const item of inspect(file, source))
        counts[violationKey(item)] = (counts[violationKey(item)] || 0) + 1;
    }
    fs.writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          sourceCommit: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
          counts,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Recorded HEAD debt; new violations are not exempt');
  } else {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).counts;
    let files = process.argv.slice(2);
    if (!files.length) {
      const options = { cwd: root, encoding: 'utf8' };
      files = [
        ...new Set([
          ...cp.execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'v2'], options).trim().split('\n'),
          ...cp
            .execFileSync('git', ['ls-files', '--others', '--exclude-standard', 'v2'], options)
            .trim()
            .split('\n'),
        ]),
      ];
    }
    files = files.filter((file) => /\.(?:js|cjs)$/.test(file) && fs.existsSync(path.join(root, file)));
    const used = {};
    const failures = [];
    for (const file of files) {
      for (const item of inspect(file, fs.readFileSync(path.join(root, file), 'utf8'))) {
        const key = violationKey(item);
        used[key] = (used[key] || 0) + 1;
        if (used[key] > (baseline[key] || 0)) failures.push(item);
      }
    }
    failures.forEach((item) => console.error(`${item.file}:${item.line} ${item.rule}`));
    console.log(`Checked ${files.length} files; ${failures.length} new violations`);
    process.exitCode = failures.length ? 1 : 0;
  }
}

if (require.main === module) main();

module.exports = { inspect };
