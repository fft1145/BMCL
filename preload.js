'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, handler) {
  const wrapped = (event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('bmcl', {
  info: () => ipcRenderer.invoke('app:info'),
  preflight: () => ipcRenderer.invoke('preflight'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (value) => ipcRenderer.invoke('settings:save', value),
  listInstalled: () => ipcRenderer.invoke('versions:installed'),
  listRemote: () => ipcRenderer.invoke('versions:list'),
  installVersion: (id) => ipcRenderer.invoke('versions:install', id),
  launch: (id) => ipcRenderer.invoke('game:launch', id),
  stop: () => ipcRenderer.invoke('game:stop'),
  openGameDir: () => ipcRenderer.invoke('game:openDir'),
  diagnoseCrash: () => ipcRenderer.invoke('crash:diagnose'),
  checkNetwork: () => ipcRenderer.invoke('net:check'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: (release) => ipcRenderer.invoke('update:apply', release),
  probeJava: (javaPath) => ipcRenderer.invoke('java:probe', javaPath),
  scanRepair: () => ipcRenderer.invoke('repair:scan'),
  runRepair: () => ipcRenderer.invoke('repair:run'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  winMinimize: () => ipcRenderer.invoke('window:minimize'),
  winMaximize: () => ipcRenderer.invoke('window:maximize'),
  winClose: () => ipcRenderer.invoke('window:close'),
  onLog: (handler) => on('app:log', handler),
  onGameLog: (handler) => on('game:log', handler),
  onGameState: (handler) => on('game:state', handler),
  onGameCrash: (handler) => on('game:crash', handler),
  onInstallProgress: (handler) => on('install:progress', handler),
  onUpdateProgress: (handler) => on('update:progress', handler)
});
