'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sqlAnswer, literal } = require('../domain/knowledge/quick-answer-format.cjs');
const { projectQuickRequest } = require('../domain/knowledge/quick-request.cjs');
const { faqEligible, faqEligibility } = require('../domain/knowledge/quick-faq-policy.cjs');
const { createSectionAnswers } = require('../adapters/http/section-answers.cjs');

test('SQL and comparison values give unlabelled symbols the same meaning', () => {
  for (const value of ['×', 'X', '√', '✓', '○']) {
    const result = sqlAnswer({
      kind: 'parameter',
      results: [{ parameter: '功能', value, name: '合成表', models: ['SYN100'], locator: { cell: 'B2' } }],
    });
    assert(result.reply.includes(literal({ value })));
    assert.match(result.reply, /含义待核对/);
    assert.equal(result.status, 'partial');
    assert.equal(result.results[0].value, value);
  }
  for (const value of ['支持', '不支持', 'DC 5V']) {
    const result = sqlAnswer({ kind: 'parameter', results: [{ parameter: '功能', value, name: '合成表' }] });
    assert.equal(result.status, 'answer');
    assert(result.reply.includes(value));
  }
});

test('explicit action corrections keep the subject and remove the denied action', () => {
  for (const query of [
    'A3L的WiFi密码不是找回，是修改',
    'A3L的WiFi密码不是找回，而是修改',
    'A3L不是找回WiFi密码，是修改WiFi密码',
  ]) {
    const result = projectQuickRequest(query);
    assert.match(result.query, /A3L/);
    assert.match(result.query, /修改/);
    assert.match(result.query, /WiFi密码/);
    assert.doesNotMatch(result.query, /找回/);
  }
  assert(projectQuickRequest('不是找回，是修改').missingObject);
  for (const query of ['R712升级后花屏', '不是黑屏，是花屏', '给我不是找回，是修改.pdf']) {
    assert.equal(projectQuickRequest(query).query, query);
  }
});

test('FAQ applicability includes identities and software scope written inside the answer', () => {
  const context = { plan: { models: ['HD-A3L'] }, how: true, software: ['HDPlayer'] };
  const row = {
    parameter: '修改密码会卡在当前界面',
    value: '屏掌控单色版本 w63，V6硬件，请换V7。',
    models: [],
    name: '合成APP问答.csv',
  };
  assert.equal(faqEligible(row, context), false);
  assert.equal(faqEligible({ ...row, parameter: '如何修改密码', value: 'W63：进入设置。' }, context), false);
  assert.equal(
    faqEligible({ ...row, parameter: '如何修改密码', value: '屏掌控单色版进入设置。' }, context),
    false,
  );
  assert(
    faqEligible({ ...row, parameter: '如何修改密码', value: 'A3L打开HDPlayer，进入设备信息。' }, context),
  );
});

test('a corrected operation cannot be answered by a superficially matching fault FAQ', async () => {
  const manual = {
    kind: 'manual',
    name: 'A3L手册.pdf',
    models: ['HD-A3L'],
    evidenceId: 'manual-wifi',
    download: '/synthetic/manual',
    text: '步骤1：打开HDPlayer，进入设备信息。\n步骤2：设置WiFi密码，点击确定。',
  };
  const app = createSectionAnswers({
    async knowledge(q, { kind }) {
      return {
        kind,
        results:
          kind === 'faq'
            ? [
                {
                  parameter: '修改密码会卡在当前界面',
                  value: 'W63单色硬件V6换V7后升级固件。',
                  name: '合成APP问答.csv',
                  models: [],
                },
              ]
            : [],
      };
    },
    async search() {
      return { results: [manual] };
    },
    async registry() {
      return { results: [] };
    },
  });
  const result = await app.answer('A3L的WiFi密码不是找回，是修改');
  assert.match(result.reply, /设备信息/);
  assert.doesNotMatch(result.reply, /W63|V6|V7|升级固件/);
  assert.equal(result.queryPlan.original, 'A3L的WiFi密码不是找回，是修改');
});

test('FAQ version prerequisites are checked independently of firmware mentioned in a remedy', () => {
  const row = {
    parameter: '设备花屏如何处理',
    value: '处理前请备份；升级目标固件V7.1。',
    conditions: '仅适用硬件版本V6、软件版本V2.1',
    models: ['HD-R712'],
  };
  const context = { plan: { models: ['HD-R712'], original: 'R712花屏' }, how: false, software: ['HDSet'] };
  assert.deepEqual(faqEligibility(row, context).missing, ['硬件版本', '软件版本']);
  assert(
    !faqEligible(row, {
      ...context,
      plan: { ...context.plan, original: 'R712硬件版本V5，软件版本V2.1花屏' },
    }),
  );
  assert(
    faqEligible(row, { ...context, plan: { ...context.plan, original: 'R712硬件版本V6，软件版本V2.1花屏' } }),
  );
});

test('conditional prerequisites inside the answer require the actual chip and scan, not just a matching model', () => {
  const row = {
    parameter: 'R712花屏怎么处理',
    value: '如果使用ICN2038S芯片，32扫，硬件版本V6，需按对应参数核对。',
    models: ['HD-R712'],
  };
  const context = { plan: { models: ['HD-R712'], original: 'R712花屏' }, how: false, software: ['HDSet'] };
  assert.deepEqual(faqEligibility(row, context).missing, ['硬件版本', '芯片型号', '扫描方式']);
  const matched = { ...context, plan: { ...context.plan, original: 'R712 ICN2038S 32扫 硬件版本V6花屏' } };
  assert(faqEligible(row, matched));
  const mismatch = { ...context, plan: { ...context.plan, original: 'R712 ICN2038S 16扫 硬件版本V6花屏' } };
  assert(!faqEligible(row, mismatch));
});
