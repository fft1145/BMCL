'use strict';

/**
 * 更新器：GitHub Releases 检查 + 只覆盖启动器自有文件。
 *
 * 安全红线：任何游戏文件（saves / .minecraft / options.txt / mods /
 * versions / libraries / assets …）都不可能进入更新白名单。
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const REPO = 'fft1145/BMCL';

/** 允许被更新覆盖的启动器文件 / 目录 */
const LAUNCHER_UPDATE_WHITELIST = [
  'main.js',
  'preload.js',
  'package.json',
  'README.md',
  'launcher-version.json',
  'src/',
  'renderer/'
];

/** 明确禁止：游戏文件所在目录 */
const GAME_PATH_PATTERN =
  /(^|\/)(\.minecraft|saves|mods|resourcepacks|shaderpacks|crash-reports|logs|versions|libraries|assets|options\.txt|servers\.dat|optionsof\.txt)(\/|$)/i;

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function normalizeRelative(p) {
  return toPosix(p).replace(/^\.\//, '').replace(/^\/+/, '');
}

/** 判断某个相对路径是否可以由更新覆盖 */
function isPathAllowedForUpdate(relativePath) {
  const rel = normalizeRelative(relativePath);
  if (!rel) return false;
  if (rel.includes('..')) return false;
  if (GAME_PATH_PATTERN.test(rel)) return false;
  return LAUNCHER_UPDATE_WHITELIST.some((entry) => {
    if (entry.endsWith('/')) return rel.startsWith(entry);
    return rel === entry;
  });
}

/** 版本号比较：支持 1.2.3 / v1.2.3 / 1.2.3-beta.1 */
function compareVersions(a, b) {
  const clean = (v) => String(v || '').trim().replace(/^v/i, '').split(/[-+]/)[0];
  const pa = clean(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = clean(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function parseRelease(json) {
  if (!json) return null;
  return {
    tag: json.tag_name || '',
    version: String(json.tag_name || '').replace(/^v/i, ''),
    name: json.name || json.tag_name || '',
    notes: json.body || '',
    htmlUrl: json.html_url || `https://github.com/${REPO}/releases`,
    publishedAt: json.published_at || '',
    assets: Array.isArray(json.assets)
      ? json.assets.map((a) => ({
          name: a.name,
          size: a.size,
          url: a.browser_download_url,
          contentType: a.content_type
        }))
      : []
  };
}

/** 固定产物名：配合 releases/latest 直链，网站与启动器都无需随版本改链接 */
const UPDATE_ASSET_NAME = 'fft1145-portable.exe';

function findUpdateAsset(assets) {
  if (!Array.isArray(assets)) return null;
  // 优先固定名的便携版 exe
  const fixed = assets.find((a) => a.name === UPDATE_ASSET_NAME);
  if (fixed) return fixed;
  // 兼容历史版本：任意 fft1145/bmcl 的 exe
  const exes = assets.filter((a) => /\.exe$/i.test(a.name));
  const winExe = exes.find((a) => /fft1145|bmcl/i.test(a.name)) || exes[0];
  if (winExe) return winExe;
  // 再退回 zip（旧版本产物）
  const zips = assets.filter((a) => /\.zip$/i.test(a.name));
  if (!zips.length) return null;
  const win = zips.find((a) => /win|fft1145|bmcl/i.test(a.name));
  return win || zips[0];
}

async function checkForUpdate(options = {}) {
  const repo = options.repo || REPO;
  const currentVersion = options.currentVersion || '0.0.0';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持 fetch');
  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fft1145-bmcl-updater'
    }
  });
  if (!res.ok) throw new Error('GitHub 更新检查失败：HTTP ' + res.status);
  const release = parseRelease(await res.json());
  const hasUpdate = release && compareVersions(release.version, currentVersion) > 0;
  return {
    hasUpdate: Boolean(hasUpdate),
    currentVersion,
    release,
    asset: release ? findUpdateAsset(release.assets) : null
  };
}

/**
 * 「有没有被禁止下载」检测：
 * 只要发出请求并收到任意 HTTP 响应，就说明网络通路正常；
 * 全部超时 / 网络错误则判定为被禁止（或网络不可用）。
 */
async function checkDownloadAllowed(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const urls = options.urls || [
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'
  ];
  if (typeof fetchImpl !== 'function') return { allowed: false, reason: '当前环境不支持网络请求' };
  const timeoutMs = options.timeoutMs || 10000;
  const reasons = [];
  for (const url of urls) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, controller ? { signal: controller.signal } : {});
      if (res && typeof res.status === 'number') {
        return { allowed: true, url, status: res.status };
      }
      reasons.push(url + '：无响应');
    } catch (err) {
      reasons.push(url + '：' + (err && err.message ? err.message : '网络错误'));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { allowed: false, reason: reasons.join('；') };
}

/** 递归列出目录内所有相对路径 */
function listRelativeFiles(rootDir) {
  const out = [];
  if (!rootDir || !fs.existsSync(rootDir)) return out;
  (function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  })(rootDir, '');
  return out;
}

/** 校验一个解压后的更新目录，返回被拒绝的文件清单 */
function validateUpdateTree(rootDir) {
  const files = listRelativeFiles(rootDir);
  const blocked = files.filter((rel) => !isPathAllowedForUpdate(rel));
  return { ok: blocked.length === 0, files, blocked };
}

/**
 * 应用更新：复制前先整体校验，任何一个越界文件都会让整次更新中止。
 */
async function applyUpdateTree(sourceDir, appDir, options = {}) {
  const audit = validateUpdateTree(sourceDir);
  if (!audit.ok) {
    const err = new Error('更新被拒绝：包含非启动器文件（' + audit.blocked.join(', ') + '）');
    err.blocked = audit.blocked;
    throw err;
  }
  const onProgress = options.onProgress || function () {};
  let done = 0;
  for (const rel of audit.files) {
    const from = path.join(sourceDir, rel);
    const to = path.join(appDir, rel);
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
    done++;
    onProgress({ done, total: audit.files.length, file: rel });
  }
  return { updated: done, files: audit.files };
}

module.exports = {
  REPO,
  UPDATE_ASSET_NAME,
  LAUNCHER_UPDATE_WHITELIST,
  isPathAllowedForUpdate,
  compareVersions,
  parseRelease,
  findUpdateAsset,
  checkForUpdate,
  checkDownloadAllowed,
  listRelativeFiles,
  validateUpdateTree,
  applyUpdateTree
};
