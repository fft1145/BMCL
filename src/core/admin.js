'use strict';

/**
 * 启动上报 + IP 封禁校验。
 * 服务端地址由 launcher-version.json 的 adminApi 字段下发；
 * 没配置时只写本地日志，不做任何网络上报。
 */

const fs = require('fs');
const path = require('path');

const REPO = 'fft1145/BMCL';
const MANIFEST_URLS = [
  'https://raw.githubusercontent.com/' + REPO + '/main/launcher-version.json',
  'https://gh-proxy.com/https://raw.githubusercontent.com/' + REPO + '/main/launcher-version.json',
  'https://ghproxy.net/https://raw.githubusercontent.com/' + REPO + '/main/launcher-version.json'
];

function logFile(userDataDir) {
  return path.join(userDataDir, 'visit-log.jsonl');
}

function appendLog(userDataDir, entry) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.appendFileSync(logFile(userDataDir), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) { /* 本地日志失败不影响启动 */ }
}

function readLog(userDataDir, limit) {
  try {
    const lines = fs.readFileSync(logFile(userDataDir), 'utf8').trim().split('\n').filter(Boolean);
    const rows = lines.map((line) => {
      try { return JSON.parse(line); } catch (e) { return null; }
    }).filter(Boolean);
    return typeof limit === 'number' ? rows.slice(-limit) : rows;
  } catch (e) {
    return [];
  }
}

/** 从版本清单读取管理员后端地址（未配置返回空字符串） */
async function loadAdminApi(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || 5000;
  for (const url of MANIFEST_URLS) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, { signal: controller ? controller.signal : undefined });
      if (!res.ok) continue;
      const json = await res.json();
      const api = String((json && json.adminApi) || '').trim();
      if (/^https?:\/\//i.test(api)) return api.replace(/\/+$/, '');
    } catch (e) { /* 换下一条线路 */ } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return '';
}

/**
 * 上报一次启动，返回 {enabled, ip, banned, reason}
 * 服务端不可用时抛出错误，由调用方忽略。
 */
async function reportLaunch(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const userDataDir = options.userDataDir;
  const version = String(options.version || '');
  const adminApi = String(options.adminApi || '').replace(/\/+$/, '');
  const record = {
    time: new Date().toISOString(),
    version,
    platform: process.platform,
    arch: process.arch
  };
  if (!adminApi) {
    appendLog(userDataDir, Object.assign({ ip: '', source: 'local' }, record));
    return { enabled: false, ip: '', banned: false, reason: '' };
  }
  const timeoutMs = options.timeoutMs || 8000;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(adminApi + '/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
      signal: controller ? controller.signal : undefined
    });
    if (!res.ok) throw new Error('上报失败 HTTP ' + res.status);
    const data = await res.json();
    const result = {
      enabled: true,
      ip: String(data.ip || ''),
      banned: Boolean(data.banned),
      reason: String(data.reason || '')
    };
    appendLog(userDataDir, Object.assign({ source: 'remote' }, record, result));
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { appendLog, readLog, loadAdminApi, reportLaunch };
