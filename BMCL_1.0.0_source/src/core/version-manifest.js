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

function getSource(key) {
  return SOURCES[key] || SOURCES.bmclapi;
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

async function fetchManifest(options = {}) {
  const sourceKey = options.source || 'bmclapi';
  const source = getSource(sourceKey);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 15000;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持 fetch');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(source.manifest, controller ? { signal: controller.signal } : {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.versions)) throw new Error('版本清单格式错误');
    return {
      source: source.key,
      latest: data.latest || {},
      versions: data.versions,
      raw: data
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const sourceKey = options.source || 'bmclapi';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 20000;
  if (!version || !version.url) throw new Error('缺少版本下载地址');
  const url = rewriteUrl(version.url, sourceKey);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return rewriteVersionJson(json, sourceKey);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  SOURCES,
  getSource,
  rewriteUrl,
  rewriteVersionJson,
  fetchManifest,
  fetchVersionJson,
  findVersion,
  latestVersionId
};
