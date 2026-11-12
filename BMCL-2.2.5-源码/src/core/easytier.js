'use strict';

/**
 * EasyTier 内核管理：陶瓦联机用它建立 P2P 虚拟网络。
 * 首次使用时会自动下载 Windows 版 EasyTier 到用户数据目录。
 */

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const https = require('node:https');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const terracotta = require('./terracotta');

const ET_VERSION = '2.6.4';
const ET_URL = 'https://github.com/EasyTier/EasyTier/releases/download/v' + ET_VERSION +
  '/easytier-windows-x86_64-v' + ET_VERSION + '.zip';

let baseDir = '';
let machineId = 'bmcl';
let child = null;
let state = { status: 'idle', mode: '', progress: 0, message: '', code: '', address: '', port: 0 };
const listeners = new Set();

function configure(options = {}) {
  baseDir = options.dir || baseDir;
  machineId = options.machineId || machineId;
}

function onStatus(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function emit(patch) {
  state = { ...state, ...patch };
  for (const handler of listeners) {
    try { handler(state); } catch { /* 忽略前端回调异常 */ }
  }
}

function findFile(dir, name) {
  if (!fs.existsSync(dir)) return '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return '';
}

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'BMCL' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 5) { reject(new Error('下载重定向次数过多')); return; }
        request(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('下载 EasyTier 失败（HTTP ' + res.statusCode + '）'));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('下载 EasyTier 超时，请检查网络')));
  });
}

async function download(url, dest) {
  const res = await request(url);
  const total = Number(res.headers['content-length'] || 0);
  let received = 0;
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    res.on('data', (chunk) => {
      received += chunk.length;
      if (total) emit({ status: 'preparing', progress: Math.min(99, Math.round(received / total * 100)) });
    });
    res.pipe(file);
    file.on('finish', () => file.close(resolve));
    file.on('error', reject);
    res.on('error', reject);
  });
}

function extract(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Expand-Archive -LiteralPath '" + zipPath.replace(/'/g, "''") + "' -DestinationPath '" +
        destDir.replace(/'/g, "''") + "' -Force"
    ], { timeout: 120000 }, (err) => {
      if (err) reject(new Error('解压 EasyTier 失败：' + err.message));
      else resolve();
    });
  });
}

async function ensureCore() {
  if (process.platform !== 'win32') {
    throw new Error('陶瓦联机目前仅支持 Windows');
  }
  const versionDir = path.join(baseDir, ET_VERSION);
  const existing = findFile(versionDir, 'easytier-core.exe');
  if (existing) return path.dirname(existing);

  await fsp.mkdir(versionDir, { recursive: true });
  const zipPath = path.join(versionDir, 'easytier.zip');
  emit({ status: 'preparing', progress: 0, message: '正在下载陶瓦联机组件（首次使用）…' });
  await download(ET_URL, zipPath);
  emit({ status: 'preparing', progress: 100, message: '正在解压陶瓦联机组件…' });
  await extract(zipPath, versionDir);
  await fsp.rm(zipPath, { force: true });

  const core = findFile(versionDir, 'easytier-core.exe');
  if (!core) throw new Error('EasyTier 解压后未找到 easytier-core.exe');
  return path.dirname(core);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function stop() {
  if (!child) {
    if (state.status !== 'idle') emit({ status: 'idle', mode: '', code: '', address: '', port: 0, message: '' });
    return;
  }
  const target = child;
  child = null;
  try { target.kill(); } catch { /* 进程可能已退出 */ }
  emit({ status: 'idle', mode: '', code: '', address: '', port: 0, progress: 0, message: '' });
}

function launch(args, dir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(path.join(dir, 'easytier-core.exe'), args, {
      cwd: dir,
      windowsHide: true
    });
    child = proc;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (child === proc) child = null;
      emit({ status: 'error', message: err.message });
      reject(err);
    };
    proc.on('error', fail);
    proc.stderr.on('data', (data) => {
      const text = String(data).trim();
      if (text) emit({ message: text.split('\n').slice(-1)[0] });
    });
    proc.on('exit', (code) => {
      if (!settled) {
        fail(new Error('EasyTier 已退出（代码 ' + code + '）'));
        return;
      }
      if (child === proc) {
        child = null;
        emit({ status: 'idle', mode: '', code: '', address: '', port: 0, message: '' });
      }
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, 1200);
  });
}

/** 加入陶瓦大厅，返回本地转发端口 */
async function join(room, username) {
  stop();
  emit({ status: 'preparing', mode: 'join', progress: 0, message: '正在准备陶瓦联机…' });
  const dir = await ensureCore();
  const localPort = await freePort();
  const rpcPort = await freePort();
  const args = terracotta.buildJoinArgs(room, localPort, rpcPort, username, machineId);
  await launch(args, dir);
  emit({
    status: 'running',
    mode: 'join',
    progress: 100,
    message: '已加入大厅',
    code: room.code,
    address: '127.0.0.1:' + localPort,
    port: localPort
  });
  return { code: room.code, address: '127.0.0.1:' + localPort, port: localPort };
}

/** 创建陶瓦大厅，返回房号与局域网端口 */
async function host(port, username) {
  stop();
  const networkName = terracotta.generateRoomCode(port);
  const decoded = terracotta.parseRoomCode(networkName);
  if (!decoded.ok) throw new Error('生成大厅编号失败');
  emit({ status: 'preparing', mode: 'host', progress: 0, message: '正在准备陶瓦联机…' });
  const dir = await ensureCore();
  const rpcPort = await freePort();
  const args = terracotta.buildHostArgs(port, decoded.networkName, decoded.networkSecret,
    rpcPort, username, machineId);
  await launch(args, dir);
  emit({
    status: 'running',
    mode: 'host',
    progress: 100,
    message: '大厅已创建',
    code: decoded.code,
    address: '10.144.144.1:' + port,
    port
  });
  return { code: decoded.code, address: '10.144.144.1:' + port, port };
}

module.exports = {
  configure,
  onStatus,
  getState: () => state,
  join,
  host,
  stop
};
