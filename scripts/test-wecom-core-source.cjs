'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('WeCom config contract preserves channel and request context', async () => {
  const { askCore } = await import('../wecom-bridge/src/core.mjs');
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), signal: init.signal });
    return { ok: true, json: async () => ({ reply: 'ok' }) };
  };
  try {
    const history = [{ role: 'user', content: 'P3' }];
    const images = ['qa-image-id'];
    const response = await askCore({ coreUrl: 'http://example.invalid/api/ai/chat', coreSource: 'wecom', coreTimeoutMs: 1000 }, '1920x1080怎么配', history, 'test-session', images);
    assert.equal(response.reply, 'ok');
    assert.deepEqual(requests[0].body, { message: '1920x1080怎么配', history, source: 'wecom', sessionId: 'test-session', images });
    assert.equal(requests[0].url, 'http://example.invalid/api/ai/chat');
    assert.ok(requests[0].signal instanceof AbortSignal);
    await askCore({ coreUrl: 'http://example.invalid', coreSource: 'configured-channel', source: 'legacy-channel' }, 'hello', []);
    assert.equal(requests[1].body.source, 'configured-channel');
    await askCore({ coreUrl: 'http://example.invalid', source: 'legacy-channel' }, 'hello', []);
    assert.equal(requests[2].body.source, 'legacy-channel');
    await askCore({ coreUrl: 'http://example.invalid' }, 'hello', []);
    assert.equal(requests[3].body.source, 'wecom');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
