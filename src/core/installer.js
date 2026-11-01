'use strict';

/**
 * 版本安装器：根据 version json 生成下载清单并执行下载。
 * 只做「文件层面」的事情，不碰 GUI。
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { detectContext, isAllowed } = require('./rules');
const { getSource } = require('./version-manifest');

function ensureDir(dir) {
  return fsp.mkdir(dir, { recursive: true });
}

function sha1Buffer(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(file);
    stream.on('data', (d) => hash.update(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function libraryKey(lib) {
  const parts = String(lib.name || '').split(':');
  const [group, artifact, version, classifier] = parts;
  const base = String(artifact || '').split('@')[0];
  const ext = parts.join('').includes('@') ? String(lib.name).split('@')[1] : 'jar';
  return { group, artifact: base, version, classifier, ext };
}

function libraryPath(lib, suffix) {
  const { group, artifact, version, classifier, ext } = libraryKey(lib);
  const file = suffix
    ? `${artifact}-${version}-${suffix}.${ext}`
    : `${artifact}-${version}.${ext}`;
  const groupDir = String(group || '').replace(/\./g, '/');
  return [groupDir, artifact, version, file].join('/').replace(/\\/g, '/');
}

/**
 * 生成下载计划。
 * 返回 { files, natives, totalBytes }
 * files: { url, path, sha1, size, kind }
 * natives: { path, dest }  // 需要解压到 natives 目录
 */
function buildDownloadPlan(versionJson, options = {}) {
  const platforms = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const ctx = detectContext(platforms, arch);
  const versionsDir = options.versionsDir || '';
  const librariesDir = options.librariesDir || '';
  const assetsDir = options.assetsDir || '';
  const versionId = options.versionId || (versionJson && versionJson.id) || '';
  const assetBase =
    options.assetBase || getSource(options.source).assetBase;
  const files = [];
  const natives = [];
  const versionDir = path.join(versionsDir, versionId);

  if (versionJson.downloads && versionJson.downloads.client) {
    const client = versionJson.downloads.client;
    files.push({
      url: client.url,
      path: path.join(versionDir, versionId + '.jar'),
      sha1: client.sha1,
      size: client.size,
      kind: 'client'
    });
  }

  if (versionJson.logging && versionJson.logging.client && versionJson.logging.client.file) {
    const logFile = versionJson.logging.client.file;
    files.push({
      url: logFile.url,
      path: path.join(versionDir, 'log4j.xml'),
      sha1: logFile.sha1,
      size: logFile.size,
      kind: 'logging'
    });
  }

  const libs = versionJson.libraries || [];
  for (const lib of libs) {
    if (!isAllowed(lib.rules, ctx)) continue;
    const artifact = lib.downloads && lib.downloads.artifact;
    if (artifact && artifact.url) {
      files.push({
        url: artifact.url,
        path: path.join(librariesDir, artifact.path || libraryPath(lib)),
        sha1: artifact.sha1,
        size: artifact.size,
        kind: 'library'
      });
    }
    // Maven 布局的库（Fabric / Quilt / 部分 Forge 元数据只给 name + url）
    if (lib.name && lib.url && !artifact) {
      const { classifier } = libraryKey(lib);
      const rel = libraryPath(lib, classifier || '');
      files.push({
        url: String(lib.url).replace(/\/+$/, '') + '/' + rel,
        path: path.join(librariesDir, rel),
        kind: 'library-maven'
      });
    }
    // 旧版 natives（classifiers 形式）
    if (lib.natives && lib.downloads && lib.downloads.classifiers) {
      const nativeKey = lib.natives[ctx.os.name];
      if (nativeKey) {
        const classifier = lib.downloads.classifiers[nativeKey];
        if (classifier && classifier.url) {
          const suffix = nativeKey;
          const rel = classifier.path || libraryPath(lib, suffix);
          const libPath = path.join(librariesDir, rel);
          files.push({
            url: classifier.url,
            path: libPath,
            sha1: classifier.sha1,
            size: classifier.size,
            kind: 'natives'
          });
          natives.push({ path: libPath, dest: path.join(versionDir, 'natives') });
        }
      }
    }
  }

  if (versionJson.assetIndex && versionJson.assetIndex.url) {
    files.push({
      url: versionJson.assetIndex.url,
      path: path.join(assetsDir, 'indexes', versionJson.assetIndex.id + '.json'),
      sha1: versionJson.assetIndex.sha1,
      size: versionJson.assetIndex.size,
      kind: 'asset-index'
    });
  }

  const totalBytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  return { files, natives, totalBytes, assetBase, assetIndexId: versionJson.assetIndex && versionJson.assetIndex.id, versionId };
}

/** 根据 asset index 生成资源对象下载清单 */
function buildAssetPlan(assetIndex, options = {}) {
  const assetsDir = options.assetsDir || '';
  const assetBase = options.assetBase || getSource(options.source).assetBase;
  const files = [];
  const objects = (assetIndex && assetIndex.objects) || {};
  for (const key of Object.keys(objects)) {
    const obj = objects[key];
    if (!obj || !obj.hash) continue;
    files.push({
      url: `${assetBase}/${obj.hash.slice(0, 2)}/${obj.hash}`,
      path: path.join(assetsDir, 'objects', obj.hash.slice(0, 2), obj.hash),
      sha1: obj.hash,
      size: obj.size,
      kind: 'asset'
    });
  }
  return { files, totalBytes: files.reduce((s, f) => s + (Number(f.size) || 0), 0) };
}

async function downloadFile(file, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  await ensureDir(path.dirname(file.path));
  if (file.sha1 && fs.existsSync(file.path)) {
    try {
      if ((await sha1File(file.path)) === file.sha1) return { skipped: true };
    } catch (e) {
      /* 校验失败则重新下载 */
    }
  }
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持 fetch');
  const timeoutMs = options.timeoutMs || 30000;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(file.url, controller ? { signal: controller.signal } : {});
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status + ' · ' + file.url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (file.sha1 && sha1Buffer(buf) !== file.sha1) {
      throw new Error('文件校验失败：' + path.basename(file.path));
    }
    const tmp = file.path + '.part';
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, file.path);
    return { skipped: false, bytes: buf.length };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 并发下载，带失败重试 */
async function runPlan(plan, options = {}) {
  const concurrency = Math.max(1, Math.min(16, options.concurrency || 4));
  const retry = options.retry == null ? 2 : options.retry;
  const onProgress = options.onProgress || function () {};
  const list = (plan.files || []).slice();
  let done = 0;
  let bytes = 0;
  let failed = 0;
  const errors = [];

  async function worker() {
    while (list.length) {
      const file = list.shift();
      let lastErr = null;
      for (let attempt = 0; attempt <= retry; attempt++) {
        try {
          const result = await downloadFile(file, options);
          if (!result.skipped) bytes += result.bytes || 0;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < retry) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      if (lastErr) {
        failed++;
        errors.push({ file: file.path, message: lastErr.message });
      }
      done++;
      onProgress({ done, total: plan.files.length, bytes, failed, current: file.path });
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return { done, total: plan.files.length, failed, errors, bytes };
}

module.exports = {
  ensureDir,
  sha1Buffer,
  sha1File,
  libraryPath,
  buildDownloadPlan,
  buildAssetPlan,
  downloadFile,
  runPlan
};
