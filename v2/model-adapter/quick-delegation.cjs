'use strict';

// The model chooses delegation. This validates a completed quick-mode result;
// it does not classify the customer's wording or manufacture an answer.
const completeBases = new Set([
  'deterministic-social', 'file-registry-columns', 'drive-file-metadata',
  'source-cell-values', 'parameter-source-cell', 'sections-sql-bm25-vector',
  'registered-chip-relations', 'file-model-candidates',
]);
const key = value => String(value || '').toUpperCase().replace(/^HD[- ]?/, '');
const downloadable = row => row.resourceOnly === true &&
  typeof (row.download || row.downloadUrl) === 'string' &&
  /^\/(?!\/)/.test(row.download || row.downloadUrl);

function delegatedQuickResult(action, result, { models = [] } = {}) {
  if (!['quick', 'search'].includes(action?.action) || action.delivery !== 'if_complete')
    return { allowed: false, reason: '模型未授权快速模式完成后直接交付' };
  if (result?.status !== 'answer' || typeof result.reply !== 'string' || !result.reply.trim())
    return { allowed: false, reason: '快速模式尚未形成完整回答，继续核对缺口' };
  if (!completeBases.has(result.answerBasis) || result.error || result.conflict || result.complete === false)
    return { allowed: false, reason: '该结果未通过快速模式完整交付约束' };
  const rows = result.results || [];
  if (!rows.length && result.answerBasis !== 'deterministic-social')
    return { allowed: false, reason: '快速模式未返回可交付的来源结果' };
  if (rows.some(row => row.unknown || row.conflict || row.available === false))
    return { allowed: false, reason: '结果仍有未确认、冲突或不可用内容' };
  if (result.answerBasis === 'file-model-candidates') {
    const delivery = result.candidateDelivery;
    if (!delivery || delivery.identityConfirmed !== false ||
        !['labelled_best', 'show_choices'].includes(delivery.policy) ||
        !delivery.candidateModels?.length || !rows.length || !rows.every(downloadable))
      return { allowed: false, reason: '候选文件须保留身份未确认与登记下载依据' };
    const allowed = delivery.policy === 'labelled_best' ? [delivery.selectedModel] : delivery.candidateModels;
    if (rows.some(row => !(row.models || row.modelIds || []).some(model => allowed.map(key).includes(key(model)))))
      return { allowed: false, reason: '候选文件混入其他型号' };
    const explicitModels = models.filter(model => /[A-Z]/.test(key(model)));
    if (explicitModels.length && rows.some(row => !(row.models || row.modelIds || []).some(model =>
      explicitModels.map(key).includes(key(model)))))
      return { allowed: false, reason: '候选与客户已经明确的型号不符' };
    return { allowed: true, reason: '按模型选择交付明确标注的型号候选文件' };
  }
  if (result.approximate || result.queryPlan?.unknownModels?.length)
    return { allowed: false, reason: '近似身份或未知型号仍需模型核对' };
  const requested = [...new Set([...(result.queryPlan?.models || []), ...models].map(key))];
  if (rows.some(row => row.queryMatch?.exact === false) || requested.some(model =>
    !rows.some(row => (row.models || row.modelIds || []).some(value => key(value) === model))))
    return { allowed: false, reason: '快速结果未对应本次明确型号，须继续核对' };
  if (['file-registry-columns', 'drive-file-metadata'].includes(result.answerBasis) &&
      (!rows.length || !rows.every(downloadable)))
    return { allowed: false, reason: '文件尚无完整登记下载入口' };
  return { allowed: true, reason: '模型已委托快速模式且快速模式返回完整回答' };
}

module.exports = { delegatedQuickResult };
