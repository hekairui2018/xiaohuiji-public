'use strict';
// Explicit user-confirmed software relationships; never a firmware compatibility map.
const official = require('../../data/official-models-20261027.json').rows;
const { excludesSoftwareScope } = require('./quick-source-policy.cjs');
const { matchesConcept, concepts } = require('./quick-query.cjs');
const { resourceTermMatches } = require('./resource-query.cjs');
const { operationTarget, actionGroups } = require('./operation-target.cjs');
const { commandSupports } = require('./operation-instruction.cjs');
const key = (s) =>
  String(s || '')
    .toUpperCase()
    .replace(/^HD[-_ ]?/, '');
function operationContext(query, plan) {
  const focus = (plan.focus || plan.terms.join(' '))
    .replace(/播放盒|接收卡|发送卡|视频处理器|异步控制卡|手机|电脑|\bAPP\b/gi, ' ')
    .trim();
  if (plan.software.length) {
    const example = !plan.models.length && plan.software.includes('HDPlayer') && !/LCD/i.test(query);
    return {
      queries: [query, ...(example ? ['A3L ' + focus] : [])],
      software: plan.software,
      example,
      focus,
    };
  }
  const categories = plan.models.map((m) => official.find((r) => key(r.model) === key(m))?.category || '');
  const receiver =
    categories.some((c) => /接收卡|发送卡|视频处理|同步/.test(c)) ||
    plan.models.some((m) => /^R\d|^K\d|^VP\d|^KV\d|^T\d/.test(key(m))) ||
    /接收卡|发送卡|视频处理器/.test(query);
  const player =
    categories.some((c) => /异步|播放盒/.test(c)) ||
    plan.models.some((m) => /^[ABCDH]\d/.test(key(m))) ||
    /播放盒|异步/.test(query);
  const processor =
    categories.some((c) => /视频处理/.test(c)) ||
    plan.models.some((m) => /^(?:VP|KV)\d/.test(key(m))) ||
    /视频处理器/.test(query);
  if (/手机|\bAPP\b/i.test(query) && (player || processor))
    return {
      queries: [query, '屏掌控 ' + focus],
      software: ['屏掌控'],
      example: false,
      mobileReference: true,
      fullcolor: true,
      focus,
    };
  const software = receiver ? ['HDSet'] : player ? ['HDPlayer'] : [];
  const example = !plan.models.length && player && !/LCD/i.test(query);
  return {
    queries: [query, ...software.map((s) => s + ' ' + focus), ...(example ? ['A3L ' + focus] : [])],
    software,
    example,
    focus,
  };
}
function operationScope(row, context, plan) {
  if (row.attributes?.subjectType === 'software') {
    const names = (row.attributes.software || []).map((name) => name.toLowerCase().replace(/[\s_-]/g, ''));
    if (!context.software.some((name) => names.includes(name.toLowerCase().replace(/[\s_-]/g, ''))))
      return false;
  }
  if (context.fullcolor && /单色|双色|单双色/.test(row.name)) return false;
  if (
    context.mobileReference &&
    ['spec', 'manual', 'document'].includes(row.kind) &&
    !context.software.some((s) => (row.name + ' ' + row.text).includes(s))
  )
    return false;
  if (['spec', 'manual', 'document'].includes(row.kind)) {
    const owners = (row.models || []).map(key),
      requested = (plan.models || []).map(key);
    if (requested.length && owners.length && !requested.some((m) => owners.includes(m))) return false;
    if (!requested.length && ['HDPlayer', 'HDSet'].some((s) => context.software.includes(s))) {
      const example = context.example && owners.includes('A3L');
      const generic =
        !owners.length && context.software.some((s) => row.name.toLowerCase().includes(s.toLowerCase()));
      if (!example && !generic) return false;
    }
  }
  if (!context.software.includes('HDPlayer')) return true;
  const categories = (row.models || []).map(
    (m) => official.find((r) => key(r.model) === key(m))?.category || '',
  );
  return !excludesSoftwareScope(context.software, categories.join(' '));
}
function videoRelevance(row, plan, context) {
  const topicHits = plan.topics.filter((t) => matchesConcept(t, row.name)).length;
  const termHits = plan.terms.filter((t) => resourceTermMatches(t, row.name)).length;
  const clean = row.name
    .replace(/\.[^.]+$/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();
  const generic = context.software.some((s) =>
    [s + '操作', s + '操作视频'].some((n) => n.toLowerCase() === clean),
  );
  if (plan.topics.length) return topicHits ? topicHits * 10 + termHits : 0;
  return termHits >= 2 ? termHits : generic ? 1 : 0;
}
function procedureTarget(query, plan) {
  const target = operationTarget(plan);
  if (target.steps.length) return target;
  const colloquial = String(query).replace(
    /(?:在哪|哪里|哪儿|怎么|如何)(?:里)?(改|设|调|看)([？?。\s]*)$/g,
    (_, verb, tail) => ({ 改: '修改', 设: '设置', 调: '调整', 看: '查看' })[verb] + tail,
  );
  const group = actionGroups.find((g) => g.slice(1).some((a) => colloquial.includes(a)));
  if (!group) return target;
  for (const id of plan.topics) {
    const concept = concepts.find((c) => c.id === id),
      object = concept?.words.find((w) => String(query).toLowerCase().includes(w.toLowerCase()));
    if (object) return { steps: [{ action: group[0], aliases: group.slice(1), object }] };
  }
  return target;
}
function procedureComplete(text, target) {
  if (!target?.steps.length) return false;
  return target.steps.every((step) => {
    const aliases = [
      ...new Set([
        ...step.aliases,
        ...actionGroups
          .flatMap((g) => g.slice(1))
          .filter((a) => step.aliases.some((v) => resourceTermMatches(v, a))),
      ]),
    ];
    const expanded = { ...step, aliases };
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const actionObject = new RegExp(
      '(?:' + aliases.map(escape).join('|') + ')[^。；;\\n]{0,20}' + escape(step.object),
    );
    return String(text)
      .split(/\n|[。；;]/)
      .some((line) => {
        if (!actionObject.test(line)) return false;
        if (commandSupports(line, expanded, step.object)) return true;
        return /^(?:步骤\s*\d|\d+[、.)])/i.test(line.trim()) && /点击.{0,4}(?:确定|确认|保存)/.test(line);
      });
  });
}
function operationExcerpt(text, plan) {
  if (String(text).length < 1200) return text;
  // Some registered chapters contain several printed subsections. Select a
  // contiguous subsection, preserving its prerequisites and following steps.
  const lines = String(text).split('\n'),
    starts = [];
  for (let i = 0; i < lines.length; i++)
    if (/^(?:第[一二三四五六七八九十\d]+章\s*|\d+[.．]\s*[^\d\s])/.test(lines[i].trim())) starts.push(i);
  const parts = starts
    .map((start, j) => {
      const body = lines.slice(start, starts[j + 1] ?? lines.length).join('\n'),
        heading = lines[start];
      const relevance = plan.terms.reduce(
        (n, t) => n + (resourceTermMatches(t, heading) ? 10 : resourceTermMatches(t, body) ? 1 : 0),
        0,
      );
      return { body, score: relevance + (relevance && /(?:→|->|-->|】\s*[-－])/.test(body) ? 3 : 0) };
    })
    .filter((p) => p.score > 0);
  parts.sort((a, b) => b.score - a.score);
  return parts[0]?.body || text;
}
module.exports = {
  operationContext,
  operationScope,
  videoRelevance,
  procedureTarget,
  procedureComplete,
  operationExcerpt,
  registeredModels: official.map((row) => row.model),
};
