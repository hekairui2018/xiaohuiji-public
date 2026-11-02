'use strict';

const { actionGroups } = require('./operation-target.cjs');

const actions = [
  ...new Set([...actionGroups.flatMap((group) => group.slice(1)), '找回', '恢复', '重置', '删除']),
];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const actionPattern = actions
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join('|');
const correction = new RegExp(
  '^(.*?)(?:不是|并非|不要|不用)(?:要|想|去)?(' +
    actionPattern +
    ')(.*?)' +
    '(?:[，,；;]\\s*(?:而是|是|要|改为|改成)|而是)\\s*(' +
    actionPattern +
    ')(.*?)[？?。！!]*$',
);

// Bind an explicitly corrected action to its current-input object. This does
// not infer a missing device or borrow an object from conversation history.
function projectQuickRequest(original) {
  if (/https?:\/\/|\.(?:pdf|docx|bin|ssr|ssx|mp4)\b/i.test(original)) return { query: original };
  const match = correction.exec(original.trim());
  if (!match) return { query: original };
  const [, subject, deniedAction, oldObject, action, newObject] = match;
  const object = newObject.trim() || oldObject.trim();
  if (!subject.trim() && !object) return { query: original, missingObject: true };
  return {
    query: subject.trim() + '怎么' + action + object,
    correction: { kind: 'explicit-action-correction', deniedAction, action, object },
  };
}

module.exports = { projectQuickRequest };
