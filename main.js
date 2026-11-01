'use strict';

/**
 * BMCL 启动器主进程。
 * 所有业务逻辑放在 src/core 下的纯模块，这里只负责窗口、IPC 与进程管理。
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const { spawn, execFile } = require('node:child_process');

const settingsCore = require('./src/core/settings');
const vm = require('./src/core/version-manifest');
const installer = require('./src/core/installer');
const launcherCore = require('./src/core/launcher');
const updater = require('./src/core/updater');
const crashGuard = require('./src/core/crash-guard');
const javaCore = require('./src/core/java');
const repairCore = require('./src/core/repair');
const tools = require('./src/core/tools');
const accounts = require('./src/core/accounts');

const APP_NAME = 'fft1145';
const APP_VERSION = require('./package.json').version;
const WEBSITE = 'https://bmcl26.netlify.app';

let win = null;
let gameProcess = null;

function userData() {
  return app.getPath('userData');
}
function settingsFile() {
  return path.join(userData(), 'settings.json');
}
function sessionFile() {
  return path.join(userData(), 'session.json');
}

function getSettings() {
  const s = settingsCore.load(settingsFile());
  // 已保存的游戏目录若不再可用（被删除/移动/本身为空壳），重新检测
  if (!s.gameDir || !tools.isValidGameDir(s.gameDir)) {
    const found = tools.scanMinecraftDirs({ extra: s.extraGameDirs || [] });
    if (found.length) {
      s.gameDir = found[0].path;
    } else if (!s.gameDir) {
      s.gameDir = path.join(userData(), 'game');
    }
  }
  return s;
}

function dataDirs() {
  const s = getSettings();
  const gameDir = s.gameDir;
  return {
    gameDir,
    versionsDir: path.join(gameDir, 'versions'),
    librariesDir: path.join(gameDir, 'libraries'),
    assetsDir: path.join(gameDir, 'assets'),
    nativesBase: path.join(gameDir, 'natives')
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function log(message, level) {
  send('app:log', { message, level: level || 'info', time: new Date().toISOString() });
}

function extractZip(zipFile, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    if (process.platform === 'win32') {
      const cmd =
        "Expand-Archive -LiteralPath '" + String(zipFile).replace(/'/g, "''") +
        "' -DestinationPath '" + String(destDir).replace(/'/g, "''") + "' -Force";
      execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { timeout: 120000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    } else {
      execFile('unzip', ['-o', zipFile, '-d', destDir], { timeout: 120000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    }
  });
}

async function installedVersions() {
  const s = getSettings();
  return gameDirState(s);
}

function gameDirState(s) {
  const versions = tools.listVersionsIn(s.gameDir);
  return {
    gameDir: s.gameDir,
    valid: tools.isValidGameDir(s.gameDir),
    versions,
    candidates: tools.scanMinecraftDirs({ extra: s.extraGameDirs || [] })
  };
}

/**
 * 递归解析 inheritsFrom 版本链，并合并成可直接启动的完整 version json。
 * 返回 { json, levels, clientJar, nativesDir }
 */
function resolveVersionChain(versionsDir, versionId) {
  const levels = [];
  const seen = new Set();
  let id = versionId;
  let merged = null;
  while (id) {
    if (seen.has(id)) throw new Error('版本继承出现循环：' + id);
    seen.add(id);
    const dir = path.join(versionsDir, id);
    const file = path.join(dir, id + '.json');
    if (!fs.existsSync(file)) {
      throw new Error(id === versionId
        ? '版本 ' + id + ' 未安装，请先在「下载」页安装'
        : '缺少父版本 ' + id + '，请先安装它');
    }
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    levels.push({ id, dir, json });
    merged = merged ? launcherCore.mergeVersionJson(json, merged) : json;
    id = typeof json.inheritsFrom === 'string' ? json.inheritsFrom.trim() : '';
  }
  let clientJar = '';
  for (const level of levels) {
    const candidate = path.join(level.dir, level.id + '.jar');
    if (fs.existsSync(candidate)) {
      clientJar = candidate;
      break;
    }
  }
  return { json: merged, levels, clientJar };
}

async function fetchJson(url, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs || 20000) : null;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'fft1145-bmcl-launcher' },
      signal: controller ? controller.signal : undefined
    });
    if (!res.ok) throw new Error('请求失败 HTTP ' + res.status + ' · ' + url);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 安装 Fabric（原版 + Loader 继承），对应 PCL 下载页的「安装包 → Fabric」 */
async function installFabric(gameVersion, loaderVersion) {
  const dirs = dataDirs();
  const game = String(gameVersion || '').trim();
  if (!game) throw new Error('请先选择要安装 Fabric 的游戏版本');
  const baseFile = path.join(dirs.versionsDir, game, game + '.json');
  if (!fs.existsSync(baseFile)) {
    log('Fabric 需要先安装原版 ' + game + '，正在安装…');
    await installVersion(game);
  }
  let loader = String(loaderVersion || '').trim();
  if (!loader) {
    send('install:progress', { stage: '获取 Fabric Loader 版本', done: 0, total: 0 });
    const list = await fetchJson('https://meta.fabricmc.net/v2/versions/loader/' + encodeURIComponent(game));
    if (!Array.isArray(list) || !list.length) throw new Error('Fabric 暂不支持游戏版本 ' + game);
    const stable = list.find((item) => item && item.loader && item.loader.stable);
    loader = ((stable || list[0]).loader || {}).version || '';
  }
  if (!loader) throw new Error('没有找到可用的 Fabric Loader 版本');
  send('install:progress', { stage: '下载 Fabric 配置', done: 0, total: 0 });
  const profile = await fetchJson(
    'https://meta.fabricmc.net/v2/versions/loader/' + encodeURIComponent(game) + '/' + encodeURIComponent(loader) + '/profile/json'
  );
  const id = game + '-Fabric ' + loader;
  profile.id = id;
  profile.inheritsFrom = game;
  const versionDir = path.join(dirs.versionsDir, id);
  await fsp.mkdir(versionDir, { recursive: true });
  await fsp.writeFile(path.join(versionDir, id + '.json'), JSON.stringify(profile, null, 2));

  const plan = installer.buildDownloadPlan(profile, {
    versionsDir: dirs.versionsDir,
    librariesDir: dirs.librariesDir,
    assetsDir: dirs.assetsDir,
    source: getSettings().source,
    versionId: id
  });
  send('install:progress', { stage: '下载 Fabric 运行库', done: 0, total: plan.files.length });
  const result = await installer.runPlan(plan, {
    concurrency: 6,
    retry: 3,
    onProgress: (p) => send('install:progress', { stage: '下载 Fabric 运行库', done: p.done, total: p.total, failed: p.failed })
  });
  if (result.failed > 0) {
    throw new Error('有 ' + result.failed + ' 个 Fabric 运行库下载失败：' + ((result.errors[0] || {}).message || ''));
  }
  settingsCore.save(settingsFile(), Object.assign(getSettings(), { versionId: id }));
  send('install:progress', { stage: '完成', done: 1, total: 1 });
  log('Fabric ' + loader + ' 安装完成（基于 ' + game + '）', 'ok');
  return { versionId: id, loaderVersion: loader, files: plan.files.length };
}

async function installVersion(versionId) {
  const s = getSettings();
  const dirs = dataDirs();
  send('install:progress', { stage: '获取版本清单', done: 0, total: 0 });
  const manifest = await vm.fetchManifest({ source: s.source });
  const version = vm.findVersion(manifest, versionId);
  if (!version) throw new Error('版本清单中没有 ' + versionId);
  send('install:progress', { stage: '下载版本描述文件', done: 0, total: 0 });
  const json = await vm.fetchVersionJson(version, { source: s.source });

  const versionDir = path.join(dirs.versionsDir, versionId);
  await fsp.mkdir(versionDir, { recursive: true });
  await fsp.writeFile(path.join(versionDir, versionId + '.json'), JSON.stringify(json, null, 2));

  const plan = installer.buildDownloadPlan(json, {
    versionsDir: dirs.versionsDir,
    librariesDir: dirs.librariesDir,
    assetsDir: dirs.assetsDir,
    source: s.source,
    versionId
  });
  send('install:progress', { stage: '下载核心文件', done: 0, total: plan.files.length });
  const result = await installer.runPlan(plan, {
    concurrency: 6,
    onProgress: (p) => send('install:progress', { stage: '下载核心文件', done: p.done, total: p.total, failed: p.failed })
  });
  if (result.failed > 0) {
    throw new Error('有 ' + result.failed + ' 个文件下载失败：' + (result.errors[0] || {}).message);
  }

  for (const native of plan.natives) {
    if (fs.existsSync(native.path)) {
      send('install:progress', { stage: '解压运行库', done: 0, total: plan.natives.length });
      await extractZip(native.path, native.dest);
    }
  }

  if (json.assetIndex) {
    const indexFile = path.join(dirs.assetsDir, 'indexes', json.assetIndex.id + '.json');
    if (fs.existsSync(indexFile)) {
      const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      const assetPlan = installer.buildAssetPlan(index, { assetsDir: dirs.assetsDir, source: s.source });
      send('install:progress', { stage: '下载游戏资源 (' + assetPlan.files.length + ' 个)', done: 0, total: assetPlan.files.length });
      const assetResult = await installer.runPlan(assetPlan, {
        concurrency: 8,
        retry: 2,
        onProgress: (p) => send('install:progress', { stage: '下载游戏资源', done: p.done, total: p.total, failed: p.failed })
      });
      if (assetResult.failed > 0) log('部分资源文件下载失败，可稍后重试', 'warn');
    }
  }

  send('install:progress', { stage: '完成', done: 1, total: 1 });
  // 安装成功后自动把该版本设为当前实例，避免「装好了却启动不了」
  settingsCore.save(settingsFile(), Object.assign(getSettings(), { versionId }));
  log('版本 ' + versionId + ' 安装完成', 'ok');
  return { versionId, files: plan.files.length };
}

async function launchGame(versionId) {
  if (gameProcess) throw new Error('游戏已经在运行中');
  const s = getSettings();
  const dirs = dataDirs();
  // 没有指定版本时，退回到设置里的版本；再退回到第一个已安装版本
  let id = versionId || s.versionId;
  if (!id || !fs.existsSync(path.join(dirs.versionsDir, id, id + '.json'))) {
    const first = tools.listVersionsIn(dirs.gameDir)[0];
    id = first ? first.id : '';
  }
  if (!id) throw new Error('没有可启动的游戏版本。请先到「下载」页安装，或在「管理」里指定已有的游戏目录');
  if (id !== s.versionId) {
    settingsCore.save(settingsFile(), Object.assign(s, { versionId: id }));
  }
  const versionDir = path.join(dirs.versionsDir, id);
  versionId = id;
  const chain = resolveVersionChain(dirs.versionsDir, id);
  const json = chain.json;
  if (!json.libraries || !json.libraries.length) throw new Error('版本 ' + id + ' 的 json 不完整，请重新安装');

  const javaProbe = await javaCore.probeJava(s.javaPath || 'java');
  if (!javaProbe.ok) {
    throw new Error('没有找到可用的 Java。请在「设置」里填写 java.exe 的路径（' + javaProbe.message + '）');
  }
  const activeAccount = accounts.getActiveAccount(userData());
  const playerName = (activeAccount && activeAccount.name) || (s.playerName || '').trim() || 'Player';
  const uuid = (activeAccount && activeAccount.uuid) || launcherCore.offlineUuid(playerName);
  const ctx = { os: require('./src/core/rules').detectContext().os, features: {} };
  const libraryPaths = launcherCore.collectLibraryPaths(json, dirs.librariesDir, ctx);
  const clientJar = chain.clientJar || path.join(versionDir, versionId + '.jar');
  let nativesDir = '';
  for (const level of chain.levels) {
    const candidate = path.join(level.dir, 'natives');
    if (fs.existsSync(candidate) && fs.readdirSync(candidate).length) { nativesDir = candidate; break; }
  }
  if (!nativesDir) {
    nativesDir = path.join(versionDir, 'natives');
    fs.mkdirSync(nativesDir, { recursive: true });
  }
  if (!fs.existsSync(clientJar)) {
    throw new Error('找不到 ' + versionId + ' 的核心 jar（' + clientJar + '）。请重新安装该版本。');
  }

  const classpath = launcherCore.buildClasspath(libraryPaths, clientJar);
  const cmd = launcherCore.buildCommand({
    versionJson: json,
    versionId,
    playerName,
    uuid,
    accessToken: '0',
    gameDir: dirs.gameDir,
    assetsDir: dirs.assetsDir,
    assetIndexId: json.assetIndex && json.assetIndex.id,
    classpath,
    nativesDir,
    memoryMB: s.memoryMB,
    javaPath: javaProbe.javaPath,
    launcherName: APP_NAME,
    launcherVersion: APP_VERSION
  });

  const logsDir = path.join(dirs.gameDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, 'latest.log');
  fs.writeFileSync(logFile, '', 'utf8');

  log('启动命令：' + cmd.javaPath + ' ' + cmd.args.slice(0, 6).join(' ') + ' …');
  gameProcess = spawn(cmd.javaPath, cmd.args, {
    cwd: dirs.gameDir,
    windowsHide: true,
    env: Object.assign({}, process.env)
  });
  send('game:state', { running: true, versionId });
  const count = tools.incrementLaunchCount(userData());
  log('启动计数：' + count);

  const append = (chunk) => {
    const text = chunk.toString();
    fs.appendFile(logFile, text, () => {});
    send('game:log', { text });
  };
  gameProcess.stdout.on('data', append);
  gameProcess.stderr.on('data', append);

  gameProcess.on('error', (err) => {
    send('game:state', { running: false, versionId });
    send('game:crash', { summary: '无法启动 Java：' + err.message, causes: [] });
    gameProcess = null;
  });

  gameProcess.on('exit', (code) => {
    const proc = gameProcess;
    gameProcess = null;
    send('game:state', { running: false, versionId, code });
    if (code !== 0 && code !== null) {
      const report = crashGuard.diagnoseGameDir(dirs.gameDir, { exitCode: code });
      send('game:crash', report);
      log('游戏异常退出（代码 ' + code + '）：' + report.summary, 'error');
    } else {
      log('游戏已正常退出', 'ok');
    }
  });

  return { pid: gameProcess.pid };
}

function stopGame() {
  if (!gameProcess) return { stopped: false };
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(gameProcess.pid), '/f']);
    } else {
      gameProcess.kill('SIGTERM');
    }
  } catch (e) {
    /* ignore */
  }
  return { stopped: true };
}

async function selfCheck() {
  const checks = [];
  const root = app.getAppPath();
  for (const rel of ['main.js', 'preload.js', 'src/core/launcher.js', 'renderer/index.html']) {
    checks.push({ name: rel, ok: fs.existsSync(path.join(root, rel)) });
  }
  try {
    const probe = path.join(userData(), '.write-test');
    fs.mkdirSync(userData(), { recursive: true });
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    checks.push({ name: '数据目录可写', ok: true });
  } catch (e) {
    checks.push({ name: '数据目录可写', ok: false });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

function repairContext() {
  const s = getSettings();
  return {
    userDataDir: userData(),
    appDir: app.getAppPath(),
    settingsFile: settingsFile(),
    sessionFile: sessionFile(),
    gameDir: s.gameDir,
    appFiles: ['main.js', 'preload.js', 'src/core/launcher.js', 'renderer/index.html']
  };
}

async function preflight() {
  const s = getSettings();
  const out = { settings: s, selfCheck: await selfCheck(), crash: null, download: null, update: null };
  if (s.crashWatch) {
    const previous = crashGuard.detectPreviousCrash(sessionFile());
    if (previous && previous.crashed) {
      out.crash = crashGuard.diagnoseGameDir(s.gameDir, {});
      out.crash.launcherCrashed = true;
      out.crash.startedAt = previous.startedAt;
    }
  }
  if (s.checkDownloads) {
    out.download = await updater.checkDownloadAllowed({});
  }
  if (s.autoUpdate && (!out.download || out.download.allowed)) {
    try {
      out.update = await updater.checkForUpdate({ currentVersion: APP_VERSION });
    } catch (e) {
      out.updateError = e.message;
    }
  }
  return out;
}

async function applyUpdate(release) {
  if (!release || !release.asset) throw new Error('该版本没有可下载的更新包');
  if (app.isPackaged || !/\.zip$/i.test(release.asset.name)) {
    // 打包后的 exe 无法原地替换，直接引导到发布页下载新版（永远指向最新 Release）
    await shell.openExternal(release.htmlUrl);
    return { redirected: true, url: release.htmlUrl };
  }
  const appDir = app.getAppPath();
  const tmpDir = path.join(userData(), 'update-tmp');
  await fsp.rm(tmpDir, { recursive: true, force: true });
  await fsp.mkdir(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, 'update.zip');
  log('正在下载更新包…');
  const res = await fetch(release.asset.url, { headers: { 'User-Agent': 'fft1145-bmcl-updater' } });
  if (!res.ok) throw new Error('更新包下载失败：HTTP ' + res.status);
  await fsp.writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
  const extractDir = path.join(tmpDir, 'extracted');
  await extractZip(zipPath, extractDir);
  const result = await updater.applyUpdateTree(extractDir, appDir, {
    onProgress: (p) => send('update:progress', p)
  });
  log('启动器已更新 ' + result.updated + ' 个文件（未触碰任何游戏文件）', 'ok');
  return { updated: result.updated };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#f3f6fa',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({ name: APP_NAME, version: APP_VERSION, website: WEBSITE, packaged: app.isPackaged }));
  ipcMain.handle('preflight', () => preflight());
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (e, value) => {
    const saved = settingsCore.save(settingsFile(), Object.assign(getSettings(), value || {}));
    return saved;
  });
  ipcMain.handle('versions:installed', () => installedVersions());
  ipcMain.handle('versions:rescan', () => gameDirState(getSettings()));
  ipcMain.handle('game:scanDirs', () => tools.scanMinecraftDirs({ extra: getSettings().extraGameDirs || [] }));
  ipcMain.handle('game:setDir', (e, dir) => {
    const value = String(dir || '').trim();
    if (!value) throw new Error('游戏目录不能为空');
    if (!tools.isDirectory(value)) throw new Error('目录不存在：' + value);
    const saved = settingsCore.save(settingsFile(), Object.assign(getSettings(), { gameDir: value }));
    return gameDirState(saved);
  });
  ipcMain.handle('dialog:pickDir', async (e, title) => {
    const result = await dialog.showOpenDialog(win, {
      title: title || '选择文件夹',
      properties: ['openDirectory']
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('dialog:pickFile', async (e, title) => {
    const result = await dialog.showOpenDialog(win, {
      title: title || '选择文件',
      properties: ['openFile']
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('versions:list', async () => {
    const s = getSettings();
    const manifest = await vm.fetchManifest({ source: s.source });
    return { source: manifest.source, latest: manifest.latest, versions: manifest.versions };
  });
  ipcMain.handle('versions:install', (e, versionId) => installVersion(versionId));
  ipcMain.handle('versions:installFabric', (e, gameVersion, loaderVersion) => installFabric(gameVersion, loaderVersion));
  ipcMain.handle('fabric:loaders', async (e, gameVersion) => {
    const game = String(gameVersion || '').trim();
    if (!game) return [];
    const list = await fetchJson('https://meta.fabricmc.net/v2/versions/loader/' + encodeURIComponent(game));
    return (Array.isArray(list) ? list : []).slice(0, 30).map((item) => ({
      version: (item.loader || {}).version || '',
      stable: Boolean((item.loader || {}).stable)
    })).filter((item) => item.version);
  });
  ipcMain.handle('game:launch', (e, versionId) => launchGame(versionId));
  ipcMain.handle('game:stop', () => stopGame());
  ipcMain.handle('game:openDir', () => {
    shell.openPath(dataDirs().gameDir);
    return dataDirs().gameDir;
  });
  ipcMain.handle('crash:diagnose', () => {
    const s = getSettings();
    return crashGuard.diagnoseGameDir(s.gameDir, {});
  });
  ipcMain.handle('net:check', () => updater.checkDownloadAllowed({}));
  ipcMain.handle('update:check', () => updater.checkForUpdate({ currentVersion: APP_VERSION }));
  ipcMain.handle('update:apply', (e, release) => applyUpdate(release));
  ipcMain.handle('java:probe', (e, javaPath) => javaCore.probeJava(javaPath || getSettings().javaPath || 'java'));
  ipcMain.handle('repair:scan', () => repairCore.scan(repairContext()));
  ipcMain.handle('repair:run', () => {
    const result = repairCore.repair(repairContext());
    log('一键修复完成：修复 ' + result.fixed + ' 项，失败 ' + result.failed + ' 项', result.failed ? 'warn' : 'ok');
    return result;
  });
  ipcMain.handle('shell:open', (e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url);
    return null;
  });
  ipcMain.handle('shell:openPath', (e, target) => {
    if (typeof target === 'string' && target) return shell.openPath(target);
    return null;
  });
  ipcMain.handle('window:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });
  ipcMain.handle('window:maximize', () => {
    if (!win || win.isDestroyed()) return false;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', () => { if (win && !win.isDestroyed()) win.close(); });

  // ===== 账号 =====
  ipcMain.handle('account:list', () => accounts.listAccounts(userData()));
  ipcMain.handle('account:active', () => accounts.getActiveAccount(userData()));
  ipcMain.handle('account:add', (e, name) => accounts.addOfflineAccount(userData(), name));
  ipcMain.handle('account:remove', (e, id) => accounts.removeAccount(userData(), id));
  ipcMain.handle('account:setActive', (e, id) => accounts.setActiveAccount(userData(), id));

  // ===== 游戏目录扫描 =====
  // （game:scanDirs / game:setDir / dialog:pick* 已在上面注册）

  // ===== 模组（Modrinth）=====
  ipcMain.handle('mods:search', (e, query, gameVersion) => tools.modrinthSearch(query, { gameVersion }));
  ipcMain.handle('mods:versions', (e, projectId, gameVersion) => tools.modrinthVersions(projectId, gameVersion));
  ipcMain.handle('mods:install', (e, modVersion) =>
    tools.installMod(modVersion, dataDirs().gameDir, { onProgress: (p) => send('download:progress', p) })
  );
  ipcMain.handle('mods:list', () => tools.listInstalledMods(dataDirs().gameDir));
  ipcMain.handle('mods:openDir', () => {
    const dir = path.join(dataDirs().gameDir, 'mods');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return dir;
  });

  // ===== 工具 =====
  ipcMain.handle('tools:cleanJunk', async () => tools.cleanJunk(dataDirs().gameDir));
  ipcMain.handle('tools:launchCount', () => tools.getLaunchCount(userData()));
  ipcMain.handle('tools:createShortcut', async () => {
    const exe = app.isPackaged ? process.execPath : null;
    return tools.createShortcut(app.getAppPath(), exe);
  });

  // ===== 通用下载（自定义文件 / 皮肤）=====
  ipcMain.handle('download:file', async (e, url, destDir, fileName) => {
    const name = fileName || path.basename(new URL(url).pathname) || 'download.bin';
    const dest = path.join(destDir || dataDirs().gameDir, name);
    return tools.downloadFile(url, dest, { onProgress: (p) => send('download:progress', p) });
  });
  ipcMain.handle('download:skin', async (e, playerName) => {
    const dest = path.join(dataDirs().gameDir, 'skins', playerName + '.png');
    return tools.downloadSkin(playerName, dest);
  });
}

app.whenReady().then(() => {
  crashGuard.markSessionStart(sessionFile(), { version: APP_VERSION });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (gameProcess) stopGame();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (gameProcess) stopGame();
  crashGuard.markSessionEnd(sessionFile());
});
