'use strict';

const { extractModelTokens, isTechnicalToken } = require('../identity/extract-models.cjs');
const { decideAction } = require('../parser/chat-intent.cjs');
const { excludesSoftwareScope } = require('./quick-source-policy.cjs');

const modelKey = (value) =>
  String(value)
    .toUpperCase()
    .replace(/^HD[-_ ]?/, '')
    .replace(/[\s_-]/g, '');
const faultLanguage = /卡在|卡住|卡死|闪退|崩溃|报错|失败|异常|不显示|不亮|黑屏|花屏|没反应|无响应|不能|无法/;

function versionQualifiers(text) {
  const result = { hardware: [], firmware: [], software: [] };
  for (const [kind, label] of [
    ['hardware', '硬件(?:版本|版)?|PCB(?:版本|版)?'],
    ['firmware', '固件(?:版本|版)?'],
    ['software', '软件(?:版本|版)?'],
  ]) {
    const patterns = [
      new RegExp('(?:' + label + ')[：:\\s]*(V?\\d+(?:\\.\\d+)*[A-Z]?)', 'gi'),
      new RegExp('(V\\d+(?:\\.\\d+)*[A-Z]?)\\s*(?:' + label + ')', 'gi'),
    ];
    result[kind] = [
      ...new Set(
        patterns.flatMap((pattern) =>
          [...text.matchAll(pattern)].map((match) => match[1].replace(/^V/i, '').toUpperCase()),
        ),
      ),
    ];
  }
  return result;
}

function prerequisites(row) {
  const conditionalClauses = String(row.value || '')
    .split(/[。；;\n]/)
    .filter((clause) => /如果|若|仅适用|适用于|仅限|前提|必须|要求/.test(clause));
  return [row.parameter, row.conditions, ...conditionalClauses].filter(Boolean).join('\n');
}

function technicalQualifiers(text) {
  return {
    chip: [...text.matchAll(/\b(?:ICND?|SM|FM|MBI|LS|DP)\d+[A-Z0-9]*\b/gi)].map((hit) =>
      hit[0].toUpperCase(),
    ),
    scan: [...text.matchAll(/(?<![A-Za-z\d.])(\d+)\s*(?:扫|S\b)/gi)].map((hit) => hit[1]),
  };
}

function faqEligibility(row, { plan, how, software = [] }) {
  const question = String(row.parameter || '');
  const text = [question, row.value, row.text, row.conditions].filter(Boolean).join('\n');
  const identities = new Set((row.models || []).map(modelKey));
  for (const token of extractModelTokens(text, { numericPrefix: false })) {
    if (isTechnicalToken(token, text)) continue;
    if (/^(?:HD[-_ ]?)?(?:[ABCDHRWKSTU]\d|VP\d|KV\d)/i.test(token)) identities.add(modelKey(token));
  }
  const requested = (plan.models || []).map(modelKey);
  if (requested.length && identities.size && !requested.some((model) => identities.has(model)))
    return { eligible: false, reason: 'different-device' };
  if (excludesSoftwareScope(software, row.name + '\n' + text))
    return { eligible: false, reason: 'different-software-scope' };
  if (how && (faultLanguage.test(question) || decideAction(question).intent === 'aftersales'))
    return { eligible: false, reason: 'fault-is-not-procedure' };
  const sourceConditions = prerequisites(row);
  const required = { ...versionQualifiers(sourceConditions), ...technicalQualifiers(sourceConditions) };
  const provided = { ...versionQualifiers(plan.original || ''), ...technicalQualifiers(plan.original || '') };
  const labels = {
    hardware: '硬件版本',
    firmware: '固件版本',
    software: '软件版本',
    chip: '芯片型号',
    scan: '扫描方式',
  };
  const missing = [];
  for (const kind of Object.keys(required)) {
    if (!required[kind].length) continue;
    if (!provided[kind].length) {
      missing.push(labels[kind]);
      continue;
    }
    if (!provided[kind].some((version) => required[kind].includes(version)))
      return { eligible: false, reason: 'different-' + kind + '-version' };
  }
  if (missing.length) return { eligible: false, reason: 'missing-applicability', missing };
  return { eligible: true };
}

const faqEligible = (row, context) => faqEligibility(row, context).eligible;
module.exports = { faqEligible, faqEligibility };
