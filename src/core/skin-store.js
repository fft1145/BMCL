'use strict';

/**
 * 皮肤 / 披风历史记录。
 * 每次上传的皮肤都会留一份副本 + 元数据，玩家可以随时切回旧皮肤。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function storeDir(userDataDir) {
  return path.join(userDataDir, 'skins');
}

function indexFile(userDataDir) {
  return path.join(storeDir(userDataDir), 'history.json');
}

function loadIndex(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(indexFile(userDataDir), 'utf8'));
    return Array.isArray(data.items) ? data : { items: [] };
  } catch (e) {
    return { items: [] };
  }
}

function saveIndex(userDataDir, data) {
  fs.mkdirSync(storeDir(userDataDir), { recursive: true });
  fs.writeFileSync(indexFile(userDataDir), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function list(userDataDir) {
  return loadIndex(userDataDir).items
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** 把一个皮肤 PNG 复制进历史库 */
function add(userDataDir, sourceFile, meta = {}) {
  if (!sourceFile || !fs.existsSync(sourceFile)) throw new Error('皮肤文件不存在');
  const stat = fs.statSync(sourceFile);
  if (stat.size > 5 * 1024 * 1024) throw new Error('皮肤文件不能超过 5 MB');
  const dir = storeDir(userDataDir);
  fs.mkdirSync(dir, { recursive: true });
  const id = 'skin-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  const ext = path.extname(sourceFile).toLowerCase() === '.png' ? '.png' : '.png';
  const dest = path.join(dir, id + ext);
  fs.copyFileSync(sourceFile, dest);
  const item = {
    id,
    name: meta.name || path.basename(sourceFile),
    variant: meta.variant === 'slim' ? 'slim' : 'classic',
    source: meta.source || 'local',
    account: meta.account || '',
    file: dest,
    at: new Date().toISOString()
  };
  const data = loadIndex(userDataDir);
  data.items.push(item);
  // 最多保留 40 条，超出删除最旧的
  if (data.items.length > 40) {
    const removed = data.items.splice(0, data.items.length - 40);
    for (const old of removed) {
      try { fs.unlinkSync(old.file); } catch (e) { /* 文件可能已被手动删除 */ }
    }
  }
  saveIndex(userDataDir, data);
  return item;
}

function get(userDataDir, id) {
  return loadIndex(userDataDir).items.find((item) => item.id === id) || null;
}

function remove(userDataDir, id) {
  const data = loadIndex(userDataDir);
  const index = data.items.findIndex((item) => item.id === id);
  if (index < 0) return { ok: false };
  const [item] = data.items.splice(index, 1);
  try { fs.unlinkSync(item.file); } catch (e) { /* 已不存在 */ }
  saveIndex(userDataDir, data);
  return { ok: true };
}

/** 记录一次披风切换 */
function addCapeRecord(userDataDir, meta = {}) {
  const file = path.join(storeDir(userDataDir), 'capes.json');
  let data = { items: [] };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* 首次使用 */ }
  if (!Array.isArray(data.items)) data.items = [];
  data.items.unshift({
    capeId: meta.capeId || '',
    alias: meta.alias || '',
    url: meta.url || '',
    account: meta.account || '',
    at: new Date().toISOString()
  });
  data.items = data.items.slice(0, 30);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return data.items;
}

function listCapeRecords(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(storeDir(userDataDir), 'capes.json'), 'utf8'));
    return Array.isArray(data.items) ? data.items : [];
  } catch (e) {
    return [];
  }
}

module.exports = { list, add, get, remove, addCapeRecord, listCapeRecords, storeDir };
