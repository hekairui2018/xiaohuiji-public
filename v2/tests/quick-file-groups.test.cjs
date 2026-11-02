'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupQuickFiles } = require('../domain/knowledge/quick-file-groups.cjs');

test('same-name different contents form a choice group and retain every original URL', () => {
  const first = {
    name: 'SYN100规格书 V1.0.pdf',
    kind: 'spec',
    sha256: 'a'.repeat(64),
    download: '/source/a',
  };
  const second = { ...first, sha256: 'b'.repeat(64), download: '/source/b' };
  const groups = groupQuickFiles([first, { ...first }, second]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].variants.map((row) => row.download),
    ['/source/a', '/source/b'],
  );
  assert(!groups[0].download);
  assert.match(groups[0].groupNotice, /未自动选定/);
});

test('different versions and types retain separate groups, and unknown identities are not discarded', () => {
  const groups = groupQuickFiles([
    { name: 'SYN100 V1.0.pdf', kind: 'manual' },
    { name: 'SYN100 V2.0.pdf', kind: 'manual' },
    { name: 'SYN100 V1.0.pdf', kind: 'spec' },
    { name: 'SYN100 V1.0.pdf', kind: 'spec' },
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[2].variants.length, 2);
});
