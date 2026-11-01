'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ms = require('../src/core/microsoft');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function router(routes) {
  return async (url, init) => {
    const body = init && init.body ? String(init.body) : '';
    for (const [key, handler] of Object.entries(routes)) {
      if (String(url).includes(key)) {
        return handler(body, init);
      }
    }
    throw new Error('unexpected url: ' + url);
  };
}

test('requestDeviceCode 解析设备代码与轮询间隔', async () => {
  const fetchImpl = router({
    '/devicecode': () => jsonResponse({
      device_code: 'DEV',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://microsoft.com/devicelogin',
      expires_in: 900,
      interval: 5
    })
  });
  const device = await ms.requestDeviceCode({ fetchImpl, clientId: 'test-client' });
  assert.strictEqual(device.userCode, 'ABCD-EFGH');
  assert.strictEqual(device.deviceCode, 'DEV');
  assert.strictEqual(device.interval, 5);
  assert.strictEqual(device.clientId, 'test-client');
});

test('pollDeviceCode 正确处理 authorization_pending / slow_down / expired_token', async () => {
  let n = 0;
  const fetchImpl = router({
    '/token': () => {
      n += 1;
      if (n === 1) return jsonResponse({ error: 'authorization_pending' }, 400);
      if (n === 2) return jsonResponse({ error: 'slow_down' }, 400);
      if (n === 3) return jsonResponse({ error: 'expired_token' }, 400);
      return jsonResponse({ access_token: 'MS', refresh_token: 'RT', expires_in: 3600 });
    }
  });
  const device = { clientId: 'test-client', deviceCode: 'DEV', interval: 5 };
  const first = await ms.pollDeviceCode(device, { fetchImpl });
  assert.strictEqual(first.pending, true);
  const second = await ms.pollDeviceCode(device, { fetchImpl });
  assert.strictEqual(second.pending, true);
  assert.strictEqual(second.slowDown, true);
  await assert.rejects(() => ms.pollDeviceCode(device, { fetchImpl }), /过期/);
  const done = await ms.pollDeviceCode(device, { fetchImpl });
  assert.strictEqual(done.pending, false);
  assert.strictEqual(done.accessToken, 'MS');
  assert.strictEqual(done.refreshToken, 'RT');
});

test('completeLogin 依次走 XboxLive → XSTS → Minecraft → 档案', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url.includes('user.auth.xboxlive.com')) {
      return jsonResponse({ Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UH1' }] } });
    }
    if (url.includes('xsts.auth.xboxlive.com')) {
      return jsonResponse({ Token: 'XSTS', DisplayClaims: { xui: [{ uhs: 'UH2' }] } });
    }
    if (url.includes('login_with_xbox')) {
      const body = JSON.parse(init.body);
      assert.ok(body.identityToken.startsWith('XBL3.0 x=UH2;'));
      return jsonResponse({ access_token: 'MC', token_type: 'Bearer', expires_in: 86400, username: 'Steve' });
    }
    if (url.includes('entitlements')) {
      return jsonResponse({ items: [{ name: 'product_minecraft' }, { name: 'game_minecraft' }] });
    }
    if (url.includes('minecraft/profile')) {
      return jsonResponse({ id: 'uuid-1', name: 'Steve', skins: [], capes: [] });
    }
    throw new Error('unexpected: ' + url);
  };
  const result = await ms.completeLogin({ accessToken: 'MS', refreshToken: 'RT' }, { fetchImpl });
  assert.strictEqual(result.type, 'microsoft');
  assert.strictEqual(result.name, 'Steve');
  assert.strictEqual(result.uuid, 'uuid-1');
  assert.strictEqual(result.accessToken, 'MC');
  assert.strictEqual(result.refreshToken, 'RT');
  assert.ok(result.expiresAt);
  assert.strictEqual(calls.length, 5);
});

test('没有购买 Minecraft 时 completeLogin 抛错', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('user.auth')) return jsonResponse({ Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'U' }] } });
    if (url.includes('xsts.auth')) return jsonResponse({ Token: 'XSTS', DisplayClaims: { xui: [{ uhs: 'U' }] } });
    if (url.includes('login_with_xbox')) return jsonResponse({ access_token: 'MC' });
    if (url.includes('entitlements')) return jsonResponse({ items: [] });
    throw new Error('unexpected: ' + url);
  };
  await assert.rejects(() => ms.completeLogin({ accessToken: 'MS' }, { fetchImpl }), /没有购买/);
});

test('XSTS 常见错误码会翻译成中文提示', async () => {
  const fetchImpl = async () => jsonResponse({ XErr: 2148916233 }, 401);
  await assert.rejects(() => ms.authorizeXsts('XBL', { fetchImpl }), /Xbox 账号/);
});

test('refreshAccount 用 refresh token 换新令牌并保留 id/createdAt', async () => {
  const fetchImpl = async (url, init) => {
    const body = init && init.body ? String(init.body) : '';
    if (url.includes('/token')) {
      assert.ok(body.includes('refresh_token'));
      return jsonResponse({ access_token: 'MS2', refresh_token: 'RT2', expires_in: 3600 });
    }
    if (url.includes('user.auth')) return jsonResponse({ Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'U' }] } });
    if (url.includes('xsts.auth')) return jsonResponse({ Token: 'XSTS', DisplayClaims: { xui: [{ uhs: 'U' }] } });
    if (url.includes('login_with_xbox')) return jsonResponse({ access_token: 'MC2', expires_in: 86400 });
    if (url.includes('entitlements')) return jsonResponse({ items: [{ name: 'game_minecraft' }] });
    if (url.includes('minecraft/profile')) return jsonResponse({ id: 'uuid-2', name: 'Alex' });
    throw new Error('unexpected: ' + url);
  };
  const account = { id: 'ms-uuid-2', type: 'microsoft', name: 'Alex', uuid: 'uuid-2', refreshToken: 'RT1', createdAt: '2024-01-01' };
  const fresh = await ms.refreshAccount(account, { fetchImpl });
  assert.strictEqual(fresh.id, 'ms-uuid-2');
  assert.strictEqual(fresh.createdAt, '2024-01-01');
  assert.strictEqual(fresh.accessToken, 'MC2');
  assert.strictEqual(fresh.refreshToken, 'RT2');
});

test('refreshOAuth 失败时抛出微软返回的错误描述', async () => {
  const fetchImpl = async () => jsonResponse({ error: 'invalid_grant', error_description: 'token revoked' }, 400);
  await assert.rejects(() => ms.refreshOAuth('RT', { fetchImpl }), /token revoked/);
});
