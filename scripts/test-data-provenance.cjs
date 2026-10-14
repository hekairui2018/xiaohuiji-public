'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceIdentity, buildIndex, normalizeModel } = require('../backend/data-provenance.cjs');
const record = { id: 'AS-0001', originalId: 'source-7', sourceFile: 'source.json', source: { locator: 'row 7' }, products: ['HD-A3'] };
test('Derived source identity survives legacy ID renumbering and content edits', () => {
  assert.equal(sourceIdentity(record), sourceIdentity({ ...record, id: 'AS-0100', title: 'edited', solution: 'edited' }));
});
test('Repeated original ID at different source locators is not merged', () => {
  assert.notEqual(sourceIdentity(record), sourceIdentity({ ...record, source: { locator: 'row 8' } }));
});
test('Missing stable source ID stays unresolved rather than falling back to AS sequence', () => {
  assert.equal(sourceIdentity({ id: 'AS-0001', sourceFile: 'source.json', source: { locator: 'row 1' } }), null);
});
test('Insertion and order changes preserve source identity', () => {
  const before = buildIndex({ cases: [record] });
  const after = buildIndex({ cases: [{ ...record, originalId: 'other', id: 'AS-0000' }, { ...record, id: 'AS-0002' }] });
  const key = sourceIdentity(record);
  assert.equal(before.provenance[key][0].originalId, after.provenance[key][0].originalId);
});
test('Alias ambiguity is explicit; no silent product choice', () => {
  const index = buildIndex({ products: [{ product: 'HD-MS4000PRO', aliases: ['4000pro'] }, { product: 'HD-DCS4000PRO', aliases: ['4000pro'] }] });
  assert.deepEqual(index.aliases['4000PRO'], ['MS4000PRO', 'DCS4000PRO']);
  assert.equal(index.issues.ambiguousAliases.length, 1);
});
test('Duplicate evidence is retained and reported, never discarded', () => {
  const index = buildIndex({ cases: [record, { ...record, id: 'AS-0002' }] });
  assert.equal(index.provenance[sourceIdentity(record)].length, 2);
  assert.equal(index.issues.duplicateSources.length, 1);
});
test('Shared exact model joins product specs firmware and ordering without prefix merge', () => {
  const index = buildIndex({ products: [{ product: 'HD-A3' }, { product: 'HD-A3L' }], specs: [{ product: 'HD-A3' }], cases: [record], firmware: [{ card: 'A3', file: 'a3.bin' }], devices: [{ name: 'HD-A3' }] });
  assert.deepEqual(index.models.A3.caseIds, ['AS-0001']);
  assert.equal(index.models.A3.firmwareFiles.length, 1);
  assert.equal(index.models.A3L.caseIds.length, 0);
  assert.equal(normalizeModel('HD_A3'), 'A3');
});
