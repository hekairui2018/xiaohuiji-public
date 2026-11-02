'use strict';

function resourceAnswerNeed(plan) {
  if (plan.metadataQuery) return 'resource-candidates';
  if (plan.documentContent) return 'document-content';
  if (plan.categories.length) return 'resource';
  if (plan.overview) return 'overview';
  if (plan.attributes.length || /多少|几个|是什么|叫什么|哪个|哪款|默认|初始|型号/.test(plan.original))
    return 'fact';
  if (plan.operation || plan.termAlternatives.length) return 'procedure';
  if (plan.broad) return 'browse';
  return 'topic';
}

module.exports = { resourceAnswerNeed };
