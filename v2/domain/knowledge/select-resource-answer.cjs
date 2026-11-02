'use strict';
const { normalize, resourceTermMatches } = require('./resource-query.cjs');
const termMatches = (plan, term, text) =>
  resourceTermMatches(term, text) ||
  (plan.operation &&
    (plan.operationTermAliases || []).some(
      (group) =>
        group.some((alias) => normalize(alias) === normalize(term)) &&
        group.some((alias) => resourceTermMatches(alias, text)),
    ));
// Equivalent written numerals are comparison forms only. Never rewrite the
// quoted source, calculate a new capability or alter a product identifier.
const fold = (s) =>
  normalize(s).replace(
    /[一二两三四五六七八九双]/g,
    (c) =>
      ({ 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 双: '2' })[
        c
      ],
  );
const heading = (s) =>
  new RegExp(
    [
      '^第[一二三四五六七八九十0-9]+章[^。；;：:]{0,24}$|^[一二三四五六七八九十]+、[^。；;：:]{1',
      ',20}$|^\\d+(?:\\.\\d+)*[.、]\\s*[^。；;：:]{1,16}$|^图\\s*\\d+(?:[-.]\\d',
      '+)*\\s*[^。；;：:]{0,30}$|^[^。；;]{1,60}示意图[:：]?$',
    ].join(''),
    '',
  ).test(s);
// A chapter boundary is stronger than a paragraph boundary. PDF chunks often
// contain the end of one operation and the beginning of the next. Preserve
// the original section label rather than joining those operations together.
const sectionHeading = (s) =>
  /^第[一二三四五六七八九十0-9]+章[^。；;：:]{1,30}$|^[一二三四五六七八九十]+、[^。；;：:]{1,24}$|^\d{1,2}(?:\.\d+)*[.、．）)]\s*[^。；;：:，,]{2,32}$/.test(
    s,
  ) && !/(?:点击|单击|双击|右键|勾选|输入|依次|长按|等待|然后|即可)/.test(s);
const instruction = (s) =>
  /点击|单击|双击|右键|选中|勾选|依次|打开|进入|选择|按下|长按|输入|安装|运行|执行|解压|复制|保存|导出|导入|切换|重启|搜索/.test(
    s,
  );
function split(text) {
  const pieces = String(text || '')
      .split(/\n|(?<=[。；;])/)
      .map((s) => s.trim())
      .filter(Boolean),
    units = [];
  let current = '';
  const flush = () => {
    if (current) units.push(current);
    current = '';
  };
  for (const piece of pieces) {
    const boundary =
      heading(piece) ||
      /^(?:\d+[.)、．）]|\d{1,2}\s+\S|[（(]\d+[)）]|步骤\s*\d+|[①②③④⑤⑥⑦⑧⑨]|[•●])/.test(piece);
    if (boundary) flush();
    current = current ? current + '\n' + piece : piece;
    if (heading(piece) || /[。；;！？!?]$/.test(piece)) flush();
  }
  flush();
  return units;
}
function sectionExcerpt(row, text, plan) {
  const lines = text.split('\n');
  let end = lines.length,
    hasContent = false,
    title = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (sectionHeading(line)) {
      if (hasContent) {
        end = i;
        break;
      }
      title = line;
    } else if (!heading(line) && (plan.terms || []).some((t) => termMatches(plan, t, line)))
      hasContent = true;
  }
  const excerpt = lines.slice(0, end).join('\n').trim();
  // A window may begin inside a section; recover only a preceding title from
  // this same original chunk, never a heading from another document or page.
  if (!title) {
    const source = String(row.text || ''),
      at = normalize(source).indexOf(normalize(text));
    if (at >= 0) {
      let offset = 0;
      for (const line of source.split('\n')) {
        if (offset > at) break;
        if (sectionHeading(line.trim())) title = line.trim();
        offset += normalize(line).length;
      }
    }
  }
  return { text: excerpt, sectionTitle: title };
}
function requestedFactIsPresent(text, plan) {
  if (plan.answerNeed !== 'fact' || !plan.topics?.includes('password')) return true;
  // A password value question is not answered by password length requirements,
  // a change-password menu, or a reminder to keep it safe.
  const literal =
    /(?:密码|口令|password)\s*(?:[:：]|为|是|is)\s*["“'‘]?(?:[a-z0-9]{3,}|[一二三四五六七八九十\d]+\s*个\s*[“"']?\s*[零一二三四五六七八九\d])/i;
  const initial =
    /(?:密码|口令|password)[^。；;\n]{0,24}(?:默认|初始|default)\s*[:：为是]*\s*[“"']?(?:[a-z0-9]{3,}|[一二三四五六七八九十\d]+\s*个\s*[“"']?\s*[零一二三四五六七八九\d])/i;
  const initialPrefix = new RegExp(
    [
      '(?:默认|初始|出厂|default)\\s*(?:的)?\\s*(?:(?:wi[\\s-]*fi|无线|热点|连接)\\s',
      '*)?(?:密码|口令|password)\\s*(?:[:：]|为|是|is)\\s*["“\'‘]?(?:[a-z0-9]',
      '{3,}|[一二三四五六七八九十\\d]+\\s*个\\s*[“"\']?\\s*[零一二三四五六七八九\\d])',
    ].join(''),
    'i',
  );
  if (!literal.test(text) && !initial.test(text)) return false;
  if (plan.initialValue && !initial.test(text) && !initialPrefix.test(text)) return false;
  if (plan.topics.includes('wifi') && !/wi[\s-]*fi|无线|热点|ssid/i.test(text)) return false;
  return true;
}
function answerWindows(rows, plan) {
  const windows = [];
  for (const row of rows) {
    if (row.resourceOnly) continue;
    const lines = split(row.text);
    for (let i = 0; i < lines.length; i++) {
      const anchor = lines[i];
      if (
        anchor.length < 4 ||
        /^(?:https?:|版权所有|视界不只|深圳市)/.test(anchor) ||
        /\.{3,}|…{2,}/.test(anchor)
      )
        continue;
      // Windows stay inside an original RAGFlow chunk; this is an answer excerpt,
      // not a new document index or an invented heading/paragraph.
      for (let count = 1; count <= 4 && i + count <= lines.length; count++) {
        const text = lines.slice(i, i + count).join('\n');
        if (text.length < 8 || text.length > 2500) continue;
        const body = fold(
          lines
            .slice(i, i + count)
            .filter((s) => !heading(s))
            .join('\n'),
        );
        if (!body) continue;
        windows.push({ row, text, body, start: i, end: i + count });
      }
    }
  }
  const terms = [
    ...new Set([
      ...(plan.nameLanguage ? plan.nameAliases || [] : plan.terms || []),
      ...(plan.overview ? plan.original.match(/功能|特点|概述|介绍/g) || [] : []),
    ]),
  ]
    .map(fold)
    .filter(Boolean);
  const weights = new Map(
    terms.map((term) => {
      const df = windows.filter((w) => termMatches(plan, term, w.body)).length;
      return [term, Math.log(1 + (windows.length - df + 0.5) / (df + 0.5))];
    }),
  );
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const focus = fold(plan.overview || plan.initialValue ? terms.join(' ') : plan.focus),
    pairs = [
      ...new Set(
        (focus.match(/[\u3400-\u9fff]+/g) || []).flatMap((t) =>
          Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)),
        ),
      ),
    ];
  const requiredModifiers = (plan.terms || []).filter((t) => /^(?:单|双|多|少|长|宽|高)$/.test(t)).map(fold);
  for (const window of windows) {
    const matched = terms.filter((t) => termMatches(plan, t, window.body)),
      coverage = matched.reduce((s, t) => s + weights.get(t), 0) / total;
    const actionCoverage = (plan.actions || []).length
      ? (plan.actions || []).filter((t) => window.body.includes(normalize(t))).length / plan.actions.length
      : 0;
    const phraseCoverage = pairs.length
      ? pairs.filter((t) => window.body.includes(t)).length / pairs.length
      : 0;
    const listedDetails = plan.overview
      ? Math.min(3, (window.text.match(/[、，,]/g) || []).length / 2) +
        (/支持|包括|包含/.test(window.text) ? 1 : 0)
      : 0;
    window.matched = matched;
    window.coverage = coverage;
    window.score =
      coverage +
      phraseCoverage * 0.3 +
      actionCoverage * 0.3 +
      listedDetails * 0.15 +
      Math.max(0, Number(window.row.vectorScore) || 0) * 0.2 -
      Math.min(0.08, window.text.length / 8000);
    if (!matched.length || (terms.length > 1 && coverage < 0.5) || !requestedFactIsPresent(window.text, plan))
      window.score = 0;
    if (requiredModifiers.some((term) => !window.body.includes(term))) window.score = 0;
    if (plan.capabilityQuestion && (plan.quantities || []).some((q) => !window.body.includes(fold(q.text))))
      window.score = 0;
    // A how/where question constrained to a manual needs an instruction, not
    // just a feature heading or an applicability sentence sharing the nouns.
    if (plan.documentContent && plan.operation && !instruction(window.body)) window.score = 0;
    if (
      plan.nameLanguage &&
      /\b(?:Lite|Pro|Plus|Mini)\b/i.test(window.text) &&
      !/\b(?:Lite|Pro|Plus|Mini)\b/i.test(plan.original)
    )
      window.score = 0;
    // A device reset request cannot silently become an account/password reset.
    if (
      plan.models?.length &&
      plan.termAlternatives?.length &&
      !plan.topics?.includes('password') &&
      /密码|口令|password/i.test(window.text)
    )
      window.score = 0;
  }
  return windows
    .filter((w) => w.score > 0)
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length);
}
function selectResourceAnswers(rows, plan, { limit = 2 } = {}) {
  const ranked = answerWindows(rows, plan),
    out = [],
    sources = new Set(),
    texts = new Set(),
    coveredTerms = new Set();
  for (const w of ranked) {
    const excerpt = sectionExcerpt(w.row, w.text, plan);
    // Cropping cannot retain a score earned only by the unrelated next section.
    if (w.matched.some((term) => !termMatches(plan, term, fold(excerpt.text)))) continue;
    if (!requestedFactIsPresent(excerpt.text, plan)) continue;
    if (
      plan.capabilityQuestion &&
      (plan.quantities || []).some((q) => !fold(excerpt.text).includes(fold(q.text)))
    )
      continue;
    if (plan.documentContent && plan.operation && !instruction(excerpt.text)) continue;
    const identity = w.row.pdfSha256 || w.row.sha256 || w.row.name,
      key = normalize(excerpt.text);
    if (
      sources.has(identity) ||
      texts.has(key) ||
      [...texts].some((text) => key.includes(text) || text.includes(key))
    )
      continue;
    // Another source is useful only when it covers an as-yet unanswered part of
    // this request. Do not append a weaker paragraph merely to fill two slots.
    if (out.length && !w.matched.some((term) => !coveredTerms.has(term))) continue;
    for (const term of w.matched) coveredTerms.add(term);
    sources.add(identity);
    texts.add(key);
    out.push({
      ...w.row,
      text: excerpt.text,
      answerSelection: {
        algorithm: 'idf-coverage-and-vector',
        score: w.score,
        coverage: w.coverage,
        matchedTerms: w.matched,
        chunkUnits: [w.start, w.end],
        sectionTitle: excerpt.sectionTitle,
        sectionBounded: excerpt.text !== w.text,
        unitKind: 'wrapped-source-paragraphs',
      },
    });
    if (out.length === limit) break;
  }
  return out;
}
module.exports = { selectResourceAnswers, answerWindows, requestedFactIsPresent };
