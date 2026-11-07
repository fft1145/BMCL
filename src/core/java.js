'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function parseJavaVersion(output) {
  const text = String(output || '');
  const quoted = text.match(/version\s+"([^"]+)"/i);
  const openJdk = text.match(/openjdk\s+([0-9][^\s]*)/i);
  const version = quoted ? quoted[1] : openJdk ? openJdk[1] : '';
  if (!version) return { version: '', major: 0 };
  const nums = version.split('.');
  let major;
  if (nums[0] === '1') major = parseInt(nums[1], 10) || 0;
  else major = parseInt(nums[0], 10) || 0;
  return { version, major };
}

/** 在目录里找 java 可执行文件（Windows 优先 java.exe） */
function findJavaIn(dir) {
  if (!dir) return '';
  const names = process.platform === 'win32' ? ['java.exe', 'java'] : ['java', 'java.exe'];
  for (const name of names) {
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* 忽略不存在的候选 */ }
  }
  return '';
}

/**
 * 把用户填写的 Java 路径归一化成可执行文件。
 * 支持：
 *  - java 本体（...\bin\java.exe）
 *  - Java 安装目录（...\jdk-21）→ 自动进 bin 找
 *  - bin 目录本身（...\jdk-21\bin）
 * 留空时返回 'java'，交给系统 PATH。
 */
function resolveJavaExecutable(input) {
  let raw = String(input == null ? '' : input).trim().replace(/^"(.*)"$/, '$1');
  // 去掉末尾的分隔符，但保留盘符根目录（C:\）与根路径（/）
  while (raw.length > 1 && /[\\/]$/.test(raw) && !/^[A-Za-z]:[\\/]$/.test(raw)) {
    raw = raw.slice(0, -1);
  }
  if (!raw) return 'java';
  let stat;
  try { stat = fs.statSync(raw); } catch { return raw; }
  if (!stat.isDirectory()) return raw;
  // 玩家给的就是 bin 目录
  const direct = findJavaIn(raw);
  if (direct) return direct;
  // 玩家给的是 Java 安装目录
  const inBin = findJavaIn(path.join(raw, 'bin'));
  if (inBin) return inBin;
  return raw;
}

function probeJava(javaPath, execFileImpl = execFile) {
  const target = resolveJavaExecutable(javaPath);
  return new Promise((resolve) => {
    execFileImpl(target, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, javaPath: target, message: err.message });
        return;
      }
      const info = parseJavaVersion(String(stderr || '') + '\n' + String(stdout || ''));
      resolve({ ok: info.major > 0, javaPath: target, version: info.version, major: info.major });
    });
  });
}

/** 根据版本需求推荐 Java 主版本 */
function recommendJavaMajor(mcVersion) {
  const m = String(mcVersion || '').match(/^1\.(\d+)/);
  if (!m) return 17;
  const minor = Number(m[1]);
  if (minor <= 16) return 8;
  if (minor <= 20) return 17;
  return 21;
}

module.exports = { parseJavaVersion, resolveJavaExecutable, probeJava, recommendJavaMajor };
