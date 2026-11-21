'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ai = require('../src/core/ai');

const REMOTE = {
  apiKey: 'remote-key',
  baseUrl: 'https://proxy.example.com/v1',
  model: 'remote-model'
};

function reset() {
  ai.resetBuiltinCache();
}

test('填写自定义 Key 时直接使用，不去拉公共 Key', async () => {
  reset();
  let called = 0;
  const cfg = await ai.resolveConfig({
    apiKey: '  sk-test  ',
    baseUrl: 'https://api.deepseek.com/',
    model: 'deepseek-chat',
    fetchImpl: async () => { called++; throw new Error('不应该请求网络'); }
  });
  assert.strictEqual(called, 0);
  assert.strictEqual(cfg.builtin, false);
  assert.strictEqual(cfg.apiKey, 'sk-test');
  assert.strictEqual(cfg.baseUrl, 'https://api.deepseek.com');
  assert.strictEqual(cfg.model, 'deepseek-chat');
});

test('没有自定义 Key 时从网站拉取，并按返回的接口与模型调用', async () => {
  reset();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(String(url));
    if (String(url).includes('ai-key.json')) {
      return { ok: true, status: 200, json: async () => REMOTE };
    }
    const body = JSON.parse(init.body);
    assert.strictEqual(init.headers.Authorization, 'Bearer remote-key');
    assert.strictEqual(body.model, 'remote-model');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: 'remote-model',
        choices: [{ message: { content: ' 先检查 Java ' } }]
      })
    };
  };
  const res = await ai.chat({ messages: [{ role: 'user', content: '崩了' }], fetchImpl });
  assert.strictEqual(res.reply, '先检查 Java');
  assert.strictEqual(res.builtin, true);
  assert.strictEqual(res.model, 'remote-model');
  assert.ok(seen[0].includes('ai-key.json'));
});

test('公共 Key 在 10 分钟内只拉一次', async () => {
  reset();
  let pulls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('ai-key.json')) {
      pulls++;
      return { ok: true, status: 200, json: async () => REMOTE };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
  };
  await ai.chat({ messages: [{ role: 'user', content: 'a' }], fetchImpl });
  await ai.chat({ messages: [{ role: 'user', content: 'b' }], fetchImpl });
  assert.strictEqual(pulls, 1);
});

test('拉取公共 Key 失败时给出可操作提示', async () => {
  reset();
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await assert.rejects(
    ai.resolveConfig({ fetchImpl }),
    /拉取公共 AI Key 失败.*填写自己的 Key/
  );
});

test('公共 Key 失效时提示填写自己的 Key', async () => {
  reset();
  const fetchImpl = async (url) => {
    if (String(url).includes('ai-key.json')) {
      return { ok: true, status: 200, json: async () => REMOTE };
    }
    return { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'bad key' } }) };
  };
  await assert.rejects(
    ai.chat({ messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
    /公共 Key 已失效/
  );
});

test('回答被截断时给出明确提示', async () => {
  reset();
  const fetchImpl = async (url) => {
    if (String(url).includes('ai-key.json')) {
      return { ok: true, status: 200, json: async () => REMOTE };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '...' } }]
      })
    };
  };
  await assert.rejects(
    ai.chat({ messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
    /回答被截断/
  );
});
