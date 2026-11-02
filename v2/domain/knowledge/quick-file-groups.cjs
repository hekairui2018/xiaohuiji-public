'use strict';

const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
const versionOf = (row) =>
  normalize(row.attributes?.version || /\bV\d+(?:\.\d+)*/i.exec(row.name || '')?.[0]);

// Group presentation only. Different contents retain their individual approved
// identities and URLs; a filename is never used to select an authoritative file.
function groupQuickFiles(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([normalize(row.name), row.kind, versionOf(row)]);
    if (!groups.has(key)) groups.set(key, []);
    const members = groups.get(key);
    const identity = row.sha256 || row.fileId || row.download;
    if (
      !identity ||
      !members.some((member) => (member.sha256 || member.fileId || member.download) === identity)
    )
      members.push(row);
  }
  return [...groups.values()].map((members) => {
    if (members.length === 1) return members[0];
    const first = members[0];
    return {
      name: first.name,
      kind: first.kind,
      models: [...new Set(members.flatMap((row) => row.models || []))],
      resourceOnly: true,
      locator: { section: '文件登记信息' },
      groupNotice: '同名文件有' + members.length + '份不同内容，请预览核对；未自动选定其中一份。',
      variants: members,
    };
  });
}

module.exports = { groupQuickFiles };
