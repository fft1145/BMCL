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

/**
 * 判断一个目录是不是合法的 Minecraft 游戏目录。
 * 判据：存在 versions 子目录，且至少有一个 <name>/<name>.json。
 */
function isValidGameDir(dir) {
  if (!dir || typeof dir !== 'string') return false;
  const versionsDir = path.join(dir, 'versions');
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

/** 列出目录里可识别的版本 */
function listVersionsIn(dir) {
  const versionsDir = path.join(dir, 'versions');
  if (!isDirectory(versionsDir)) return [];
  const out = [];
  let entries;
  try { entries = fs.readdirSync(versionsDir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(versionsDir, entry.name, entry.name + '.json');
    if (!fs.existsSync(jsonPath)) continue;
    let type = 'release';
    let time = '';
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      type = data.type || type;
      time = data.releaseTime || data.time || '';
    } catch { /* 忽略损坏的 json */ }
    out.push({
      id: entry.name,
      type,
      time,
      installedAt: fs.statSync(jsonPath).mtime.toISOString()
    });
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
    const key = item.path.toLowerCase();
    if (seen.has(key)) continue;
    const versions = listVersionsIn(item.path);
    if (!versions.length) continue;
    seen.set(key, {
      path: item.path,
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

function modrinthFacets(projectType, gameVersion) {
  const facets = [['project_type:' + (projectType || 'mod')]];
  if (gameVersion) facets.push(['versions:' + gameVersion]);
  return JSON.stringify(facets);
}

async function modrinthSearch(query, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const params = new URLSearchParams({
    query: query || '',
    facets: modrinthFacets(options.projectType, options.gameVersion),
    limit: String(options.limit || 20),
    offset: String(options.offset || 0)
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
    versions: h.versions || []
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

/** 安装模组到 mods 目录 */
async function installMod(modVersion, gameDir, options = {}) {
  if (!modVersion || !modVersion.fileUrl || !modVersion.fileName) throw new Error('模组文件信息不完整');
  const modsDir = path.join(gameDir, 'mods');
  await ensureDir(modsDir);
  const dest = path.join(modsDir, modVersion.fileName);
  const result = await downloadFile(modVersion.fileUrl, dest, { onProgress: options.onProgress });
  return { path: dest, size: result.bytes };
}

/** 列出已安装模组 */
function listInstalledMods(gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  if (!isDirectory(modsDir)) return [];
  return fs.readdirSync(modsDir)
    .filter((f) => /\.(jar|zip)$/i.test(f))
    .map((f) => {
      const full = path.join(modsDir, f);
      const st = fs.statSync(full);
      return { name: f, size: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

module.exports = {
  isDirectory,
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
  installMod,
  listInstalledMods
};
