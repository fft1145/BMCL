'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const admin = require('../src/core/admin');

test('admin：未配置 adminApi 时只写本地日志，不发网络请求', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-admin-'));
  let called = false;
  const result = await admin.reportLaunch({
    adminApi: '',
    version: '2.6.7',
    userDataDir: dir,
    fetchImpl: async () => { called = true; throw new Error('不应发请求'); }
  });
  assert.strictEqual(result.enabled, false);
  assert.strictEqual(result.banned, false);
  assert.strictEqual(called, false);
  const rows = admin.readLog(dir);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].version, '2.6.7');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('admin：上报成功时返回 IP 与封禁状态，并写入本地日志', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-admin-'));
  const result = await admin.reportLaunch({
    adminApi: 'https://admin.example.com/',
    version: '2.6.7',
    userDataDir: dir,
    fetchImpl: async (url, init) => {
      assert.strictEqual(url, 'https://admin.example.com/visit');
      const body = JSON.parse(init.body);
      assert.strictEqual(body.version, '2.6.7');
      return { ok: true, json: async () => ({ ip: '1.2.3.4', banned: true, reason: '测试封禁' }) };
    }
  });
  assert.deepStrictEqual(
    { enabled: result.enabled, ip: result.ip, banned: result.banned, reason: result.reason },
    { enabled: true, ip: '1.2.3.4', banned: true, reason: '测试封禁' }
  );
  const rows = admin.readLog(dir);
  assert.strictEqual(rows[rows.length - 1].ip, '1.2.3.4');
  assert.strictEqual(rows[rows.length - 1].banned, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('admin：loadAdminApi 会跳过失效线路并取到 adminApi', async () => {
  let n = 0;
  const api = await admin.loadAdminApi({
    fetchImpl: async () => {
      n += 1;
      if (n === 1) throw new Error('网络错误');
      return { ok: true, json: async () => ({ adminApi: 'https://admin.example.com' }) };
    }
  });
  assert.strictEqual(api, 'https://admin.example.com');
});
