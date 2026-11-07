'use strict';

/**
 * 工具模块：游戏目录检测、清理垃圾、启动计数、快捷方式、皮肤下载、
 * 通用文件下载、Modrinth 模组。
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');

function ensureDir(dir) {
  return fsp.mkdir(dir, { recursive: true });
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/** 读取单个版本目录的元信息；没有同名 json 则返回 null */
function readVersionMeta(versionDir, id) {
  const jsonPath = path.join(versionDir, (id || path.basename(versionDir)) + '.json');
  if (!fs.existsSync(jsonPath)) return null;
  let type = 'release';
  let time = '';
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    type = data.type || type;
    time = data.releaseTime || data.time || '';
  } catch { /* 忽略损坏的 json */ }
  return {
    id: id || path.basename(versionDir),
    type,
    time,
    installedAt: fs.statSync(jsonPath).mtime.toISOString()
  };
}

/**
 * 把玩家选择的目录归一化成 .minecraft 游戏根目录。
 * 支持三种选法：
 *  - 游戏根目录（含 versions 子目录）
 *  - versions 目录本身
 *  - 单个版本目录（versions/1.20.1）
 */
function normalizeGameDir(dir) {
  if (!dir || typeof dir !== 'string') return '';
  const input = dir.trim();
  if (!input) return '';
  const root = path.resolve(input);
  if (!isDirectory(root)) return root;
  // 单个版本目录 → 回到 versions 容器
  if (readVersionMeta(root, path.basename(root))) {
    const parent = path.dirname(root);
    return path.basename(parent).toLowerCase() === 'versions' ? path.dirname(parent) : parent;
  }
  // versions 目录本身 → 回到游戏根目录
  if (path.basename(root).toLowerCase() === 'versions') {
    return path.dirname(root);
  }
  return root;
}

/**
 * 版本隔离后的实际游戏数据目录。
 *  «隔离所有实例» 时返回 <gameDir>/versions/<versionId>，
 *  其余模式（不隔离 / 仅隔离版本文件）返回游戏根目录。
 */
function instanceDir(gameDir, versionId, isolation) {
  if (!gameDir) return gameDir;
  if (isolation === 'all' && versionId) return path.join(gameDir, 'versions', versionId);
  return gameDir;
}

/**
 * 判断一个目录是不是合法的 Minecraft 游戏目录。
 * 支持传入游戏根目录、versions 目录或单个版本目录。
 * 判据：存在 <版本>/<版本>.json（或 <版本>.jar）。
 */
function isValidGameDir(dir) {
  if (!dir || typeof dir !== 'string') return false;
  const root = normalizeGameDir(dir);
  if (!root) return false;
  const versionsDir = path.join(root, 'versions');
  if (!isDirectory(versionsDir)) return false;
  let entries;
  try { entries = fs.readdirSync(versionsDir, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(versionsDir, entry.name, entry.name + '.json')) ||
        fs.existsSync(path.join(versionsDir, entry.name, entry.name + '.jar'))) {
      return true;
    }
  }
  return false;
}

/**
 * 列出目录里可识别的版本。
 * dir 可以是游戏根目录、versions 目录或单个版本目录。
 */
function listVersionsIn(dir) {
  const root = normalizeGameDir(dir);
  if (!root) return [];
  const versionsDir = path.join(root, 'versions');
  if (!isDirectory(versionsDir)) return [];
  const out = [];
  let entries;
  try { entries = fs.readdirSync(versionsDir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readVersionMeta(path.join(versionsDir, entry.name), entry.name);
    if (meta) out.push(meta);
  }
  return out.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
}

/** 候选安装目录（按优先级） */
function candidateDirs(options = {}) {
  const extra = options.extra || [];
  const home = os.homedir();
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const out = [];

  const push = (dir, label) => {
    if (dir) out.push({ path: path.resolve(dir), label });
  };

  if (process.platform === 'win32') {
    push(appData && path.join(appData, '.minecraft'), '官方启动器（%APPDATA%\\.minecraft）');
    push(home && path.join(home, 'AppData', 'Roaming', '.minecraft'), '官方启动器（Roaming）');
    push(localAppData && path.join(localAppData, 'Programs', 'PrismLauncher', 'instances'), 'PrismLauncher');
    push(localAppData && path.join(localAppData, 'Programs', 'MultiMC', 'instances'), 'MultiMC');
    push(localAppData && path.join(localAppData, 'Programs', 'ATLauncher', 'instances'), 'ATLauncher');
    push(home && path.join(home, '.hmcl', '.minecraft'), 'HMCL');
    push(home && path.join(home, 'Desktop', '.minecraft'), '桌面 .minecraft');
  } else {
    push(path.join(home, '.minecraft'), '官方启动器（.minecraft）');
    push(path.join(home, '.local', 'share', 'PrismLauncher', 'instances'), 'PrismLauncher');
    push(path.join(home, '.local', 'share', 'multimc', 'instances'), 'MultiMC');
    push(path.join(home, '.hmcl', '.minecraft'), 'HMCL');
  }
  for (const dir of extra) push(dir, '手动指定');
  return out;
}

/**
 * 扫描常见 Minecraft 安装目录。
 * 返回仅包含「确实存在可用版本」的目录，并按可识别版本数从多到少排序。
 */
function scanMinecraftDirs(options = {}) {
  const seen = new Map();
  for (const item of candidateDirs(options)) {
    // 允许玩家填 versions 目录或单个版本目录，统一归一化到游戏根目录
    const root = normalizeGameDir(item.path);
    const key = String(root || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    const versions = listVersionsIn(root);
    if (!versions.length) continue;
    seen.set(key, {
      path: root,
      label: item.label,
      versions: versions.length,
      sample: versions.slice(0, 3).map((v) => v.id)
    });
  }
  return [...seen.values()].sort((a, b) => b.versions - a.versions);
}

/** 清理游戏垃圾：logs 目录、crash-reports、temp、残留 .part 文件 */
async function cleanJunk(gameDir) {
  let freed = 0;
  let removed = 0;
  const errors = [];

  for (const dir of [path.join(gameDir, 'logs'), path.join(gameDir, 'crash-reports'), path.join(gameDir, 'temp')]) {
    if (!isDirectory(dir)) continue;
    try {
      for (const entry of await fsp.readdir(dir)) {
        const full = path.join(dir, entry);
        try {
          const st = await fsp.stat(full);
          if (st.isFile()) {
            freed += st.size;
            await fsp.rm(full, { force: true });
            removed++;
          }
        } catch { errors.push(full); }
      }
    } catch { errors.push(dir); }
  }

  async function walkPart(dir) {
    if (!isDirectory(dir)) return;
    for (const entry of await fsp.readdir(dir)) {
      const full = path.join(dir, entry);
      let st;
      try { st = await fsp.stat(full); } catch { continue; }
      if (st.isDirectory()) {
        await walkPart(full);
      } else if (entry.endsWith('.part')) {
        try { freed += st.size; await fsp.rm(full, { force: true }); removed++; } catch { errors.push(full); }
      }
    }
  }
  if (isDirectory(gameDir)) await walkPart(gameDir);

  return { freed, removed, errors: errors.length };
}

/** 启动计数 */
function launchCountFile(userDataDir) {
  return path.join(userDataDir, 'launch-count.json');
}
function getLaunchCount(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(launchCountFile(userDataDir), 'utf8')).count || 0;
  } catch { return 0; }
}
function incrementLaunchCount(userDataDir) {
  const file = launchCountFile(userDataDir);
  let count = 0;
  try { count = JSON.parse(fs.readFileSync(file, 'utf8')).count || 0; } catch { /* 首次 */ }
  count++;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ count }, null, 2), 'utf8');
  return count;
}

/** 创建桌面快捷方式 */
async function createShortcut(appDir, exePath) {
  const desktop = path.join(os.homedir(), 'Desktop');
  if (!isDirectory(desktop)) throw new Error('找不到桌面目录');
  const target = exePath || process.execPath;
  if (process.platform === 'win32') {
    const url = path.join(desktop, 'BMCL.lnk');
    const script = `Set WshShell = CreateObject("WScript.Shell")
Set oShellLink = WshShell.CreateShortcut("${url.replace(/\\/g, '\\\\')}")
oShellLink.TargetPath = "${target.replace(/\\/g, '\\\\')}"
oShellLink.WorkingDirectory = "${path.dirname(target).replace(/\\/g, '\\\\')}"
oShellLink.Description = "BMCL 启动器"
oShellLink.Save`;
    const vbs = path.join(os.tmpdir(), 'bmcl-shortcut.vbs');
    fs.writeFileSync(vbs, script, 'utf8');
    await new Promise((resolve, reject) => {
      require('node:child_process').execFile('cscript.exe', ['//nologo', vbs], (err) => err ? reject(err) : resolve());
    });
    return { path: url };
  }
  const desktopFile = path.join(desktop, 'BMCL.desktop');
  const content = `[Desktop Entry]
Type=Application
Name=BMCL
Exec="${target}"
Icon=${path.join(appDir, 'build', 'icon.png')}
Terminal=false
Categories=Game;`;
  await fsp.writeFile(desktopFile, content, 'utf8');
  return { path: desktopFile };
}

/** 通用文件下载（带进度回调） */
async function downloadFile(url, destPath, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const onProgress = options.onProgress || function () {};
  if (!url || !/^https?:\/\//.test(String(url))) throw new Error('下载地址无效，必须以 http(s):// 开头');
  await ensureDir(path.dirname(destPath));
  const res = await fetchImpl(url, { headers: options.headers || {} });
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      received += value.length;
      onProgress({ received, total });
    }
  } else {
    const buf = Buffer.from(await res.arrayBuffer());
    chunks.push(buf);
    received = buf.length;
    onProgress({ received, total });
  }
  const buf = Buffer.concat(chunks);
  const tmp = destPath + '.part';
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, destPath);
  return { bytes: buf.length, total, path: destPath };
}

/** 下载玩家皮肤到本地 */
async function downloadSkin(playerName, destPath) {
  const url = 'https://mc-heads.net/skin/' + encodeURIComponent(playerName);
  return downloadFile(url, destPath);
}

// ===== Modrinth =====
const MODRINTH_API = 'https://api.modrinth.com/v2';
const MODRINTH_HEADERS = { 'User-Agent': 'fft1145-bmcl/1.0 (github.com/fft1145/BMCL)' };

// Modrinth 支持的 project_type：mod / modpack / resourcepack / shader / datapack
// 没有 world（世界/存档）类型，遇到 world 时去掉 project_type 限定改为全库搜索
const MODRINTH_PROJECT_TYPES = new Set(['mod', 'modpack', 'resourcepack', 'shader', 'datapack']);

function modrinthFacets(projectType, gameVersion) {
  const facets = [];
  // 默认按 mod 搜索；world 不在 Modrinth 支持的类型里，去掉 project_type 限定
  const type = projectType || 'mod';
  if (MODRINTH_PROJECT_TYPES.has(type)) {
    facets.push(['project_type:' + type]);
  }
  if (gameVersion) facets.push(['versions:' + gameVersion]);
  return JSON.stringify(facets);
}

async function modrinthSearch(query, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const params = new URLSearchParams({
    query: query || '',
    facets: modrinthFacets(options.projectType, options.gameVersion),
    limit: String(options.limit || 20),
    offset: String(options.offset || 0),
    index: options.sort === 'downloads' ? 'downloads'
      : options.sort === 'newest' ? 'newest'
        : options.sort === 'updated' ? 'updated'
          : 'relevance'
  });
  const res = await fetchImpl(MODRINTH_API + '/search?' + params.toString(), { headers: MODRINTH_HEADERS });
  if (!res.ok) throw new Error('Modrinth 搜索失败 HTTP ' + res.status);
  const data = await res.json();
  return (data.hits || []).map((h) => ({
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    author: h.author,
    description: h.description,
    downloads: h.downloads,
    iconUrl: h.icon_url,
    categories: h.categories || [],
    versions: h.versions || [],
    projectType: h.project_type || options.projectType || 'mod',
    source: 'modrinth'
  }));
}

/** 获取某个模组可用的文件版本 */
async function modrinthVersions(projectId, gameVersion, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!projectId) throw new Error('缺少模组 ID');
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  const res = await fetchImpl(MODRINTH_API + '/project/' + encodeURIComponent(projectId) + '/version?' + params.toString(), {
    headers: MODRINTH_HEADERS
  });
  if (!res.ok) throw new Error('获取模组版本失败 HTTP ' + res.status);
  const list = await res.json();
  return (list || []).map((v) => {
    const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0];
    return {
      id: v.id,
      name: v.name,
      versionNumber: v.version_number,
      gameVersions: v.game_versions || [],
      loaders: v.loaders || [],
      fileName: file && file.filename,
      fileUrl: file && file.url,
      fileSize: (file && file.size) || 0,
      datePublished: v.date_published
    };
  });
}

// ===== CurseForge =====
// PCL2 CE 的公开客户端 Key（源码中通过 Secrets 注入，这里作为默认值，可在设置里覆盖）
const CURSEFORGE_DEFAULT_KEY = '$2a$10$TK3CR9laZ1oUb51B1rXZJ.UQ.bLHZGEZ8Y86nbMacMf1rorvdkBWG';
const CURSEFORGE_API = 'https://api.curseforge.com/v1';
const CURSEFORGE_GAME_ID = 432;
const CURSEFORGE_CLASS = {
  mod: 6,
  modpack: 4471,
  datapack: 6945,
  shader: 6552,
  resourcepack: 12,
  world: 17
};
const CURSEFORGE_SORT = { relevance: 4, follows: 2, popularity: 2, downloads: 6, newest: 11, updated: 3 };
const CURSEFORGE_LOADER = { forge: 1, liteloader: 3, fabric: 4, quilt: 5, neoforge: 6 };

function curseForgeKey(options = {}) {
  return String(options.apiKey || process.env.CURSEFORGE_API_KEY || CURSEFORGE_DEFAULT_KEY).trim();
}

async function curseForgeGet(pathname, params, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const search = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetchImpl(CURSEFORGE_API + pathname + search, {
    headers: Object.assign({ 'x-api-key': curseForgeKey(options), Accept: 'application/json' }, options.headers || {})
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('CurseForge API Key 无效或额度已用完，请在设置里填写自己的 Key');
    }
    if (res.status === 404) throw new Error('CurseForge 上找不到该项目');
    throw new Error('CurseForge 请求失败 HTTP ' + res.status);
  }
  return res.json();
}

/** CurseForge 文件下载地址（作者未开放 API 下载时按 PCL 的规则拼 CDN 链接） */
function curseForgeFileUrl(file) {
  if (!file) return '';
  if (file.downloadUrl && /^https?:\/\//.test(file.downloadUrl)) {
    return String(file.downloadUrl).replace('://mediafilez.', '://edge.');
  }
  const id = String(file.id || '');
  if (id.length < 5 || !file.fileName) return '';
  const head = String(parseInt(id.slice(0, 4), 10));
  const tail = String(parseInt(id.slice(4), 10));
  return 'https://edge.forgecdn.net/files/' + head + '/' + tail + '/' + encodeURIComponent(file.fileName);
}

function mapCurseForgeProject(project, projectType) {
  const logo = project.logo || {};
  const shot = (project.screenshots || [])[0] || {};
  return {
    id: String(project.id),
    slug: project.slug,
    title: project.name,
    author: (project.authors || []).map((a) => a.name).filter(Boolean).join(', '),
    description: project.summary || '',
    downloads: project.downloadCount || 0,
    iconUrl: logo.thumbnailUrl || logo.url || shot.thumbnailUrl || '',
    categories: (project.categories || []).map((c) => c.name),
    versions: [],
    projectType: projectType || 'mod',
    source: 'curseforge',
    webUrl: (project.links || {}).websiteUrl || ''
  };
}

async function curseForgeSearch(query, options = {}) {
  const projectType = options.projectType || 'mod';
  const params = {
    gameId: String(CURSEFORGE_GAME_ID),
    sortOrder: options.sortOrder || 'desc',
    pageSize: String(Math.min(50, Number(options.limit) || 20)),
    sortField: String(CURSEFORGE_SORT[options.sort || 'downloads'] || CURSEFORGE_SORT.popularity)
  };
  if (CURSEFORGE_CLASS[projectType]) params.classId = String(CURSEFORGE_CLASS[projectType]);
  if (options.gameVersion) params.gameVersion = options.gameVersion;
  if (options.categoryId) params.categoryId = String(options.categoryId);
  if (options.loader && CURSEFORGE_LOADER[options.loader]) params.modLoaderType = String(CURSEFORGE_LOADER[options.loader]);
  if (query) params.searchFilter = query;
  if (options.offset) params.index = String(options.offset);
  const data = await curseForgeGet('/mods/search', params, options);
  return (data.data || []).map((p) => mapCurseForgeProject(p, projectType));
}

/** 获取 CurseForge 项目文件列表（按发布时间倒序） */
async function curseForgeFiles(projectId, gameVersion, options = {}) {
  if (!projectId) throw new Error('缺少项目 ID');
  const params = { pageSize: '100' };
  if (gameVersion) params.gameVersion = gameVersion;
  if (options.loader && CURSEFORGE_LOADER[options.loader]) params.modLoaderType = String(CURSEFORGE_LOADER[options.loader]);
  const data = await curseForgeGet('/mods/' + encodeURIComponent(projectId) + '/files', params, options);
  return (data.data || []).map((f) => ({
    id: String(f.id),
    name: f.displayName || f.fileName,
    versionNumber: f.displayName || f.fileName,
    gameVersions: f.gameVersions || [],
    loaders: f.modLoader ? [f.modLoader] : [],
    fileName: f.fileName,
    fileUrl: curseForgeFileUrl(f),
    fileSize: f.fileSize || 0,
    datePublished: f.fileDate,
    releaseType: f.releaseType,
    source: 'curseforge'
  })).sort((a, b) => String(b.datePublished).localeCompare(String(a.datePublished)));
}

/** 按来源聚合搜索：Modrinth + CurseForge，CurseForge 失败时自动回退到 Modrinth */
async function searchProjects(query, options = {}) {
  const source = options.source || 'curseforge';
  if (source === 'modrinth') return modrinthSearch(query, options);
  try {
    return await curseForgeSearch(query, options);
  } catch (err) {
    // CurseForge 默认 Key 可能失效（403），自动回退到 Modrinth，
    // 避免用户看到空白结果。world 类型在 Modrinth 无原生分类，
    // 会走全库搜索作为兜底。
    const msg = (err && err.message) || String(err);
    if (/403|401|invalid|missing/i.test(msg)) {
      const fallbackOpts = Object.assign({}, options, { source: 'modrinth' });
      const results = await modrinthSearch(query, fallbackOpts);
      return results.map((r) => Object.assign({}, r, { source: 'modrinth' }));
    }
    throw err;
  }
}

/** 按来源取项目的可下载文件 */
async function projectFiles(source, projectId, gameVersion, options = {}) {
  if (source === 'modrinth') return modrinthVersions(projectId, gameVersion, options);
  return curseForgeFiles(projectId, gameVersion, options);
}


const PROJECT_TYPE_DIRS = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
  world: 'saves',
  modpack: 'modpacks'
};

/** 安装项目文件到对应目录（模组 / 资源包 / 光影 / 数据包） */
async function installMod(modVersion, gameDir, options = {}) {
  if (!modVersion || !modVersion.fileUrl || !modVersion.fileName) throw new Error('文件信息不完整');
  const type = options.projectType || modVersion.projectType || 'mod';
  const dirName = PROJECT_TYPE_DIRS[type] || 'mods';
  const targetDir = path.join(gameDir, dirName);
  await ensureDir(targetDir);
  const dest = path.join(targetDir, path.basename(modVersion.fileName));
  const result = await downloadFile(modVersion.fileUrl, dest, {
    onProgress: options.onProgress,
    fetchImpl: options.fetchImpl
  });
  return { path: dest, size: result.bytes, type };
}

/** 列出已安装的模组 / 资源包 / 光影 / 数据包 */
function listInstalledMods(gameDir, type) {
  const dirName = PROJECT_TYPE_DIRS[type || 'mod'] || 'mods';
  const targetDir = path.join(gameDir, dirName);
  if (!isDirectory(targetDir)) return [];
  return fs.readdirSync(targetDir)
    .filter((f) => /\.(jar|zip)$/i.test(f))
    .map((f) => {
      const full = path.join(targetDir, f);
      const st = fs.statSync(full);
      return { name: f, size: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

module.exports = {
  isDirectory,
  normalizeGameDir,
  instanceDir,
  isValidGameDir,
  listVersionsIn,
  candidateDirs,
  scanMinecraftDirs,
  cleanJunk,
  getLaunchCount,
  incrementLaunchCount,
  createShortcut,
  downloadFile,
  downloadSkin,
  modrinthSearch,
  modrinthVersions,
  curseForgeSearch,
  curseForgeFiles,
  curseForgeFileUrl,
  searchProjects,
  projectFiles,
  installMod,
  listInstalledMods
};
