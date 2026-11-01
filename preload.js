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

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (value) => ipcRenderer.invoke('settings:save', value),

  // 版本
  listInstalled: () => ipcRenderer.invoke('versions:installed'),
  listRemote: () => ipcRenderer.invoke('versions:list'),
  installVersion: (id) => ipcRenderer.invoke('versions:install', id),
  installFabric: (gameVersion, loaderVersion) => ipcRenderer.invoke('versions:installFabric', gameVersion, loaderVersion),
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
  checkUpdate: () => ipcRenderer.invoke('update:check'),
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

  // 模组
  searchMods: (query, gameVersion) => ipcRenderer.invoke('mods:search', query, gameVersion),
  getModVersions: (projectId, gameVersion) => ipcRenderer.invoke('mods:versions', projectId, gameVersion),
  installMod: (modVersion) => ipcRenderer.invoke('mods:install', modVersion),
  listInstalledMods: () => ipcRenderer.invoke('mods:list'),
  openModsDir: () => ipcRenderer.invoke('mods:openDir'),

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

  // 事件
  onLog: (handler) => on('app:log', handler),
  onGameLog: (handler) => on('game:log', handler),
  onGameState: (handler) => on('game:state', handler),
  onGameCrash: (handler) => on('game:crash', handler),
  onInstallProgress: (handler) => on('install:progress', handler),
  onUpdateProgress: (handler) => on('update:progress', handler),
  onDownloadProgress: (handler) => on('download:progress', handler)
});
