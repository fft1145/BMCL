'use strict';

/**
 * BMCL 访问管理后端（零依赖）。
 *
 * 启动：ADMIN_TOKEN=你的密码 node server/admin-server.js
 * 可选：PORT=8787、DATA_FILE=./data.json、TRUST_PROXY=1（部署在 Nginx/CDN 后面时）
 *
 * 接口：
 *   POST /visit       启动器上报启动，返回 {ip, banned, reason}
 *   GET  /bans        封禁列表（启动器会读取）
 *   GET  /admin       管理员网页
 *   POST /admin/api   {token, action: list|ban|unban, ip, reason}
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '');
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, 'data.json'));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

if (!ADMIN_TOKEN) {
  console.error('请先设置 ADMIN_TOKEN 环境变量，例如：ADMIN_TOKEN=换成你的密码 node server/admin-server.js');
  process.exit(1);
}

function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { visits: data.visits || {}, bans: data.bans || {} };
  } catch (e) {
    return { visits: {}, bans: {} };
  }
}

let data = loadData();

function saveData() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('保存数据失败：', e.message);
  }
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (real) return real;
  }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(text);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

function adminPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BMCL 访问管理</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.6 "Microsoft YaHei UI","Segoe UI",system-ui,sans-serif;background:#0f1115;color:#e8ecf1;padding:28px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:#8b97a8;margin-bottom:20px}
  .card{background:#171a21;border:1px solid #262c37;border-radius:12px;padding:16px;margin-bottom:18px}
  input,button{font:inherit;border-radius:8px;border:1px solid #2d3542;background:#11151b;color:#e8ecf1;padding:8px 10px}
  button{cursor:pointer;background:#2f6fed;border-color:#2f6fed;font-weight:600}
  button.ghost{background:transparent;border-color:#39424f;color:#9fb0c5}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #232a34;font-size:13px}
  th{color:#8b97a8;font-weight:600}
  .bad{color:#ff8a8a}
  .ok{color:#7ddc9a}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .muted{color:#7c8899;font-size:12px}
</style></head>
<body>
  <h1>BMCL 访问管理</h1>
  <div class="sub">记录每次启动的 IP，可禁止指定 IP 进入启动器并填写原因。</div>

  <div class="card" id="login">
    <div class="row">
      <input id="token" type="password" placeholder="管理员密码（ADMIN_TOKEN）" style="min-width:280px">
      <button id="btnLogin">登录</button>
    </div>
  </div>

  <div id="panel" style="display:none">
    <div class="card">
      <div class="row">
        <input id="banIp" placeholder="要禁止的 IP" style="min-width:200px">
        <input id="banReason" placeholder="禁止原因（会展示给用户）" style="min-width:260px">
        <button id="btnBan">禁止该 IP</button>
        <button class="ghost" id="btnRefresh">刷新</button>
      </div>
      <div class="muted" id="stats" style="margin-top:8px"></div>
    </div>
    <div class="card">
      <b>访问记录</b>
      <table><thead><tr><th>IP</th><th>次数</th><th>版本</th><th>系统</th><th>首次</th><th>最近</th><th>状态</th><th></th></tr></thead>
      <tbody id="visits"></tbody></table>
    </div>
    <div class="card">
      <b>已禁止的 IP</b>
      <table><thead><tr><th>IP</th><th>原因</th><th>时间</th><th></th></tr></thead>
      <tbody id="bans"></tbody></table>
    </div>
  </div>

<script>
let token = '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (t) => t ? new Date(t).toLocaleString() : '-';

async function api(action, extra) {
  const res = await fetch('/admin/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body: JSON.stringify(Object.assign({ action }, extra || {}))
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

async function refresh() {
  const data = await api('list');
  const bans = data.bans || {};
  $('stats').textContent = '共 ' + Object.keys(data.visits || {}).length + ' 个 IP，已禁止 ' + Object.keys(bans).length + ' 个';
  $('visits').innerHTML = Object.values(data.visits || {}).sort((a, b) => String(b.last).localeCompare(String(a.last))).map((v) =>
    '<tr><td>' + esc(v.ip) + '</td><td>' + v.count + '</td><td>' + esc(v.version) + '</td><td>' + esc(v.platform) + ' ' + esc(v.arch) + '</td>' +
    '<td>' + fmt(v.first) + '</td><td>' + fmt(v.last) + '</td>' +
    '<td>' + (bans[v.ip] ? '<span class="bad">已禁止</span>' : '<span class="ok">正常</span>') + '</td>' +
    '<td>' + (bans[v.ip] ? '<button class="ghost" data-unban="' + esc(v.ip) + '">解除</button>' : '<button class="ghost" data-ban="' + esc(v.ip) + '">禁止</button>') + '</td></tr>'
  ).join('') || '<tr><td colspan="8" class="muted">还没有访问记录</td></tr>';
  $('bans').innerHTML = Object.entries(bans).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).map(([ip, b]) =>
    '<tr><td>' + esc(ip) + '</td><td>' + esc(b.reason) + '</td><td>' + fmt(b.at) + '</td>' +
    '<td><button class="ghost" data-unban="' + esc(ip) + '">解除</button></td></tr>'
  ).join('') || '<tr><td colspan="4" class="muted">暂无封禁</td></tr>';
}

function bindTable() {
  document.querySelectorAll('[data-ban]').forEach((btn) => btn.onclick = async () => {
    const ip = btn.dataset.ban;
    const reason = prompt('禁止 ' + ip + ' 的原因：', '违反使用规则');
    if (reason === null) return;
    await api('ban', { ip, reason });
    refresh();
  });
  document.querySelectorAll('[data-unban]').forEach((btn) => btn.onclick = async () => {
    await api('unban', { ip: btn.dataset.unban });
    refresh();
  });
}

$('btnLogin').onclick = async () => {
  token = $('token').value.trim();
  try {
    await refresh();
    $('login').style.display = 'none';
    $('panel').style.display = 'block';
    observe();
  } catch (e) { alert('登录失败：' + e.message); }
};
$('btnRefresh').onclick = () => refresh().then(bindTable);
$('btnBan').onclick = async () => {
  const ip = $('banIp').value.trim();
  const reason = $('banReason').value.trim();
  if (!ip) return alert('请填写 IP');
  await api('ban', { ip, reason });
  $('banIp').value = ''; $('banReason').value = '';
  await refresh(); bindTable();
};

let observer = null;
function observe() {
  refresh().then(bindTable);
  if (observer) observer.disconnect();
  observer = new MutationObserver(() => { bindTable(); });
  observer.observe($('visits'), { childList: true });
  observer.observe($('bans'), { childList: true });
}
</script>
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (req.method === 'POST' && url.pathname === '/visit') {
    try {
      const body = await readBody(req);
      const ip = clientIp(req);
      const now = new Date().toISOString();
      const visit = data.visits[ip] || { ip, count: 0, first: now };
      visit.count += 1;
      visit.last = now;
      visit.version = String(body.version || '').slice(0, 32);
      visit.platform = String(body.platform || '').slice(0, 32);
      visit.arch = String(body.arch || '').slice(0, 16);
      data.visits[ip] = visit;
      saveData();
      const ban = data.bans[ip];
      return sendJson(res, 200, { ok: true, ip, banned: Boolean(ban), reason: ban ? ban.reason : '' });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/bans') {
    return sendJson(res, 200, { bans: data.bans });
  }

  if (req.method === 'GET' && url.pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(adminPage());
  }

  if (req.method === 'POST' && url.pathname === '/admin/api') {
    try {
      if (String(req.headers['x-admin-token'] || '') !== ADMIN_TOKEN) {
        return sendJson(res, 401, { error: '密码错误' });
      }
      const body = await readBody(req);
      const action = String(body.action || '');
      if (action === 'list') {
        return sendJson(res, 200, { visits: data.visits, bans: data.bans });
      }
      if (action === 'ban') {
        const ip = String(body.ip || '').trim();
        if (!ip) return sendJson(res, 400, { error: '缺少 IP' });
        data.bans[ip] = { reason: String(body.reason || '').slice(0, 200), at: new Date().toISOString() };
        saveData();
        return sendJson(res, 200, { ok: true });
      }
      if (action === 'unban') {
        const ip = String(body.ip || '').trim();
        delete data.bans[ip];
        saveData();
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 400, { error: '未知操作' });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, { ok: true, service: 'bmcl-admin', visits: Object.keys(data.visits).length });
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log('BMCL 管理后端已启动：http://' + (HOST === '0.0.0.0' ? os.hostname() : HOST) + ':' + PORT + '/admin');
  console.log('数据文件：' + DATA_FILE);
});
