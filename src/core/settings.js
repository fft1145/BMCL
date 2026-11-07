'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  source: 'bmclapi',        // bmclapi | official
  versionId: '',            // 上次选择的版本
  playerName: 'fft1145',    // 离线玩家名
  memoryMB: 2048,
  javaPath: '',             // 留空则自动寻找
  gameDir: '',              // 留空则自动扫描
  extraGameDirs: [],        // 用户手动添加过的候选目录
  autoUpdate: true,         // 自动检测更新
  versionIsolation: 'all',  // all（隔离所有实例）| off（不隔离）| version（仅隔离版本文件）
  crashWatch: true,         // 崩溃自检
  checkDownloads: true,     // 启动时检测下载是否被禁止
  curseForgeApiKey: '',      // 留空则使用内置的公共 Key
  msClientId: '',            // 留空则使用内置的微软应用 ID
  uiTheme: 'pcl'             // pcl（PCL CE 经典白蓝）| bmcl（BMCL 官网暗色风格）
};

function normalize(input) {
  const out = Object.assign({}, DEFAULTS, input || {});
  out.memoryMB = Math.max(512, Math.min(32768, Number(out.memoryMB) || DEFAULTS.memoryMB));
  out.source = out.source === 'official' ? 'official' : 'bmclapi';
  out.uiTheme = out.uiTheme === 'bmcl' ? 'bmcl' : 'pcl';
  out.versionIsolation = ['off', 'version'].includes(out.versionIsolation) ? out.versionIsolation : 'all';
  out.autoUpdate = Boolean(out.autoUpdate);
  out.crashWatch = Boolean(out.crashWatch);
  out.checkDownloads = Boolean(out.checkDownloads);
  out.extraGameDirs = Array.isArray(out.extraGameDirs)
    ? out.extraGameDirs.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim())
    : [];
  return out;
}

function load(file) {
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    return normalize({});
  }
}

function save(file, value) {
  const data = normalize(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

module.exports = { DEFAULTS, normalize, load, save };
