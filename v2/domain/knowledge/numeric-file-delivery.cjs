'use strict';
const { groupQuickFiles } = require('./quick-file-groups.cjs');
const modelKey = value => String(value || '').toUpperCase().replace(/^HD[- ]?/, '');

function numericFileDelivery({ candidates, rows, policy = 'show_choices', query, input = '数字简称' }) {
  const available = candidates.filter(model => rows.some(row =>
    (row.models || row.modelIds || []).some(value => modelKey(value) === modelKey(model))));
  if (!available.length) return null;
  const selectedModel = policy === 'labelled_best' ? available[0] : null;
  const selected = selectedModel ? rows.filter(row =>
    (row.models || row.modelIds || []).some(model => modelKey(model) === modelKey(selectedModel))) : rows;
  const fileGroups = groupQuickFiles(selected);
  return {
    status: 'answer', intent: 'resources', answerBasis: 'file-model-candidates',
    query, approximate: true, modelCallCount: 0,
    candidateDelivery: { policy, selectedModel, candidateModels: candidates, identityConfirmed: false },
    modelSuggestion: { input, candidates: candidates.map(modelKey), identityConfirmed: false },
    reply: (selectedModel
      ? '您说的是 ' + modelKey(selectedModel) + ' 吧？如果不对请补充。\n以下仅为这个候选型号的资料：\n'
      : '这个数字简称对应多个登记型号，以下文件保留完整型号，请按设备选择：\n') +
      fileGroups.map(group => group.name + (group.groupNotice ? '\n' + group.groupNotice : '')).join('\n'),
    results: selected, fileGroups,
  };
}

module.exports = { numericFileDelivery };
