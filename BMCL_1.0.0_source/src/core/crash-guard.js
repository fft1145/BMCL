'use strict';

/**
 * 崩溃自检：
 * 1) 启动器自身：上次是否异常退出（session 标记文件）
 * 2) 游戏：读取 crash-reports 与 latest.log，给出可读的诊断建议
 */

const fs = require('node:fs');
const path = require('node:path');

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeJsonSafe(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/** 标记一次启动，落盘后即可检测异常退出 */
function markSessionStart(file, info = {}) {
  writeJsonSafe(file, {
    running: true,
    cleanExit: false,
    pid: info.pid || (typeof process !== 'undefined' ? process.pid : 0),
    startedAt: new Date().toISOString(),
    version: info.version || ''
  });
  return readJsonSafe(file);
}

function markSessionEnd(file) {
  const prev = readJsonSafe(file) || {};
  writeJsonSafe(file, Object.assign({}, prev, {
    running: false,
    cleanExit: true,
    endedAt: new Date().toISOString()
  }));
}

/** 上一轮是否崩溃：标记仍是 running 且没有 cleanExit */
function detectPreviousCrash(file) {
  const prev = readJsonSafe(file);
  if (!prev) return null;
  if (prev.running === true && prev.cleanExit !== true) {
    return {
      crashed: true,
      startedAt: prev.startedAt || '',
      pid: prev.pid || 0,
      version: prev.version || ''
    };
  }
  return { crashed: false };
}

/** 读取文件末尾若干行 */
function readTail(file, maxLines = 120) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
  } catch (e) {
    return '';
  }
}

function parseCrashReport(text) {
  const src = String(text || '');
  const out = { description: '', stack: [], causes: [] };
  const desc = src.match(/^Description:\s*(.+)$/m);
  if (desc) out.description = desc[1].trim();
  const causeRe = /^Caused by:\s*(.+)$/gm;
  let m;
  while ((m = causeRe.exec(src)) !== null) out.causes.push(m[1].trim());
  const lines = src.split(/\r?\n/);
  const descIndex = lines.findIndex((l) => /^Description:/.test(l));
  if (descIndex >= 0) {
    for (let i = descIndex + 1; i < lines.length && out.stack.length < 6; i++) {
      const line = lines[i].trim();
      if (/^at\s|^\.\.\./.test(line)) out.stack.push(line);
      else if (/^Caused by:|^Description:/.test(line)) break;
      else if (line === '' && out.stack.length) break;
    }
  }
  return out;
}

const RULES = [
  {
    test: /OutOfMemoryError|Java heap space|GC overhead/i,
    cause: '内存不足',
    suggestion: '在「设置」里把内存调大（建议 4096 MB 或更高），并关闭占内存的其他程序。'
  },
  {
    test: /UnsupportedClassVersionError|class file version|Unsupported major\.minor/i,
    cause: 'Java 版本不匹配',
    suggestion: '这个游戏版本需要不同版本的 Java。请在「设置」里指定合适的 java.exe（1.12 及以下用 Java 8，1.17+ 用 Java 17/21）。'
  },
  {
    test: /NoClassDefFoundError|ClassNotFoundException|Could not find or load main class/i,
    cause: '依赖库缺失或版本文件损坏',
    suggestion: '在「版本」页重新安装该版本，或检查 libraries、版本 json 是否完整。'
  },
  {
    test: /GLFW error|OpenGL|Pixel format|PixelFormat|LWJGL.*(failed|error)/i,
    cause: '显卡 / OpenGL 驱动问题',
    suggestion: '更新显卡驱动；笔记本请确认游戏使用的是独立显卡；也可尝试关闭光影。'
  },
  {
    test: /Incompatible mod set|requires .* version|Mixin|mixin.*(fail|error)|Mod resolution/i,
    cause: '模组冲突',
    suggestion: '逐个禁用最近新增的模组，确认 Forge / Fabric 与模组版本匹配。'
  },
  {
    test: /AccessDenied|access denied|拒绝访问|Permission denied|EACCES/i,
    cause: '文件权限不足',
    suggestion: '用管理员身份运行启动器，或把游戏目录换成有写入权限的路径。'
  },
  {
    test: /UnknownHost|Connection (timed out|reset)|Failed to download|SocketException|SSLException/i,
    cause: '网络异常',
    suggestion: '检查网络或在「设置」里切换下载源（官方 / BMCLAPI）。'
  },
  {
    test: /java\.lang\.Error|Exception in thread "main"/i,
    cause: '启动阶段异常',
    suggestion: '查看下方日志定位第一个报错位置；必要时重装该版本。'
  }
];

function diagnose(input = {}) {
  const crashReport = input.crashReport || '';
  const latestLog = input.latestLog || '';
  const exitCode = input.exitCode;
  const text = crashReport + '\n' + latestLog;
  const hits = [];
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      hits.push({ cause: rule.cause, suggestion: rule.suggestion });
    }
  }
  const parsed = crashReport ? parseCrashReport(crashReport) : { description: '', stack: [], causes: [] };
  if (exitCode === -1 || exitCode === 1) {
    // 常见于 Java 启动失败，不重复加原因
  }
  const summary = parsed.description
    ? parsed.description
    : hits.length
      ? '检测到可能的崩溃原因：' + hits.map((h) => h.cause).join('、')
      : '未在日志中找到明确原因，建议查看完整日志。';
  return {
    summary,
    exitCode: exitCode == null ? null : exitCode,
    causes: hits,
    stack: parsed.stack,
    causedBy: parsed.causes
  };
}

/** 找到最新的崩溃报告文件 */
function latestCrashReport(gameDir) {
  const dir = path.join(gameDir, 'crash-reports');
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^crash-.*\.txt$/i.test(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? path.join(dir, files[0].f) : '';
  } catch (e) {
    return '';
  }
}

/** 综合诊断游戏目录 */
function diagnoseGameDir(gameDir, options = {}) {
  const reportPath = options.reportPath || latestCrashReport(gameDir);
  const crashReport = reportPath ? readTail(reportPath, 200) : '';
  const logPath = path.join(gameDir, 'logs', 'latest.log');
  const latestLog = readTail(logPath, 160);
  const result = diagnose({ crashReport, latestLog, exitCode: options.exitCode });
  return Object.assign({ reportPath, logPath, hasReport: Boolean(reportPath) }, result);
}

module.exports = {
  markSessionStart,
  markSessionEnd,
  detectPreviousCrash,
  readTail,
  parseCrashReport,
  diagnose,
  latestCrashReport,
  diagnoseGameDir
};
