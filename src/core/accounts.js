'use strict';

/**
 * 账号管理：离线账号与微软正版账号的增删改查、切换。
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

function accountsFile(userDataDir) {
  return path.join(userDataDir, 'accounts.json');
}

/** 生成离线 UUID（等价 Java UUID.nameUUIDFromBytes("OfflinePlayer:<name>")） */
function offlineUuid(name) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function loadAccounts(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(accountsFile(userDataDir), 'utf8'));
    return { active: data.active || '', accounts: Array.isArray(data.accounts) ? data.accounts : [] };
  } catch (e) {
    return { active: '', accounts: [] };
  }
}

function saveAccounts(userDataDir, data) {
  fs.mkdirSync(path.dirname(accountsFile(userDataDir)), { recursive: true });
  fs.writeFileSync(accountsFile(userDataDir), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

/** 添加离线账号 */
function addOfflineAccount(userDataDir, playerName) {
  const name = String(playerName || '').trim();
  if (!name) throw new Error('玩家名不能为空');
  if (name.length > 16) throw new Error('玩家名不能超过 16 个字符');
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('玩家名只能包含字母、数字和下划线');
  const data = loadAccounts(userDataDir);
  const existing = data.accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    data.active = existing.id;
  } else {
    const acc = {
      // 同一毫秒内添加多个账号时也必须唯一
      id: 'offline-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
      type: 'offline',
      name,
      uuid: offlineUuid(name),
      createdAt: new Date().toISOString()
    };
    data.accounts.push(acc);
    data.active = acc.id;
  }
  saveAccounts(userDataDir, data);
  return getActiveAccount(userDataDir);
}

/** 保存/更新微软正版账号（同一 UUID 覆盖），并设为当前 */
function upsertMicrosoftAccount(userDataDir, profile) {
  if (!profile || !profile.uuid || !profile.name) throw new Error('正版账号信息不完整');
  const data = loadAccounts(userDataDir);
  const id = 'ms-' + profile.uuid;
  const index = data.accounts.findIndex((a) => a.id === id || (a.type === 'microsoft' && a.uuid === profile.uuid));
  const account = Object.assign({}, index >= 0 ? data.accounts[index] : {}, profile, {
    id,
    type: 'microsoft',
    createdAt: index >= 0 ? data.accounts[index].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  if (index >= 0) data.accounts[index] = account;
  else data.accounts.push(account);
  data.active = id;
  saveAccounts(userDataDir, data);
  return account;
}

function getAccountById(userDataDir, accountId) {
  return loadAccounts(userDataDir).accounts.find((a) => a.id === accountId) || null;
}

function removeAccount(userDataDir, accountId) {
  const data = loadAccounts(userDataDir);
  data.accounts = data.accounts.filter((a) => a.id !== accountId);
  if (data.active === accountId) {
    data.active = data.accounts[0] ? data.accounts[0].id : '';
  }
  saveAccounts(userDataDir, data);
  return data;
}

function setActiveAccount(userDataDir, accountId) {
  const data = loadAccounts(userDataDir);
  if (data.accounts.some((a) => a.id === accountId)) {
    data.active = accountId;
    saveAccounts(userDataDir, data);
  }
  return getActiveAccount(userDataDir);
}

function getActiveAccount(userDataDir) {
  const data = loadAccounts(userDataDir);
  return data.accounts.find((a) => a.id === data.active) || data.accounts[0] || null;
}

function listAccounts(userDataDir) {
  return loadAccounts(userDataDir);
}

module.exports = {
  accountsFile,
  offlineUuid,
  loadAccounts,
  saveAccounts,
  addOfflineAccount,
  upsertMicrosoftAccount,
  getAccountById,
  removeAccount,
  setActiveAccount,
  getActiveAccount,
  listAccounts
};
