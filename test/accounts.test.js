'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const accounts = require('../src/core/accounts');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bmcl-acc-'));
}

test('离线 UUID 与 Java OfflinePlayer 算法一致且稳定', () => {
  const uuid = accounts.offlineUuid('fft1145');
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.strictEqual(accounts.offlineUuid('fft1145'), uuid);
  assert.strictEqual(accounts.offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
});

test('添加账号会去重并自动设为活跃', () => {
  const dir = tmp();
  const first = accounts.addOfflineAccount(dir, 'Steve');
  assert.strictEqual(first.name, 'Steve');
  assert.strictEqual(first.type, 'offline');

  const again = accounts.addOfflineAccount(dir, 'steve');
  assert.strictEqual(again.name, 'Steve', '大小写不同视为同一账号');
  assert.strictEqual(accounts.listAccounts(dir).accounts.length, 1);

  accounts.addOfflineAccount(dir, 'Alex');
  assert.strictEqual(accounts.getActiveAccount(dir).name, 'Alex');
  assert.strictEqual(accounts.listAccounts(dir).accounts.length, 2);
});

test('玩家名校验：空、过长、非法字符都会被拒绝', () => {
  const dir = tmp();
  assert.throws(() => accounts.addOfflineAccount(dir, ''), /不能为空/);
  assert.throws(() => accounts.addOfflineAccount(dir, 'a'.repeat(17)), /16/);
  assert.throws(() => accounts.addOfflineAccount(dir, 'bad name!'), /只能包含/);
});

test('切换与删除账号会正确回退', () => {
  const dir = tmp();
  const a = accounts.addOfflineAccount(dir, 'A');
  const b = accounts.addOfflineAccount(dir, 'B');
  assert.strictEqual(accounts.setActiveAccount(dir, a.id).name, 'A');
  assert.strictEqual(accounts.getActiveAccount(dir).name, 'A');

  accounts.removeAccount(dir, a.id);
  const active = accounts.getActiveAccount(dir);
  assert.strictEqual(active.name, 'B', '删除当前账号后回退到剩余账号');
  assert.strictEqual(accounts.listAccounts(dir).accounts.length, 1);
});

test('accounts.json 损坏时安全回退为空列表', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'accounts.json'), '{not json', 'utf8');
  const data = accounts.listAccounts(dir);
  assert.deepStrictEqual(data.accounts, []);
  assert.strictEqual(data.active, '');
});
