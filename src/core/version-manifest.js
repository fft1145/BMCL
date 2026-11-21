'use strict';

/**
 * 版本清单（version_manifest_v2）与镜像地址处理。
 * 官方源：piston-meta.mojang.com
 * 国内镜像：BMCLAPI（bmclapi2.bangbang93.com）
 */

const SOURCES = {
  official: {
    key: 'official',
    label: '官方源（Mojang）',
    manifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    assetBase: 'https://resources.download.minecraft.net'
  },
  bmclapi: {
    key: 'bmclapi',
    label: 'BMCLAPI 镜像（国内加速）',
    manifest: 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json',
    assetBase: 'https://bmclapi2.bangbang93.com/assets'
  }
};

const MIRROR_RULES = [
  [/^https:\/\/launchermeta\.mojang\.com/, 'https://bmclapi2.bangbang93.com'],
  [/^https:\/\/piston-meta\.mojang\.com/, 'https://bmclapi2.bangbang93.com'],
  [/^https:\/\/piston-data\.mojang\.com/, 'https://bmclapi2.bangbang93.com'],
  [/^https:\/\/launcher\.mojang\.com/, 'https://bmclapi2.bangbang93.com'],
  [/^https:\/\/resources\.download\.minecraft\.net/, 'https://bmclapi2.bangbang93.com/assets']
];

/** 把 BMCLAPI 地址还原为官方地址，供官方源备用回退时使用 */
const REVERSE_RULES = [
  [/^https:\/\/bmclapi2\.bangbang93\.com\/assets\//, 'https://resources.download.minecraft.net/'],
  [/^https:\/\/bmclapi2\.bangbang93\.com\/v1\/objects\//, 'https://piston-data.mojang.com/v1/objects/'],
  [/^https:\/\/bmclapi2\.bangbang93\.com\//, 'https://piston-meta.mojang.com/']
];

function getSource(key) {
  return SOURCES[key] || SOURCES.bmclapi;
}

function oppositeSource(key) {
  return getSource(key).key === 'bmclapi' ? 'official' : 'bmclapi';
}

/** 返回「主源 + 备用源」的顺序数组，去重 */
function candidateSources(key) {
  const a = getSource(key).key;
  const b = oppositeSource(a);
  return a === b ? [a] : [a, b];
}

function rewriteUrlToOfficial(url) {
  if (!url || typeof url !== 'string') return url;
  for (const [pattern, replacement] of REVERSE_RULES) {
    if (pattern.test(url)) return url.replace(pattern, replacement);
  }
  return url;
}

/** 给一个文件地址列出「主地址 + 镜像地址」，失败时挨个试 */
function candidateUrls(url, sourceKey) {
  const primary = url;
  const alt = getSource(sourceKey).key === 'bmclapi'
    ? rewriteUrlToOfficial(url)
    : rewriteUrl(url, 'bmclapi');
  const out = [];
  for (const u of [primary, alt]) {
    if (u && typeof u === 'string' && !out.includes(u)) out.push(u);
  }
  return out;
}

function rewriteUrl(url, sourceKey) {
  if (!url || typeof url !== 'string') return url;
  const source = getSource(sourceKey);
  if (source.key !== 'bmclapi') return url;
  for (const [pattern, replacement] of MIRROR_RULES) {
    if (pattern.test(url)) return url.replace(pattern, replacement);
  }
  return url;
}

/** 深拷贝并重写 version json 里所有下载地址 */
function rewriteVersionJson(json, sourceKey) {
  if (!json || typeof json !== 'object') return json;
  if (getSource(sourceKey).key !== 'bmclapi') return json;
  const clone = JSON.parse(JSON.stringify(json));
  (function walk(node) {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (typeof value === 'string') {
          if (/^https:\/\//.test(value)) node[key] = rewriteUrl(value, sourceKey);
        } else {
          walk(value);
        }
      }
    }
  })(clone);
  return clone;
}

async function fetchWithTimeout(url, fetchImpl, timeoutMs) {
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持 fetch');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchManifest(options = {}) {
  const sources = candidateSources(options.source);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 15000;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持 fetch');
  const errors = [];
  for (let i = 0; i < sources.length; i++) {
    const source = getSource(sources[i]);
    try {
      const res = await fetchWithTimeout(source.manifest, fetchImpl, timeoutMs);
      const data = await res.json();
      if (!data || !Array.isArray(data.versions)) throw new Error('版本清单格式错误');
      return {
        source: source.key,
        usedFallback: i > 0,
        latest: data.latest || {},
        versions: data.versions,
        raw: data
      };
    } catch (err) {
      errors.push(source.label + '：' + ((err && err.message) ? err.message : String(err)));
    }
  }
  throw new Error(
    '获取版本清单失败，已尝试 ' + sources.map((k) => getSource(k).label).join('、') +
    '。请检查网络或代理后重试：' + errors.join('；')
  );
}

function findVersion(manifest, id) {
  if (!manifest || !Array.isArray(manifest.versions)) return null;
  return manifest.versions.find((v) => v.id === id) || null;
}

function latestVersionId(manifest, type) {
  if (!manifest) return '';
  if (manifest.latest && manifest.latest[type || 'release']) return manifest.latest[type || 'release'];
  const list = manifest.versions || [];
  const hit = list.find((v) => (type ? v.type === type : true));
  return hit ? hit.id : '';
}

async function fetchVersionJson(version, options = {}) {
  if (!version || !version.url) throw new Error('缺少版本下载地址');
  const sources = candidateSources(options.source);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 20000;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持 fetch');
  const errors = [];
  for (let i = 0; i < sources.length; i++) {
    const sourceKey = sources[i];
    const url = rewriteUrl(version.url, sourceKey);
    try {
      const res = await fetchWithTimeout(url, fetchImpl, timeoutMs);
      const json = await res.json();
      return {
        json: rewriteVersionJson(json, sourceKey),
        source: sourceKey,
        usedFallback: i > 0
      };
    } catch (err) {
      errors.push(getSource(sourceKey).label + '：' + ((err && err.message) ? err.message : String(err)));
    }
  }
  throw new Error(
    '下载版本描述文件失败，已尝试 ' + sources.map((k) => getSource(k).label).join('、') +
    '。请检查网络或代理后重试：' + errors.join('；')
  );
}

module.exports = {
  SOURCES,
  getSource,
  oppositeSource,
  candidateSources,
  rewriteUrl,
  rewriteUrlToOfficial,
  candidateUrls,
  rewriteVersionJson,
  fetchManifest,
  fetchVersionJson,
  findVersion,
  latestVersionId
};
