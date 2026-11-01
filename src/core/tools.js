'use strict';

/**
 * 工具模块：清理垃圾、启动计数、快捷方式、皮肤下载、通用文件下载、Modrinth 模组。
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');

function ensureDir(dir) {
  return fsp.mkdir(dir, { recursive: true });
}

/** 清理游戏垃圾：logs 目录、crash-reports、temp、过时的 .part 文件 */
async function cleanJunk(gameDir) {
  const targets = [];
  const candidates = [
    path.join(gameDir, 'logs'),
    path.join(gameDir, 'crash-reports'),
    path.join(gameDir, 'temp'),
    path.join(gameDir, 'versions')
  ];
  let freed = 0;
  let removed = 0;
  const errors = [];

  // logs / crash-reports / temp 目录整体清空但保留目录
  for (const dir of [path.join(gameDir, 'logs'), path.join(gameDir, 'crash-reports'), path.join(gameDir, 'temp')]) {
    if (!fs.existsSync(dir)) continue;
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
        } catch (e) { errors.push(full); }
      }
    } catch (e) { errors.push(dir); }
  }

  // 所有 .part 临时下载文件
  async function walkPart(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of await fsp.readdir(dir)) {
      const full = path.join(dir, entry);
      let st;
      try { st = await fsp.stat(full); } catch { continue; }
      if (st.isDirectory()) {
        await walkPart(full);
      } else if (entry.endsWith('.part')) {
        try { freed += st.size; await fsp.rm(full, { force: true }); removed++; } catch (e) { errors.push(full); }
      }
    }
  }
  if (fs.existsSync(gameDir)) await walkPart(gameDir);

  return { freed, removed, errors: errors.length };
}

/** 启动计数：读取并递增 */
function launchCountFile(userDataDir) {
  return path.join(userDataDir, 'launch-count.json');
}
function getLaunchCount(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(launchCountFile(userDataDir), 'utf8')).count || 0;
  } catch (e) { return 0; }
}
function incrementLaunchCount(userDataDir) {
  const file = launchCountFile(userDataDir);
  let count = 0;
  try { count = JSON.parse(fs.readFileSync(file, 'utf8')).count || 0; } catch (e) {}
  count++;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ count }, null, 2), 'utf8');
  return count;
}

/** 创建桌面快捷方式（Windows .url / Linux .desktop） */
async function createShortcut(appDir, exePath) {
  const desktop = path.join(os.homedir(), 'Desktop');
  if (!fs.existsSync(desktop)) throw new Error('找不到桌面目录');
  const name = 'BMCL';
  if (process.platform === 'win32') {
    const target = exePath || process.execPath;
    const url = path.join(desktop, name + '.lnk');
    // 使用 WSH 创建快捷方式
    const script = `Set WshShell = CreateObject("WScript.Shell")
Set oShellLink = WshShell.CreateShortcut("${url.replace(/\\/g, '\\\\')}")
oShellLink.TargetPath = "${target.replace(/\\/g, '\\\\')}"
oShellLink.WorkingDirectory = "${path.dirname(target).replace(/\\/g, '\\\\')}"
oShellLink.IconLocation = "${path.join(appDir, 'build', 'icon.ico').replace(/\\/g, '\\\\')}"
oShellLink.Description = "BMCL 启动器"
oShellLink.Save`;
    const vbs = path.join(os.tmpdir(), 'bmcl-shortcut.vbs');
    fs.writeFileSync(vbs, script, 'utf8');
    await new Promise((resolve, reject) => {
      require('node:child_process').execFile('cscript.exe', ['//nologo', vbs], (err) => err ? reject(err) : resolve());
    });
    return { path: url };
  } else {
    const target = exePath || process.execPath;
    const desktopFile = path.join(desktop, name + '.desktop');
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
}

/** 通用文件下载（带进度回调） */
async function downloadFile(url, destPath, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const onProgress = options.onProgress || function () {};
  await ensureDir(path.dirname(destPath));
  const res = await fetchImpl(url, { headers: options.headers || {} });
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress({ received, total });
  }
  const buf = Buffer.concat(chunks);
  const tmp = destPath + '.part';
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, destPath);
  return { bytes: buf.length, total };
}

/** 下载玩家皮肤到本地 */
async function downloadSkin(playerName, destPath) {
  const url = 'https://mc-heads.net/skin/' + encodeURIComponent(playerName);
  return downloadFile(url, destPath);
}

// ===== Modrinth 模组 =====
const MODRINTH_API = 'https://api.modrinth.com/v2';

async function modrinthSearch(query, options = {}) {
  const params = new URLSearchParams({
    query: query || '',
    facets: JSON.stringify([['project_type:mod']]),
    limit: String(options.limit || 20),
    offset: String(options.offset || 0)
  });
  if (options.gameVersion) params.set('facets', JSON.stringify([['project_type:mod'], ['versions:' + options.gameVersion]]));
  const res = await fetch(MODRINTH_API + '/search?' + params.toString(), {
    headers: { 'User-Agent': 'fft1145-bmcl/1.0' }
  });
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
    latestVersion: h.latest_version,
    versions: h.versions || [],
    categories: h.categories || []
  }));
}

/** 获取某个模组在指定游戏版本下的文件 */
async function modrinthVersions(projectId, gameVersion) {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  params.set('loaders', JSON.stringify(['fabric', 'forge', 'quilt', 'neoforge']));
  const res = await fetch(MODRINTH_API + '/project/' + projectId + '/version?' + params.toString(), {
    headers: { 'User-Agent': 'fft1145-bmcl/1.0' }
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
      fileSize: file && file.size,
      datePublished: v.date_published
    };
  });
}

/** 安装模组到 mods 目录 */
async function installMod(modVersion, gameDir, options = {}) {
  const modsDir = path.join(gameDir, 'mods');
  await ensureDir(modsDir);
  const dest = path.join(modsDir, modVersion.fileName);
  await downloadFile(modVersion.fileUrl, dest, { onProgress: options.onProgress });
  return { path: dest, size: modVersion.fileSize };
}

/** 列出已安装模组 */
function listInstalledMods(gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  if (!fs.existsSync(modsDir)) return [];
  return fs.readdirSync(modsDir)
    .filter((f) => /\.(jar|zip)$/i.test(f))
    .map((f) => {
      const full = path.join(modsDir, f);
      const st = fs.statSync(full);
      return { name: f, size: st.size, modifiedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** 扫描常见 Minecraft 安装目录 */
function scanMinecraftDirs() {
  const found = [];
  const pushIf = (dir, label) => {
    if (dir && fs.existsSync(path.join(dir, 'versions'))) {
      found.push({ path: dir, label });
    }
  };
  if (process.platform === 'win32') {
    pushIf(path.join(process.env.APPDATA || '', '.minecraft'), '官方启动器（.minecraft）');
    pushIf(path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', '.minecraft'), '官方启动器（.minecraft）');
    const prism = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'PrismLauncher');
    pushIf(path.join(prism, 'instances'), 'PrismLauncher');
    const mmc = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'MultiMC');
    pushIf(path.join(mmc, 'instances'), 'MultiMC');
  } else {
    pushIf(path.join(os.homedir(), '.minecraft'), '官方启动器（.minecraft）');
    pushIf(path.join(os.homedir(), '.local', 'share', 'PrismLauncher', 'instances'), 'PrismLauncher');
  }
  return found;
}

module.exports = {
  cleanJunk,
  getLaunchCount,
  incrementLaunchCount,
  createShortcut,
  downloadFile,
  downloadSkin,
  modrinthSearch,
  modrinthVersions,
  installMod,
  listInstalledMods,
  scanMinecraftDirs
};
