'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sp = require('../backend/specialist/aftersales-specialist.js');
const norm = v => String(v).toUpperCase().replace(/^HD[-_\s]?/, '').replace(/[^A-Z0-9]/g, '');
for (const [query, model] of [['A3','A3L'],['A3L','A3'],['VP620','VP620A'],['R512','R512T'],['C16','C16L'],['A3','A3'],['HD-A3','A3'],['VP620A','VP620A']]) {
  test(`Model identity ${query} vs ${model}`, () => {
    const c = { products: [model], chips: [], title: `${model}花屏` };
    assert.equal(sp.hwCoverage(c, { products: [norm(query), 'R712'], chips: [] }), norm(query) === norm(model) ? 0.5 : 0);
  });
}
test('Empty model never matches any device', () => {
  assert.equal(sp.hwCoverage({ products: [''], chips: [], title: '未填写型号' }, { products: ['A3', 'R712'], chips: [] }), 0);
});
test('Missing model field can use explicit exact model in source title', () => {
  assert.equal(sp.hwCoverage({ products: [], chips: [], title: 'HD-A3 花屏' }, { products: ['A3', 'R712'], chips: [] }), 0.5);
});
test('pickBest does not classify suffix case as same hardware', () => {
  const exact = { id: 'exact', products: ['A3'], chips: [], title: 'A3 花屏', subCategory: '花屏乱码' };
  const wrong = { id: 'suffix', products: ['A3L'], chips: [], title: 'A3L 花屏', subCategory: '花屏乱码' };
  const best = sp.pickBest([{ c: wrong, s: 99 }, { c: exact, s: 50 }], { products: ['A3'], chips: [], subs: ['花屏乱码'], domain: 'display' });
  assert.equal(best.id, 'exact');
});
