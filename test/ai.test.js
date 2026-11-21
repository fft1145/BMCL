'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ai = require('../src/core/ai');

test('没有自定义 Key 时使用内置 Key 与配套接口', () => {
  const cfg = ai.resolveConfig({ apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' });
  assert.strictEqual(cfg.builtin, true);
  assert.strictEqual(cfg.apiKey, ai.BUILTIN.apiKey);
  assert.strictEqual(cfg.baseUrl, ai.BUILTIN.baseUrl);
  assert.strictEqual(cfg.model, ai.BUILTIN.model);
});

test('填写自定义 Key 时优先使用自定义 Key', () => {
  const cfg = ai.resolveConfig({
    apiKey: '  sk-test  ',
    baseUrl: 'https://api.deepseek.com/',
    model: 'deepseek-chat'
  });
  assert.strictEqual(cfg.builtin, false);
  assert.strictEqual(cfg.apiKey, 'sk-test');
  assert.strictEqual(cfg.baseUrl, 'https://api.deepseek.com');
  assert.strictEqual(cfg.model, 'deepseek-chat');
});

test('内置 Key 失效时提示填写自己的 Key', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: 'Authentication Fails' } })
  });
  try {
    await assert.rejects(
      ai.chat({ messages: [{ role: 'user', content: 'hi' }] }),
      /内置 Key 已失效/
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('正常返回回复与使用的模型', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      model: 'deepseek-v4.1-flash',
      choices: [{ message: { content: ' 先检查 Java 版本 ' } }]
    })
  });
  try {
    const res = await ai.chat({ messages: [{ role: 'user', content: '崩了' }] });
    assert.strictEqual(res.reply, '先检查 Java 版本');
    assert.strictEqual(res.builtin, true);
    assert.strictEqual(res.model, 'deepseek-v4.1-flash');
  } finally {
    globalThis.fetch = original;
  }
});
