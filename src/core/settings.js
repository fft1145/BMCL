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
  uiTheme: 'pcl',            // pcl（PCL CE 经典白蓝）| bmcl（BMCL 官网暗色风格）

  // ===== 2.3.0 新增 =====
  javaDirs: [],              // Java 环境目录（只存目录，不存 Java 本体）
  javaList: [],              // 扫描到的 Java 列表缓存
  themePreset: 'default',    // default | midnight | ocean | sakura | forest | custom
  customTheme: {             // themePreset=custom 时生效
    bg: '#fbfbfb',
    card: '#ffffff',
    text: '#343d4a',
    muted: '#737373',
    accent: '#1370f3',
    titleFrom: '#1370f3',
    titleTo: '#0b5bcb'
  },
  customCss: '',             // 玩家自定义样式，不动核心代码
  wallpaper: {               // 自定义背景
    type: 'none',            // none | image | video
    path: '',
    dim: 0.25,               // 暗化程度 0-0.8
    blur: 0                  // 模糊像素
  },
  musicVolume: 0.7,
  musicAutoplay: false,
  aiApiKey: '',              // DeepSeek API Key
  aiModel: 'deepseek-chat',
  aiBaseUrl: 'https://api.deepseek.com'
};

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeTheme(input) {
  const src = input && typeof input === 'object' ? input : {};
  const fallback = DEFAULTS.customTheme;
  const pick = (key) => (/^#[0-9a-f]{3,8}$/i.test(String(src[key] || '')) ? src[key] : fallback[key]);
  return {
    bg: pick('bg'),
    card: pick('card'),
    text: pick('text'),
    muted: pick('muted'),
    accent: pick('accent'),
    titleFrom: pick('titleFrom'),
    titleTo: pick('titleTo')
  };
}

function normalizeWallpaper(input) {
  const src = input && typeof input === 'object' ? input : {};
  const type = ['image', 'video'].includes(src.type) ? src.type : 'none';
  return {
    type,
    path: typeof src.path === 'string' ? src.path : '',
    dim: clampNumber(src.dim, 0, 0.8, DEFAULTS.wallpaper.dim),
    blur: clampNumber(src.blur, 0, 24, DEFAULTS.wallpaper.blur)
  };
}

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
  out.javaDirs = Array.isArray(out.javaDirs)
    ? out.javaDirs.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim())
    : [];
  out.javaList = Array.isArray(out.javaList) ? out.javaList.filter((j) => j && j.path) : [];
  out.themePreset = ['default', 'midnight', 'ocean', 'sakura', 'forest', 'custom'].includes(out.themePreset)
    ? out.themePreset
    : 'default';
  out.customTheme = normalizeTheme(out.customTheme);
  out.customCss = typeof out.customCss === 'string' ? out.customCss.slice(0, 20000) : '';
  out.wallpaper = normalizeWallpaper(out.wallpaper);
  out.musicVolume = clampNumber(out.musicVolume, 0, 1, DEFAULTS.musicVolume);
  out.musicAutoplay = Boolean(out.musicAutoplay);
  out.aiApiKey = typeof out.aiApiKey === 'string' ? out.aiApiKey.trim() : '';
  out.aiModel = typeof out.aiModel === 'string' && out.aiModel.trim() ? out.aiModel.trim() : DEFAULTS.aiModel;
  out.aiBaseUrl = typeof out.aiBaseUrl === 'string' && /^https?:\/\//.test(out.aiBaseUrl)
    ? out.aiBaseUrl.replace(/\/+$/, '')
    : DEFAULTS.aiBaseUrl;
  return out;
}

module.exports = { DEFAULTS, normalize, load, save, normalizeTheme, normalizeWallpaper };

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
