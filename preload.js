'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, handler) {
  const wrapped = (event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('bmcl', {
  // 基础
  info: () => ipcRenderer.invoke('app:info'),
  preflight: () => ipcRenderer.invoke('preflight'),
  getNotices: () => ipcRenderer.invoke('notices:fetch'),

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (value) => ipcRenderer.invoke('settings:save', value),

  // 版本
  listInstalled: () => ipcRenderer.invoke('versions:installed'),
  deleteVersion: (id) => ipcRenderer.invoke('versions:delete', id),
  listSaves: () => ipcRenderer.invoke('saves:list'),
  listRemote: () => ipcRenderer.invoke('versions:list'),
  installVersion: (id) => ipcRenderer.invoke('versions:install', id),
  installFabric: (gameVersion, loaderVersion) => ipcRenderer.invoke('versions:installFabric', gameVersion, loaderVersion),
  installForge: (gameVersion, loader, loaderVersion) => ipcRenderer.invoke('versions:installForge', gameVersion, loader, loaderVersion),
  installOptifine: (gameVersion, loaderVersion) => ipcRenderer.invoke('versions:installOptifine', gameVersion, loaderVersion),
  listForgeLoaders: (gameVersion, loader) => ipcRenderer.invoke('forge:loaders', gameVersion, loader),
  listOptifineLoaders: (gameVersion) => ipcRenderer.invoke('optifine:loaders', gameVersion),
  listFabricLoaders: (gameVersion) => ipcRenderer.invoke('fabric:loaders', gameVersion),

  // 游戏
  launch: (id) => ipcRenderer.invoke('game:launch', id),
  stop: () => ipcRenderer.invoke('game:stop'),
  openGameDir: () => ipcRenderer.invoke('game:openDir'),
  scanGameDirs: () => ipcRenderer.invoke('game:scanDirs'),
  setGameDir: (dir) => ipcRenderer.invoke('game:setDir', dir),
  rescanVersions: () => ipcRenderer.invoke('versions:rescan'),
  pickDirectory: (title) => ipcRenderer.invoke('dialog:pickDir', title),
  pickFile: (title) => ipcRenderer.invoke('dialog:pickFile', title),

  // 崩溃 / 网络 / 更新
  diagnoseCrash: () => ipcRenderer.invoke('crash:diagnose'),
  checkNetwork: () => ipcRenderer.invoke('net:check'),
  checkUpdate: (opts) => ipcRenderer.invoke('update:check', opts),
  applyUpdate: (release) => ipcRenderer.invoke('update:apply', release),

  // Java / 修复
  probeJava: (javaPath) => ipcRenderer.invoke('java:probe', javaPath),
  scanRepair: () => ipcRenderer.invoke('repair:scan'),
  runRepair: () => ipcRenderer.invoke('repair:run'),

  // 账号
  listAccounts: () => ipcRenderer.invoke('account:list'),
  getActiveAccount: () => ipcRenderer.invoke('account:active'),
  addAccount: (name) => ipcRenderer.invoke('account:add', name),
  removeAccount: (id) => ipcRenderer.invoke('account:remove', id),
  setActiveAccount: (id) => ipcRenderer.invoke('account:setActive', id),
  msLoginStart: () => ipcRenderer.invoke('account:msStart'),
  msLoginPoll: (flowId) => ipcRenderer.invoke('account:msPoll', flowId),
  msLoginCancel: (flowId) => ipcRenderer.invoke('account:msCancel', flowId),
  refreshAccount: (id) => ipcRenderer.invoke('account:refresh', id),
  uploadSkin: (variant) => ipcRenderer.invoke('account:skinUpload', variant),
  resetSkin: () => ipcRenderer.invoke('account:skinReset'),

  // 模组
  searchMods: (query, options) => ipcRenderer.invoke('mods:search', query, options),
  getModVersions: (source, projectId, gameVersion) => ipcRenderer.invoke('mods:versions', source, projectId, gameVersion),
  installMod: (modVersion, projectType) => ipcRenderer.invoke('mods:install', modVersion, projectType),
  listInstalledMods: (type) => ipcRenderer.invoke('mods:list', type),
  openModsDir: (type) => ipcRenderer.invoke('mods:openDir', type),

  // 陶瓦联机
  onlineJoin: (code) => ipcRenderer.invoke('online:join', code),
  onlineHost: (port) => ipcRenderer.invoke('online:host', port),
  onlineStop: () => ipcRenderer.invoke('online:stop'),
  onlineStatus: () => ipcRenderer.invoke('online:status'),

  // 工具
  cleanJunk: () => ipcRenderer.invoke('tools:cleanJunk'),
  getLaunchCount: () => ipcRenderer.invoke('tools:launchCount'),
  createShortcut: () => ipcRenderer.invoke('tools:createShortcut'),

  // 通用下载
  downloadFile: (url, destDir, fileName) => ipcRenderer.invoke('download:file', url, destDir, fileName),
  downloadSkin: (playerName) => ipcRenderer.invoke('download:skin', playerName),

  // 系统
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  openPath: (target) => ipcRenderer.invoke('shell:openPath', target),
  winMinimize: () => ipcRenderer.invoke('window:minimize'),
  winMaximize: () => ipcRenderer.invoke('window:maximize'),
  winClose: () => ipcRenderer.invoke('window:close'),

  // ===== 2.3.0 =====
  javaList: () => ipcRenderer.invoke('java:list'),
  javaPickDirs: () => ipcRenderer.invoke('java:pickDirs'),
  javaScanDir: (dir) => ipcRenderer.invoke('java:scanDir', dir),
  javaRescan: () => ipcRenderer.invoke('java:rescan'),
  javaRemoveDir: (dir) => ipcRenderer.invoke('java:removeDir', dir),
  javaSetDefault: (path) => ipcRenderer.invoke('java:setDefault', path),

  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  aiCrash: (payload) => ipcRenderer.invoke('ai:crash', payload),

  musicSearch: (keyword, page) => ipcRenderer.invoke('music:search', keyword, page),
  musicResolve: (bvid) => ipcRenderer.invoke('music:resolve', bvid),

  themePresets: () => ipcRenderer.invoke('theme:presets'),
  pickWallpaper: () => ipcRenderer.invoke('wallpaper:pick'),
  clearWallpaper: () => ipcRenderer.invoke('wallpaper:clear'),

  skinHistory: () => ipcRenderer.invoke('skin:history'),
  removeSkinHistory: (id) => ipcRenderer.invoke('skin:removeHistory', id),
  applySkinHistory: (id, variant) => ipcRenderer.invoke('skin:applyHistory', id, variant),
  skinCapes: () => ipcRenderer.invoke('skin:capes'),
  setCape: (capeId) => ipcRenderer.invoke('skin:setCape', capeId),
  clearCape: () => ipcRenderer.invoke('skin:clearCape'),
  skinCurrentFile: () => ipcRenderer.invoke('skin:currentFile'),

  // 事件
  onLog: (handler) => on('app:log', handler),
  onGameLog: (handler) => on('game:log', handler),
  onGameState: (handler) => on('game:state', handler),
  onGameCrash: (handler) => on('game:crash', handler),
  onInstallProgress: (handler) => on('install:progress', handler),
  onUpdateProgress: (handler) => on('update:progress', handler),
  onDownloadProgress: (handler) => on('download:progress', handler),
  onOnlineStatus: (handler) => on('online:status', handler)
});
