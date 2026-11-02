'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('./check.cjs');

test('syntax rules distinguish conditional expressions from comments and literals', () => {
  const source = "const example = '???'; // ? : require('unused')\nconst value = first ? second ? third ? 1 : 2 : 3 : 4;";
  const rules = inspect('synthetic.cjs', source).map((item) => item.rule);
  assert.deepEqual(rules, ['ternary-depth-2']);
});

test('only requires within functions are flagged and violations have stable fingerprints', () => {
  const source = "const source = require('top'); function load() { return require('inner'); }";
  const first = inspect('synthetic.cjs', source);
  const second = inspect('synthetic.cjs', source.replace('return require', 'return  require'));
  assert.equal(first.length, 1);
  assert.equal(first[0].rule, 'function-require');
  assert.equal(first[0].hash, second[0].hash);
});

test('a new overlength source line is reported without confusing it with an existing file exemption', () => {
  const source = 'const text = ' + JSON.stringify('x'.repeat(170)) + ';';
  assert.equal(inspect('new.cjs', source)[0].rule, 'max-line-160');
  assert.deepEqual(inspect('new.cjs', 'const text = "short";'), []);
});
