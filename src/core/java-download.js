'use strict';

/**
 * Java 运行时下载（逻辑照搬 PCL CE）：
 * 1. 读取 Mojang 的 java-runtime 索引 all.json，换源到 BMCLAPI；
 * 2. 根据平台取出 jre-legacy / java-runtime-alpha / beta / gamma / delta；
 * 3. 读取对应的 manifest，逐个文件下载到玩家指定的目录。
 *
 * 如果玩家指定的目录里已经有 Java，调用方（main.js）会直接复用，不会重复下载。
 */

const path = require('node:path');
const fsp = require('node:fs/promises');
const { rewriteUrl } = require('./version-manifest');
const { downloadFile } = require('./tools');

// 与 PCL CE 相同的运行时索引
const RUNTIME_INDEX = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

// PCL CE 里展示的名字
const RUNTIME_LABELS = {
  'jre-legacy': 'Java 8',
  'java-runtime-alpha': 'Java 16',
  'java-runtime-beta': 'Java 17',
  'java-runtime-gamma': 'Java 17',
  'java-runtime-delta': 'Java 21'
};

let indexCache = null;
let indexCacheAt = 0;
const INDEX_TTL = 10 * 60 * 1000;

function platformKey() {
  if (process.platform === 'win32') {
    if (process.arch === 'ia32') return 'windows-x86';
    if (process.arch === 'arm64') return 'windows-arm64';
    return 'windows-x64';
  }
  if (process.platform === 'darwin') return 'mac-os';
  return 'linux';
}

function runtimeIndexUrl(source) {
  return rewriteUrl(RUNTIME_INDEX, source);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'BMCL/2.4.0 (Java Runtime Download)' } });
  if (!res.ok) throw new Error('请求失败 HTTP ' + res.status);
  return res.json();
}

async function getRuntimeIndex(source) {
  const now = Date.now();
  if (indexCache && now - indexCacheAt < INDEX_TTL) return indexCache;
  const index = await fetchJson(runtimeIndexUrl(source));
  indexCache = index || {};
  indexCacheAt = now;
  return indexCache;
}

/**
 * 列出当前平台可下载的 Java 运行时。
 * @param {{source?: string}} options
 * @returns {Promise<Array<{name: string, label: string, version: string}>>}
 */
async function listRuntimes(options = {}) {
  const index = await getRuntimeIndex(options.source);
  const platform = platformKey();
  const bucket = index[platform] || {};
  const list = [];
  for (const name of Object.keys(RUNTIME_LABELS)) {
    const entry = bucket[name];
    if (!Array.isArray(entry) || !entry.length) continue;
    const first = entry[0] || {};
    const version = (first.version && first.version.name) || '';
    list.push({ name, label: RUNTIME_LABELS[name], version });
  }
  // 索引里出现但没在预设表里的运行时也一并列出
  for (const name of Object.keys(bucket)) {
    if (RUNTIME_LABELS[name]) continue;
    const entry = bucket[name];
    if (!Array.isArray(entry) || !entry.length) continue;
    const first = entry[0] || {};
    list.push({ name, label: name, version: (first.version && first.version.name) || '' });
  }
  return list;
}

async function fileMatchesSize(file, size) {
  if (!size) return false;
  try {
    const st = await fsp.stat(file);
    return st.isFile() && st.size === size;
  } catch (e) {
    return false;
  }
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

/**
 * 下载并解压一个 Java 运行时到目录。
 * @param {string} name - jre-legacy / java-runtime-gamma ...
 * @param {string} targetDir - 目标目录（Java 文件会直接放在这个目录下）
 * @param {{source?: string, onProgress?: Function}} options
 */
async function installRuntime(name, targetDir, options = {}) {
  if (!name) throw new Error('没有指定要下载的 Java 版本');
  if (!targetDir) throw new Error('请先选择 Java 下载目录');
  const source = options.source || 'bmclapi';
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};

  const index = await getRuntimeIndex(source);
  const platform = platformKey();
  const entry = (index[platform] || {})[name];
  if (!Array.isArray(entry) || !entry.length) {
    throw new Error('当前平台没有可用的 ' + name + ' 运行时');
  }
  const meta = entry[0];
  if (!meta || !meta.manifest || !meta.manifest.url) throw new Error('Java 运行时清单缺少下载地址');

  const manifestUrl = rewriteUrl(meta.manifest.url, source);
  const manifest = await fetchJson(manifestUrl);
  const files = manifest.files || {};
  const targets = Object.keys(files).filter((rel) => {
    const info = files[rel];
    return info && info.type === 'file' && info.downloads && info.downloads.raw;
  });
  const total = targets.length || 1;
  let done = 0;
  let bytes = 0;

  onProgress({ stage: 'prepare', name, total, done: 0, percent: 0 });

  await runPool(targets, 4, async (rel) => {
    const info = files[rel];
    const raw = info.downloads.raw;
    const dest = path.join(targetDir, rel);
    if (await fileMatchesSize(dest, raw.size)) {
      done += 1;
      bytes += Number(raw.size) || 0;
      onProgress({ stage: 'download', name, total, done, bytes, percent: Math.round((done / total) * 100) });
      return;
    }
    const url = rewriteUrl(raw.url, source);
    await downloadFile(url, dest);
    done += 1;
    bytes += Number(raw.size) || 0;
    onProgress({ stage: 'download', name, total, done, bytes, percent: Math.round((done / total) * 100) });
  });

  onProgress({ stage: 'done', name, total, done: total, bytes, percent: 100 });
  return {
    name,
    dir: targetDir,
    version: (meta.version && meta.version.name) || '',
    files: total
  };
}

module.exports = {
  RUNTIME_INDEX,
  RUNTIME_LABELS,
  listRuntimes,
  installRuntime,
  platformKey
};
