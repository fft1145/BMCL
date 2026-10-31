'use strict';

/**
 * BMCL 启动器主进程。
 * 所有业务逻辑放在 src/core 下的纯模块，这里只负责窗口、IPC 与进程管理。
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
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

const APP_NAME = 'fft1145';
const APP_VERSION = require('./package.json').version;
const WEBSITE = 'https://fgame12.netlify.app';

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
  if (!s.gameDir) s.gameDir = path.join(userData(), 'game');
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
  const dir = dataDirs().versionsDir;
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(dir, entry.name, entry.name + '.json');
    if (!fs.existsSync(jsonPath)) continue;
    let type = 'release';
    try { type = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).type || type; } catch (e) {}
    out.push({ id: entry.name, type, installedAt: fs.statSync(jsonPath).mtime.toISOString() });
  }
  return out.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
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
  log('版本 ' + versionId + ' 安装完成', 'ok');
  return { versionId, files: plan.files.length };
}

async function launchGame(versionId) {
  if (gameProcess) throw new Error('游戏已经在运行中');
  const s = getSettings();
  const dirs = dataDirs();
  const versionDir = path.join(dirs.versionsDir, versionId);
  const jsonFile = path.join(versionDir, versionId + '.json');
  if (!fs.existsSync(jsonFile)) throw new Error('版本未安装，请先在「版本 / 下载」页安装');
  const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

  const javaProbe = await javaCore.probeJava(s.javaPath || 'java');
  if (!javaProbe.ok) {
    throw new Error('没有找到可用的 Java。请在「设置」里填写 java.exe 的路径（' + javaProbe.message + '）');
  }
  const playerName = (s.playerName || '').trim() || 'Player';
  const uuid = launcherCore.offlineUuid(playerName);
  const ctx = { os: require('./src/core/rules').detectContext().os, features: {} };
  const libraryPaths = launcherCore.collectLibraryPaths(json, dirs.librariesDir, ctx);
  const clientJar = path.join(versionDir, versionId + '.jar');
  const nativesDir = path.join(versionDir, 'natives');
  fs.mkdirSync(nativesDir, { recursive: true });

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
  if (app.isPackaged) {
    // 打包后的 exe 无法原地替换，直接引导到发布页下载新版
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
    backgroundColor: '#141414',
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
  ipcMain.handle('versions:list', async () => {
    const s = getSettings();
    const manifest = await vm.fetchManifest({ source: s.source });
    return { source: manifest.source, latest: manifest.latest, versions: manifest.versions };
  });
  ipcMain.handle('versions:install', (e, versionId) => installVersion(versionId));
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
  ipcMain.handle('shell:open', (e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url);
    return null;
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
