'use strict';

/**
 * Java 环境目录管理：
 * 玩家只需要给一个「放 Java 的目录」，启动器递归找出目录下所有 Java 本体，
 * 并读取每个 Java 的版本 / 位数 / 发行商，供玩家选用。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { parseJavaVersion } = require('./java');

const MAX_DEPTH = 5;
const MAX_CANDIDATES = 60;

function isExecutable(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (process.platform !== 'win32' && !(st.mode & 0o111)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

/** 递归收集目录下所有 java 可执行文件 */
function findJavaExecutables(root, options = {}) {
  const depthLimit = Number.isInteger(options.maxDepth) ? options.maxDepth : MAX_DEPTH;
  const found = [];
  const seen = new Set();
  const names = process.platform === 'win32' ? ['javaw.exe', 'java.exe'] : ['java', 'java.exe'];

  function walk(dir, depth) {
    if (found.length >= MAX_CANDIDATES || depth > depthLimit) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    // 先找当前目录的 java，再递归子目录
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (!isExecutable(candidate)) continue;
      let real = candidate;
      try { real = fs.realpathSync(candidate); } catch (e) { /* 保持原路径 */ }
      if (seen.has(real)) continue;
      seen.add(real);
      found.push(candidate);
    }
    for (const entry of entries) {
      if (found.length >= MAX_CANDIDATES) return;
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  try {
    if (fs.statSync(root).isDirectory()) walk(root, 0);
  } catch (e) {
    return [];
  }
  return found;
}

function probeOne(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stderr || '') + '\n' + String(stdout || '');
      if (err && !text.trim()) {
        resolve({ path: javaPath, ok: false, message: err.message });
        return;
      }
      const info = parseJavaVersion(text);
      const vendor = (text.match(/(?:Java HotSpot|OpenJDK|Eclipse Adoptium|Zulu|Microsoft|GraalVM|Amazon Corretto|Azul|Temurin|IBM|JetBrains|Liberica)[^\r\n]*/i) || [''])[0];
      const bits = /64-Bit|64-bit|amd64|x86_64/i.test(text) ? 64 : /32-Bit|32-bit/i.test(text) ? 32 : 0;
      resolve({
        path: javaPath,
        ok: info.major > 0,
        version: info.version,
        major: info.major,
        bits,
        vendor: vendor.trim()
      });
    });
  });
}

/** 扫描目录，返回去重后的 Java 列表（按主版本排序） */
async function scanJavaDir(dir) {
  const list = findJavaExecutables(dir);
  const results = [];
  for (const item of list) {
    results.push(await probeOne(item));
  }
  const seen = new Set();
  return results
    .filter((item) => {
      const key = (item.version || item.path).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.major || 0) - (a.major || 0));
}

/** 合并多次扫描结果，按路径去重 */
function mergeScans(existing, incoming) {
  const map = new Map();
  for (const item of [].concat(existing || [], incoming || [])) {
    if (!item || !item.path) continue;
    map.set(path.normalize(item.path).toLowerCase(), item);
  }
  return Array.from(map.values()).sort((a, b) => (b.major || 0) - (a.major || 0));
}

/** 按游戏版本需求挑选最合适的 Java */
function pickForMajor(list, major) {
  const candidates = (list || []).filter((j) => j && j.ok);
  const exact = candidates.find((j) => j.major === major);
  if (exact) return exact;
  const newer = candidates.filter((j) => j.major >= major).sort((a, b) => a.major - b.major)[0];
  if (newer) return newer;
  // 没有满足要求的版本时退回已安装的最高版本，由玩家自己决定是否重装
  return candidates.slice().sort((a, b) => (b.major || 0) - (a.major || 0))[0] || null;
}

module.exports = { findJavaExecutables, scanJavaDir, probeOne, mergeScans, pickForMajor };
