'use strict';

(function () {
  const bmcl = window.bmcl;
  const $ = (sel) => document.querySelector(sel);
  const state = {
    info: null,
    settings: {},
    installed: [],
    gameState: { gameDir: '', valid: false, versions: [], candidates: [] },
    running: false,
    installing: false,
    preflight: null,
    remote: null,
    pendingUpdate: null,
    accounts: [],
    activeAccount: null,
    modResults: [],
    repair: null
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(message, type) {
    const wrap = $('#toastWrap');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s';
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  function showBanner(message, type) {
    const el = $('#banner');
    el.className = 'banner' + (type ? ' ' + type : '');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function switchPage(name) {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
    if (name === 'download') {
      if (!state.remote) loadRemoteVersions();
      refreshModsList();
    }
    if (name === 'settings' || name === 'tools') {
      const page = $('#page-' + name);
      if (page && page.querySelector('.set-cat:not(.active)')) {
        // 保持当前子页；若没有激活项，激活第一个
      }
      const active = page.querySelector('.set-cat.active');
      if (!active) switchSub(name, page.querySelector('.set-cat').dataset.sub);
    }
  }

  function switchSub(page, sub) {
    const scope = $('#page-' + page);
    if (!scope) return;
    scope.querySelectorAll('.set-cat').forEach((c) => c.classList.toggle('active', c.dataset.sub === sub));
    scope.querySelectorAll('.set-sub').forEach((s) => s.classList.toggle('active', s.dataset.subbody === sub));
  }

  function setState(running, text) {
    $('#stateDot').classList.toggle('live', running);
    $('#stateText').textContent = text || (running ? '游戏运行中' : '未启动');
    $('#btnLaunch').classList.toggle('hidden', running);
    $('#btnStop').classList.toggle('hidden', !running);
    state.running = running;
  }

  function updateAvatar(name) {
    const av = $('#playerAvatar');
    if (!av) return;
    av.onerror = () => { av.onerror = null; av.src = '../build/icon.png'; };
    av.src = 'https://mc-heads.net/avatar/' + encodeURIComponent(name || 'fft1145') + '/96';
  }

  function syncVersionLabel() {
    const label = $('#launchVersionLabel');
    if (!label) return;
    const id = state.settings.versionId || (state.gameState.versions[0] && state.gameState.versions[0].id);
    label.textContent = id || '未选择版本';
  }

  function syncAccountCard() {
    const acc = state.activeAccount;
    const name = (acc && acc.name) || state.settings.playerName || 'fft1145';
    $('#topAccount').textContent = name;
    const tag = document.querySelector('.player-tag');
    if (tag) {
      tag.textContent = acc ? (acc.type === 'offline' ? '离线账号' : '正版账号') : '未登录';
      tag.classList.toggle('offline', !acc || acc.type === 'offline');
    }
    updateAvatar(name);
  }

  function applySettingsToForm(s) {
    $('#setPlayer').value = s.playerName || '';
    $('#setMemory').value = s.memoryMB || 2048;
    $('#setJava').value = s.javaPath || '';
    $('#setGameDir').value = s.gameDir || '';
    $('#setSource').value = s.source || 'bmclapi';
    $('#setAutoUpdate').checked = Boolean(s.autoUpdate);
    $('#setCrashWatch').checked = Boolean(s.crashWatch);
    $('#setCheckDownloads').checked = Boolean(s.checkDownloads);
    syncAccountCard();
    syncVersionLabel();
  }

  // ===== 游戏目录 / 已安装版本 =====
  function renderGameDirState() {
    const gs = state.gameState;
    const lines = [];
    lines.push('<div><b>当前目录：</b>' + esc(gs.gameDir || '(未设置)') + '</div>');
    lines.push('<div class="tip">识别到 ' + (gs.versions.length || 0) + ' 个版本' + (gs.valid ? '' : '（该目录下没有 versions/<版本>/<版本>.json）') + '</div>');
    if (gs.candidates && gs.candidates.length) {
      const others = gs.candidates.filter((c) => c.path !== gs.gameDir);
      if (others.length) {
        lines.push('<div class="diag-sub"><b>还检测到：</b><br>' + others.map((c) =>
          esc(c.label) + ' — ' + esc(c.path) + '（' + c.versions + ' 个版本）'
        ).join('<br>') + '</div>');
      }
    }
    for (const target of ['#gameDirState', '#gameDirState2']) {
      const el = $(target);
      if (el) el.innerHTML = lines.join('');
    }
  }

  function versionItem(v, installed) {
    const badge = installed ? '<span class="installed-tag">已安装</span>' : '';
    const action = installed
      ? '<button class="btn btn-sm btn-primary" data-launch="' + esc(v.id) + '">启动</button>'
      : '<button class="btn btn-sm" data-install="' + esc(v.id) + '">安装</button>';
    return '<div class="version-item">' +
      '<div class="v-left">' +
        '<span class="v-id">' + esc(v.id) + '</span>' +
        '<span class="v-type ' + esc(v.type || '') + '">' + esc(v.type || 'release') + '</span>' +
        '<span class="v-meta">' + esc((v.releaseTime || v.installedAt || '').slice(0, 10)) + '</span>' +
        badge +
      '</div>' + action + '</div>';
  }

  function renderInstanceList() {
    const list = $('#instanceList');
    if (!list) return;
    const gs = state.gameState;
    if (!gs.versions.length) {
      list.innerHTML = '<p class="empty">没有识别到已安装版本。点击上方「选择游戏目录」指定 .minecraft 所在文件夹，或到「下载」页安装一个新版本。</p>';
      return;
    }
    const current = state.settings.versionId;
    list.innerHTML = gs.versions.map((v) =>
      '<div class="version-item' + (v.id === current ? ' selected' : '') + '">' +
        '<div class="v-left">' +
          '<span class="v-id">' + esc(v.id) + '</span>' +
          '<span class="v-type ' + esc(v.type) + '">' + esc(v.type) + '</span>' +
          (v.id === current ? '<span class="installed-tag">当前</span>' : '') +
        '</div>' +
        '<div class="row"><button class="btn btn-sm" data-use="' + esc(v.id) + '">设为当前</button>' +
        '<button class="btn btn-sm btn-primary" data-launch="' + esc(v.id) + '">启动</button></div>' +
      '</div>'
    ).join('');
  }

  function renderInstalled() {
    renderInstanceList();
    renderGameDirState();
    const list = $('#installedVersions');
    if (list) {
      if (!state.gameState.versions.length) {
        list.innerHTML = '<p class="empty">没有识别到已安装版本。可在「下载」页安装，或到「管理」里指定已有游戏目录。</p>';
      } else {
        list.innerHTML = state.gameState.versions.map((v) => versionItem(v, true)).join('');
      }
    }
    $('#launchHint').textContent = state.gameState.versions.length
      ? '已选版本：' + (state.settings.versionId || state.gameState.versions[0].id) + '。点击「启动游戏」开始。'
      : '还没有可用的游戏版本，请到「下载」页安装，或指定已有游戏目录。';
    syncVersionLabel();
    populateModGameVersions();
    populateFabricGames();
  }

  function populateModGameVersions() {
    const sel = $('#modGameVersion');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">全部版本</option>';
    for (const v of state.gameState.versions) {
      const opt = document.createElement('option');
      opt.value = v.id; opt.textContent = v.id;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  }

  async function refreshInstalled(forceRescan) {
    const data = forceRescan ? await bmcl.rescanVersions() : await bmcl.listInstalled();
    state.gameState = data;
    state.installed = data.versions || [];
    renderInstalled();
  }

  async function scanGameDirs() {
    try {
      const dirs = await bmcl.scanGameDirs();
      if (!dirs.length) {
        toast('没有扫描到有可用版本的 Minecraft 目录，请用「选择」手动指定', 'error');
        return;
      }
      const first = dirs[0];
      const applied = await bmcl.setGameDir(first.path);
      state.gameState = applied;
      state.settings = await bmcl.getSettings();
      applySettingsToForm(state.settings);
      await refreshInstalled();
      toast('已切换到：' + first.label + '（' + first.versions + ' 个版本）', 'ok');
    } catch (err) {
      toast('扫描失败：' + err.message, 'error');
    }
  }

  async function pickGameDir() {
    try {
      const dir = await bmcl.pickDirectory('选择 .minecraft 游戏目录');
      if (!dir) return;
      const applied = await bmcl.setGameDir(dir);
      state.gameState = applied;
      state.settings = await bmcl.getSettings();
      applySettingsToForm(state.settings);
      await refreshInstalled();
      if (applied.versions.length) {
        toast('已设置游戏目录，识别到 ' + applied.versions.length + ' 个版本', 'ok');
      } else {
        toast('目录已设置，但没有识别到版本（需要 versions/<版本>/<版本>.json）', 'error');
      }
    } catch (err) {
      toast('设置目录失败：' + err.message, 'error');
    }
  }

  // ===== 下载页 =====
  function groupOf(v) {
    const id = (v.id || '').toLowerCase();
    const type = v.type || '';
    if (type === 'snapshot') {
      // 愚人节版通常命名为 15w14a / 3d shareware 等
      if (/^1[45]w|^3d|^20w14infinite|^22w13oneblockatatime|^23w13a_or_b|^24w14potato|^25w14craftmine/.test(id)) return 'april';
      return 'snapshot';
    }
    if (type === 'old_beta' || type === 'old_alpha') return 'old';
    return 'release';
  }

  function renderRemote(filter) {
    if (!state.remote) return;
    const q = String(filter || '').trim().toLowerCase();
    const groups = { release: [], snapshot: [], old: [], april: [] };
    const installedIds = new Set(state.gameState.versions.map((v) => v.id));
    for (const v of state.remote.versions) {
      if (q && !v.id.toLowerCase().includes(q)) continue;
      groups[groupOf(v)].push(v);
    }
    const map = {
      release: { body: '#vgRelease', count: '#vgCountRelease' },
      snapshot: { body: '#vgSnapshot', count: '#vgCountSnapshot' },
      old: { body: '#vgOld', count: '#vgCountOld' },
      april: { body: '#vgApril', count: '#vgCountApril' }
    };
    for (const key of Object.keys(map)) {
      const body = $(map[key].body);
      const count = $(map[key].count);
      if (count) count.textContent = '(' + groups[key].length + ')';
      if (!body) continue;
      if (!groups[key].length) {
        body.innerHTML = '<p class="empty">没有匹配的版本。</p>';
        continue;
      }
      body.innerHTML = groups[key].slice(0, 120).map((v) => versionItem(v, installedIds.has(v.id))).join('');
    }
  }

  async function loadRemoteVersions() {
    const btn = $('#btnRefreshVersions');
    if (btn) { btn.disabled = true; btn.textContent = '加载中…'; }
    try {
      state.remote = await bmcl.listRemote();
      renderRemote($('#dlFilter') ? $('#dlFilter').value : '');
      toast('已加载 ' + state.remote.versions.length + ' 个版本', 'ok');
    } catch (err) {
      const msg = (err && err.message) || String(err);
      const tip = /HTTP 403|404/i.test(msg)
        ? '（下载源不可用，试试在「设置 → 管理」切换下载源）'
        : '（可能是网络被限制，可在「设置 → 管理」检测下载是否被禁止）';
      ['#vgRelease', '#vgSnapshot', '#vgOld', '#vgApril'].forEach((sel) => {
        const el = $(sel); if (el) el.innerHTML = '<p class="empty">版本清单加载失败：' + esc(msg) + tip + '</p>';
      });
      toast('加载版本清单失败', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '刷新清单'; }
    }
  }

  function showInstallProgress(stage, done, total) {
    $('#installProgress').classList.remove('hidden');
    $('#installStage').textContent = stage || '安装中';
    $('#installCount').textContent = total ? done + ' / ' + total : '';
    $('#installBar').style.width = total ? Math.min(100, (done / total) * 100) + '%' : '0%';
    const fabricStatus = $('#fabricStatus');
    if (fabricStatus && $('#loaderPanel') && !$('#loaderPanel').classList.contains('hidden')) {
      fabricStatus.textContent = (stage || '安装中') + (total ? ' — ' + done + ' / ' + total : '');
    }
  }

  async function installVersion(id) {
    if (state.installing) return;
    state.installing = true;
    showInstallProgress('准备安装 ' + id, 0, 0);
    try {
      await bmcl.installVersion(id);
      toast('版本 ' + id + ' 安装完成，已设为当前实例', 'ok');
      state.settings = await bmcl.getSettings();
      await refreshInstalled(true);
      syncVersionLabel();
    } catch (err) {
      toast('安装失败：' + err.message, 'error');
      $('#installStage').textContent = '安装失败：' + err.message;
    } finally {
      state.installing = false;
      setTimeout(() => $('#installProgress').classList.add('hidden'), 1500);
    }
  }

  function populateFabricGames() {
    const sel = $('#fabricGame');
    if (!sel) return;
    const current = sel.value;
    const ids = [];
    for (const v of state.gameState.versions) ids.push(v.id);
    if (state.remote && Array.isArray(state.remote.versions)) {
      for (const v of state.remote.versions) {
        if (v.type !== 'release') continue;
        if (!ids.includes(v.id)) ids.push(v.id);
        if (ids.length >= 60) break;
      }
    }
    sel.innerHTML = '<option value="">选择游戏版本</option>' +
      ids.map((id) => '<option value="' + esc(id) + '">' + esc(id) + '</option>').join('');
    if (current && ids.includes(current)) sel.value = current;
  }

  async function loadFabricLoaders() {
    const game = $('#fabricGame') ? $('#fabricGame').value : '';
    if (!game) { toast('请先选择一个游戏版本', 'error'); return; }
    const sel = $('#fabricLoader');
    try {
      sel.innerHTML = '<option value="">加载中…</option>';
      const list = await bmcl.listFabricLoaders(game);
      if (!list.length) { sel.innerHTML = '<option value="">该版本没有可用 Loader</option>'; return; }
      sel.innerHTML = '<option value="">自动选择最新稳定版</option>' + list.map((item) =>
        '<option value="' + esc(item.version) + '">' + esc(item.version) + (item.stable ? '（稳定）' : '') + '</option>'
      ).join('');
    } catch (err) {
      sel.innerHTML = '<option value="">获取失败：' + esc(err.message) + '</option>';
    }
  }

  async function installFabricFromUi() {
    const game = $('#fabricGame') ? $('#fabricGame').value : '';
    if (!game) { toast('请先选择一个游戏版本', 'error'); return; }
    if (state.installing) return;
    const loader = $('#fabricLoader') ? $('#fabricLoader').value : '';
    state.installing = true;
    $('#fabricStatus').textContent = '准备安装 Fabric（' + game + '）…';
    try {
      const result = await bmcl.installFabric(game, loader);
      toast('Fabric 安装完成：' + result.versionId, 'ok');
      $('#fabricStatus').textContent = '安装完成：' + result.versionId + '（' + result.files + ' 个运行库），已设为当前实例。';
      state.settings = await bmcl.getSettings();
      await refreshInstalled(true);
      syncVersionLabel();
      populateFabricGames();
    } catch (err) {
      toast('Fabric 安装失败：' + err.message, 'error');
      $('#fabricStatus').textContent = '安装失败：' + err.message;
    } finally {
      state.installing = false;
    }
  }

  const PACK_NOTICES = {
    forge: {
      title: 'Forge 安装器',
      body: 'Forge 需要运行官方 installer jar 并生成 inheritsFrom 版本。当前版本尚未内置该流程，请先用官方安装器装到同一游戏目录；启动器已支持版本继承，装好后能直接识别并启动。',
      url: 'https://files.minecraftforge.net/net/minecraftforge/forge/'
    },
    optifine: {
      title: 'OptiFine 安装器',
      body: 'OptiFine 安装需要给客户端 jar 打补丁。当前版本尚未内置该流程，请先用官方安装器安装；启动器支持 inheritsFrom 继承，装好后可直接启动。',
      url: 'https://optifine.net/downloads'
    }
  };

  function showPackNotice(kind) {
    const info = PACK_NOTICES[kind] || PACK_NOTICES.forge;
    $('#packNoticeTitle').textContent = info.title;
    $('#packNoticeBody').textContent = info.body;
    $('#btnPackOpenSite').onclick = () => bmcl.openExternal(info.url);
  }

  function showDlPanel(target) {
    ['#mcPanel', '#modPanel', '#instancePanel', '#loaderPanel', '#packNoticePanel'].forEach((sel) => {
      const el = $(sel);
      if (el) el.classList.toggle('hidden', sel !== target);
    });
  }

  async function launchGame(versionId) {
    const id = versionId || state.settings.versionId || (state.gameState.versions[0] && state.gameState.versions[0].id);
    if (!id) { toast('还没有可启动的版本，请先安装或指定游戏目录', 'error'); return; }
    $('#gameLog').textContent = '';
    $('#launchHint').textContent = '正在启动 ' + id + ' …';
    try {
      await bmcl.launch(id);
      setState(true, '游戏运行中');
    } catch (err) {
      $('#launchHint').textContent = '';
      toast('启动失败：' + err.message, 'error');
      appendGameLog('[启动失败] ' + err.message + '\n');
    }
  }

  async function stopGame() {
    try { await bmcl.stop(); } catch (err) { toast(err.message, 'error'); }
  }

  function appendGameLog(text) {
    const el = $('#gameLog');
    el.textContent += text;
    if (el.textContent.length > 400000) el.textContent = el.textContent.slice(-300000);
    el.scrollTop = el.scrollHeight;
    const el2 = $('#gameLog2');
    if (el2) { el2.textContent = el.textContent; el2.scrollTop = el2.scrollHeight; }
  }

  // ===== 崩溃 / 网络 / 更新 =====
  function renderDiagnosis(target, report) {
    if (!target) return;
    if (!report || (!report.summary && !(report.causes || []).length)) {
      target.innerHTML = '<span class="tip">未发现崩溃记录。</span>'; return;
    }
    const causes = (report.causes || []).map((c) =>
      '<div class="cause">· ' + esc(c.cause) + '</div><div class="tip">建议：' + esc(c.suggestion) + '</div>'
    ).join('');
    const stack = (report.stack || []).length
      ? '<div class="diag-sub"><b>调用栈</b><br>' + report.stack.map(esc).join('<br>') + '</div>' : '';
    target.innerHTML =
      '<div><b>诊断：</b>' + esc(report.summary || '') + '</div>' +
      (causes ? '<div class="diag-sub">' + causes + '</div>' : '') + stack +
      (report.reportPath ? '<div class="diag-sub">崩溃报告：' + esc(report.reportPath) + '</div>' : '');
  }

  function openCrashPanel(report) {
    $('#crashBox').hidden = false;
    renderDiagnosis($('#crashResult'), report);
  }

  async function diagnoseNow() {
    const report = await bmcl.diagnoseCrash();
    renderDiagnosis($('#crashSettingsResult'), report);
    openCrashPanel(report);
    switchPage('launch');
    toast('诊断完成', 'ok');
  }

  async function checkNet() {
    $('#netHint').textContent = '检测中…';
    const result = await bmcl.checkNetwork();
    if (result.allowed) {
      $('#netHint').textContent = '网络正常（HTTP ' + result.status + '）';
      toast('下载通路正常', 'ok');
    } else {
      $('#netHint').textContent = '下载可能被禁止：' + (result.reason || '网络不可用');
      toast('检测到下载可能被禁止，请检查网络/代理', 'error');
    }
    return result;
  }

  async function checkUpdate() {
    $('#updateResult').innerHTML = '<span class="tip">检查中…</span>';
    try {
      const result = await bmcl.checkUpdate();
      state.pendingUpdate = result;
      if (result.hasUpdate) {
        $('#btnApplyUpdate').classList.remove('hidden');
        $('#updateResult').innerHTML =
          '<div><b>发现新版本 ' + esc(result.release.version) + '</b>（当前 ' + esc(result.currentVersion) + '）</div>' +
          (result.release.notes ? '<div class="diag-sub">' + esc(result.release.notes).slice(0, 1000) + '</div>' : '');
        toast('发现新版本 ' + result.release.version, 'ok');
      } else {
        $('#btnApplyUpdate').classList.add('hidden');
        $('#updateResult').innerHTML = '<span class="tip">已是最新版本</span>';
      }
    } catch (err) {
      $('#updateResult').innerHTML = '<span class="cause">更新检查失败：' + esc(err.message) + '</span>';
    }
  }

  async function applyUpdate() {
    if (!state.pendingUpdate || !state.pendingUpdate.hasUpdate) return;
    const btn = $('#btnApplyUpdate');
    btn.disabled = true; btn.textContent = '更新中…';
    try {
      const result = await bmcl.applyUpdate(state.pendingUpdate.release);
      if (result.redirected) {
        toast('已打开发布页，请下载新版便携版 exe', 'ok');
      } else {
        toast('更新完成，重启启动器后生效', 'ok');
        $('#updateResult').innerHTML = '<span class="tip">已更新 ' + result.updated + ' 个启动器文件，未触碰游戏文件。</span>';
        $('#btnApplyUpdate').classList.add('hidden');
      }
    } catch (err) {
      toast('更新失败：' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '立即更新';
    }
  }

  // ===== 设置 =====
  async function saveSettings() {
    const payload = {
      playerName: $('#setPlayer').value.trim() || 'fft1145',
      memoryMB: Number($('#setMemory').value) || 2048,
      javaPath: $('#setJava').value.trim(),
      source: $('#setSource').value,
      autoUpdate: $('#setAutoUpdate').checked,
      crashWatch: $('#setCrashWatch').checked,
      checkDownloads: $('#setCheckDownloads').checked,
      versionId: state.settings.versionId || ''
    };
    state.settings = await bmcl.saveSettings(payload);
    applySettingsToForm(state.settings);
    // 游戏目录单独走 setGameDir，保证会被校验并立即生效
    const typed = $('#setGameDir').value.trim();
    if (typed && typed !== state.gameState.gameDir) {
      try {
        state.gameState = await bmcl.setGameDir(typed);
        state.settings = await bmcl.getSettings();
        await refreshInstalled();
      } catch (err) {
        toast('游戏目录无效：' + err.message, 'error');
      }
    }
    $('#saveHint').textContent = '已保存';
    toast('设置已保存', 'ok');
    setTimeout(() => { $('#saveHint').textContent = ''; }, 2500);
  }

  async function probeJava() {
    $('#javaHint').textContent = '检测中…';
    const result = await bmcl.probeJava($('#setJava').value.trim());
    $('#javaHint').textContent = result.ok
      ? 'Java ' + result.version + '（主版本 ' + result.major + '）'
      : '未找到可用的 Java：' + (result.message || '');
  }

  async function scanRepair() {
    $('#repairResult').innerHTML = '<span class="tip">扫描中…</span>';
    $('#repairState').textContent = '扫描中';
    try {
      const report = await bmcl.scanRepair();
      state.repair = report;
      renderRepair(report, 'scan');
      toast(report.ok ? '启动器状态正常' : '发现 ' + countFixable(report) + ' 项可修复问题', report.ok ? 'ok' : 'error');
    } catch (err) {
      $('#repairResult').innerHTML = '<span class="cause">扫描失败：' + esc(err.message) + '</span>';
      $('#repairState').textContent = '扫描失败';
    }
  }

  async function runRepair() {
    const btn = $('#btnRepairRun');
    btn.disabled = true; btn.textContent = '修复中…';
    try {
      const result = await bmcl.runRepair();
      state.repair = result;
      renderRepair(result, 'fixed');
      state.settings = await bmcl.getSettings();
      applySettingsToForm(state.settings);
      await refreshInstalled();
      syncVersionLabel();
      toast(result.failed > 0 ? '修复完成，' + result.failed + ' 项需要手动处理' : '修复完成，共修复 ' + result.fixed + ' 项', result.failed > 0 ? 'error' : 'ok');
    } catch (err) {
      toast('修复失败：' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '一键修复';
    }
  }

  function countFixable(report) {
    return (report.issues || []).filter((i) => i.status === 'skip').length;
  }

  function renderRepair(report, mode) {
    const rows = (report.issues || []).map((i) => {
      if (i.status === 'ok') return '<div class="tip">✔ ' + esc(i.title) + '：正常</div>';
      if (i.status === 'fixed') return '<div class="tip">✔ ' + esc(i.title) + '：已修复（' + esc(i.detail) + '）</div>';
      if (i.status === 'fail') return '<div class="cause">✖ ' + esc(i.title) + '：无法修复（' + esc(i.detail) + '）</div>';
      return '<div>· ' + esc(i.title) + '：待修复（' + esc(i.detail) + '）</div>';
    }).join('');
    $('#repairResult').innerHTML = rows || '<span class="tip">没有需要检查的项目。</span>';
    const pending = countFixable(report);
    const failed = (report.issues || []).filter((i) => i.status === 'fail').length;
    if (mode === 'fixed') {
      $('#repairState').textContent = failed > 0 ? failed + ' 项待手动处理' : '已修复 ' + report.fixed + ' 项';
      $('#btnRepairRun').classList.add('hidden');
    } else {
      $('#repairState').textContent = failed > 0 ? failed + ' 项需手动处理' : (pending ? pending + ' 项待修复' : '全部正常');
      $('#btnRepairRun').classList.toggle('hidden', pending === 0);
    }
  }

  // ===== 账号 =====
  async function refreshAccounts() {
    const data = await bmcl.listAccounts();
    state.accounts = data.accounts || [];
    state.activeAccount = state.accounts.find((a) => a.id === data.active) || state.accounts[0] || null;
    renderAccountList();
    syncAccountCard();
  }

  function renderAccountList() {
    const list = $('#accountList');
    if (!list) return;
    if (!state.accounts.length) {
      list.innerHTML = '<p class="empty" style="padding:10px">暂无账号，请在下方添加一个离线账号。</p>';
      return;
    }
    list.innerHTML = state.accounts.map((a) => {
      const active = state.activeAccount && state.activeAccount.id === a.id;
      return '<div class="ap-item' + (active ? ' active' : '') + '" data-acc="' + esc(a.id) + '">' +
        '<span class="ap-name">' + esc(a.name) + '</span>' +
        '<span class="ap-type">' + (a.type === 'offline' ? '离线' : '正版') + '</span>' +
        (active ? '<span class="ap-check">✓</span>' : '') +
        '<button class="ap-del" data-del="' + esc(a.id) + '">删除</button>' +
      '</div>';
    }).join('');
  }

  async function addAccount() {
    const name = $('#newAccountName').value.trim();
    if (!name) { toast('请输入玩家名', 'error'); return; }
    try {
      await bmcl.addAccount(name);
      $('#newAccountName').value = '';
      await refreshAccounts();
      state.settings = await bmcl.getSettings();
      syncVersionLabel();
      toast('账号「' + name + '」已添加并设为当前', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function setActiveAccount(id) {
    await bmcl.setActiveAccount(id);
    await refreshAccounts();
    toast('已切换账号', 'ok');
  }

  async function removeAccount(id) {
    await bmcl.removeAccount(id);
    await refreshAccounts();
    toast('账号已删除', 'ok');
  }

  // ===== 模组 =====
  async function searchMods() {
    const q = $('#modSearch').value.trim();
    if (!q) { toast('请输入模组关键词', 'error'); return; }
    const gv = $('#modGameVersion').value || undefined;
    const btn = $('#btnModSearch');
    btn.disabled = true; btn.textContent = '搜索中…';
    try {
      const results = await bmcl.searchMods(q, gv);
      state.modResults = results;
      renderModResults(results);
      toast('找到 ' + results.length + ' 个模组', 'ok');
    } catch (err) {
      $('#modResults').innerHTML = '<p class="empty">搜索失败：' + esc(err.message) + '（请检查网络或代理）</p>';
      toast('模组搜索失败', 'error');
    } finally {
      btn.disabled = false; btn.textContent = '搜索';
    }
  }

  function renderModResults(results) {
    const list = $('#modResults');
    if (!results.length) { list.innerHTML = '<p class="empty">没有找到模组。</p>'; return; }
    list.innerHTML = results.map((m) =>
      '<div class="mod-item">' +
        (m.iconUrl ? '<img class="mod-icon" src="' + esc(m.iconUrl) + '" alt="" loading="lazy">' : '<div class="mod-icon"></div>') +
        '<div class="mod-info">' +
          '<div class="mod-title">' + esc(m.title) + '</div>' +
          '<div class="mod-desc">' + esc(m.description || '') + '</div>' +
          '<div class="mod-cats">' + (m.categories || []).slice(0, 4).map((c) => '<span class="mod-cat">' + esc(c) + '</span>').join('') + '</div>' +
          '<div class="mod-meta">作者：' + esc(m.author || '') + ' · 下载量：' + (m.downloads || 0).toLocaleString() + '</div>' +
        '</div>' +
        '<div class="mod-actions">' +
          '<button class="btn btn-sm btn-primary" data-modinstall="' + esc(m.id) + '">安装</button>' +
          '<button class="btn btn-sm" data-modview="' + esc(m.id) + '">版本</button>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  async function showModVersions(projectId) {
    const mod = state.modResults.find((m) => m.id === projectId);
    const gv = $('#modGameVersion').value || state.settings.versionId || undefined;
    try {
      const versions = await bmcl.getModVersions(projectId, gv);
      const list = $('#modResults');
      if (!versions.length) {
        list.innerHTML = '<p class="empty">' + esc(mod ? mod.title : projectId) + ' 没有适配当前游戏版本的文件。可在上方把「游戏版本」设为全部再试。</p>';
        return;
      }
      list.innerHTML = '<div class="version-item"><b>' + esc(mod ? mod.title : projectId) + ' — 可用文件</b></div>' +
        versions.map((v) =>
          '<div class="version-item">' +
            '<div class="v-left">' +
              '<span class="v-id">' + esc(v.versionNumber) + '</span>' +
              '<span class="v-meta">' + esc((v.gameVersions || []).slice(0, 4).join(', ')) + '</span>' +
              '<span class="v-meta">' + esc((v.loaders || []).join(', ')) + '</span>' +
            '</div>' +
            '<button class="btn btn-sm btn-primary" data-modfile="' + esc(v.fileUrl) + '" data-fn="' + esc(v.fileName) + '">下载</button>' +
          '</div>'
        ).join('');
    } catch (err) {
      toast('获取模组版本失败：' + err.message, 'error');
    }
  }

  async function quickInstallMod(projectId) {
    const gv = $('#modGameVersion').value || state.settings.versionId || undefined;
    try {
      const versions = await bmcl.getModVersions(projectId, gv);
      if (!versions.length) {
        toast('该模组没有适配 ' + (gv || '当前') + ' 版本的文件，试试切换游戏版本', 'error');
        return;
      }
      const best = versions[0];
      await doInstallMod({ fileUrl: best.fileUrl, fileName: best.fileName });
    } catch (err) {
      toast('安装模组失败：' + err.message, 'error');
    }
  }

  async function doInstallMod(modVersion, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
    try {
      const r = await bmcl.installMod(modVersion);
      toast('已安装 ' + modVersion.fileName + '（' + (r.size / 1024 / 1024).toFixed(2) + ' MB）', 'ok');
      await refreshModsList();
    } catch (err) {
      toast('模组下载失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '下载'; }
    }
  }

  async function refreshModsList() {
    const list = $('#installedMods');
    if (!list) return;
    try {
      const mods = await bmcl.listInstalledMods();
      if (!mods.length) { list.innerHTML = '<p class="empty">尚未安装任何模组。</p>'; return; }
      list.innerHTML = mods.map((m) =>
        '<div class="version-item">' +
          '<div class="v-left"><span class="v-id">' + esc(m.name) + '</span>' +
          '<span class="v-meta">' + (m.size / 1024 / 1024).toFixed(2) + ' MB</span>' +
          '<span class="v-meta">' + esc((m.modifiedAt || '').slice(0, 10)) + '</span></div>' +
        '</div>'
      ).join('');
    } catch {
      list.innerHTML = '<p class="empty">读取模组列表失败。</p>';
    }
  }

  // ===== 工具 =====
  async function cleanJunk() {
    try {
      const r = await bmcl.cleanJunk();
      toast('已清理 ' + r.removed + ' 个文件，释放 ' + (r.freed / 1024 / 1024).toFixed(2) + ' MB', 'ok');
    } catch (err) { toast('清理失败：' + err.message, 'error'); }
  }

  async function showLaunchCount() {
    try {
      const count = await bmcl.getLaunchCount();
      toast('累计启动游戏 ' + count + ' 次', 'ok');
    } catch { toast('读取启动计数失败', 'error'); }
  }

  async function createShortcut() {
    try {
      const r = await bmcl.createShortcut();
      toast('快捷方式已创建：' + r.path, 'ok');
    } catch (err) { toast('创建快捷方式失败：' + err.message, 'error'); }
  }

  async function customDownload() {
    const url = $('#customUrl').value.trim();
    const dir = $('#customSaveDir').value.trim();
    const name = $('#customFileName').value.trim() || undefined;
    if (!url) { toast('请输入下载地址', 'error'); return; }
    if (!dir) { toast('请先选择保存目录', 'error'); return; }
    try {
      const r = await bmcl.downloadFile(url, dir, name);
      toast('下载完成：' + (r.bytes / 1024 / 1024).toFixed(2) + ' MB → ' + r.path, 'ok');
    } catch (err) { toast('下载失败：' + err.message, 'error'); }
  }

  async function pickSaveDir() {
    try {
      const dir = await bmcl.pickDirectory('选择保存目录');
      if (dir) $('#customSaveDir').value = dir;
    } catch (err) { toast('选择目录失败：' + err.message, 'error'); }
  }

  async function downloadSkin() {
    const name = $('#skinPlayer').value.trim();
    if (!name) { toast('请输入玩家名', 'error'); return; }
    try {
      const r = await bmcl.downloadSkin(name);
      toast('皮肤已下载：' + r.path, 'ok');
    } catch (err) { toast('下载皮肤失败：' + err.message, 'error'); }
  }

  async function netTest() {
    $('#netTestResult').innerHTML = '<span class="tip">测试中…</span>';
    try {
      const result = await bmcl.checkNetwork();
      $('#netTestResult').innerHTML = result.allowed
        ? '<span class="tip">网络正常（HTTP ' + result.status + '）</span>'
        : '<span class="cause">网络不可用：' + esc(result.reason || '') + '</span>';
      toast(result.allowed ? '网络测试通过' : '网络测试失败', result.allowed ? 'ok' : 'error');
    } catch (err) {
      $('#netTestResult').innerHTML = '<span class="cause">测试失败：' + esc(err.message) + '</span>';
    }
  }

  async function refreshLobbyInstances() {
    const sel = $('#lobbyInstance');
    sel.innerHTML = '<option value="">（请选择实例）</option>';
    for (const v of state.gameState.versions) {
      const opt = document.createElement('option');
      opt.value = v.id; opt.textContent = v.id;
      sel.appendChild(opt);
    }
    toast('已刷新实例列表（' + state.gameState.versions.length + ' 个）', 'ok');
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.page));
    });
    document.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.goto));
    });

    document.querySelectorAll('.set-cat').forEach((cat) => {
      cat.addEventListener('click', () => {
        const page = cat.closest('.page');
        switchSub(page.id.replace('page-', ''), cat.dataset.sub);
      });
    });

    // 下载页分类
    const catHandlers = {
      mc: () => showDlPanel('#mcPanel'),
      'mc-install': () => showDlPanel('#mcPanel'),
      mods2: () => showDlPanel('#modPanel'),
      modpacks: () => showDlPanel('#modPanel'),
      fabric: () => { showDlPanel('#loaderPanel'); populateFabricGames(); },
      forge: () => { showDlPanel('#packNoticePanel'); showPackNotice('forge'); },
      optifine: () => { showDlPanel('#packNoticePanel'); showPackNotice('optifine'); }
    };
    document.querySelectorAll('.dl-cat').forEach((cat) => {
      cat.addEventListener('click', () => {
        cat.parentElement.querySelectorAll('.dl-cat').forEach((c) => c.classList.remove('active'));
        cat.classList.add('active');
        const handler = catHandlers[cat.dataset.cat] || catHandlers.mc;
        handler();
        if ((cat.dataset.cat || '').startsWith('mod')) refreshModsList();
      });
    });

    // 版本组折叠
    document.querySelectorAll('.vg-toggle').forEach((tg) => {
      tg.addEventListener('click', () => {
        const group = tg.closest('.version-group');
        const body = group.querySelector('.vg-body');
        const collapsed = body.classList.toggle('collapsed');
        group.classList.toggle('collapsed', collapsed);
      });
    });

    [['winMin', 'winMinimize'], ['winClose', 'winClose']].forEach(([id, fn]) => {
      const el = document.getElementById(id);
      if (el && bmcl && typeof bmcl[fn] === 'function') el.addEventListener('click', () => bmcl[fn]());
    });

    document.querySelectorAll('[data-open]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); bmcl.openExternal(el.dataset.open); });
    });

    // 启动页
    $('#btnLaunch').addEventListener('click', () => launchGame());
    $('#btnStop').addEventListener('click', stopGame);
    $('#btnInstanceSelect').addEventListener('click', async () => {
      switchPage('download');
      showDlPanel('#instancePanel');
      await refreshInstalled(true);
    });
    ['#btnOpenDir2', '#btnOpenDir3', '#btnOpenDir4'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('click', () => bmcl.openGameDir());
    });
    $('#btnClearLog').addEventListener('click', () => { $('#gameLog').textContent = ''; });
    $('#btnClearLog2').addEventListener('click', () => { $('#gameLog2').textContent = ''; });
    $('#btnCloseCrash').addEventListener('click', () => { $('#crashBox').hidden = true; });
    $('#btnNoticeClose').addEventListener('click', () => { $('#noticeCard').classList.add('hidden'); });

    // 下载页
    $('#btnRefreshVersions').addEventListener('click', loadRemoteVersions);
    $('#dlFilter').addEventListener('input', (e) => renderRemote(e.target.value));
    $('#btnRescanVersions').addEventListener('click', async () => {
      await refreshInstalled(true);
      toast('已重新扫描，识别到 ' + state.gameState.versions.length + ' 个版本', 'ok');
    });
    $('#btnPickGameDir').addEventListener('click', pickGameDir);
    $('#btnPickGameDir2').addEventListener('click', pickGameDir);
    $('#btnScanGameDir').addEventListener('click', scanGameDirs);

    // Fabric 安装
    $('#btnFabricGames').addEventListener('click', async () => {
      await loadRemoteVersions();
      populateFabricGames();
    });
    $('#btnFabricLoaders').addEventListener('click', loadFabricLoaders);
    $('#btnInstallFabric').addEventListener('click', installFabricFromUi);

    // 版本列表：安装 / 启动 / 设为当前
    document.addEventListener('click', (e) => {
      const install = e.target.closest('[data-install]');
      if (install) { installVersion(install.dataset.install); return; }
      const launch = e.target.closest('[data-launch]');
      if (launch) {
        state.settings.versionId = launch.dataset.launch;
        syncVersionLabel();
        switchPage('launch');
        launchGame(launch.dataset.launch);
        return;
      }
      const use = e.target.closest('[data-use]');
      if (use) {
        state.settings.versionId = use.dataset.use;
        bmcl.saveSettings({ versionId: use.dataset.use }).then(() => {
          syncVersionLabel();
          renderInstanceList();
          toast('当前实例：' + use.dataset.use, 'ok');
        });
        return;
      }
      const modInstall = e.target.closest('[data-modinstall]');
      if (modInstall) { quickInstallMod(modInstall.dataset.modinstall); return; }
      const modView = e.target.closest('[data-modview]');
      if (modView) { showModVersions(modView.dataset.modview); return; }
      const modFile = e.target.closest('[data-modfile]');
      if (modFile) { doInstallMod({ fileUrl: modFile.dataset.modfile, fileName: modFile.dataset.fn }, modFile); return; }
    });

    // 设置页
    $('#btnSaveSettings').addEventListener('click', saveSettings);
    $('#btnProbeJava').addEventListener('click', probeJava);
    $('#btnCheckNet').addEventListener('click', checkNet);
    $('#btnCheckUpdate').addEventListener('click', checkUpdate);
    $('#btnApplyUpdate').addEventListener('click', applyUpdate);
    $('#btnDiagnose').addEventListener('click', diagnoseNow);
    $('#btnRepairScan').addEventListener('click', scanRepair);
    $('#btnRepairRun').addEventListener('click', runRepair);
    $('#setSource').addEventListener('change', () => { state.remote = null; });

    // 账号
    $('#btnSwitchAccount').addEventListener('click', () => $('#accountPanel').classList.toggle('hidden'));
    $('#btnAccountClose').addEventListener('click', () => $('#accountPanel').classList.add('hidden'));
    $('#btnAddAccount').addEventListener('click', addAccount);
    $('#newAccountName').addEventListener('keydown', (e) => { if (e.key === 'Enter') addAccount(); });
    $('#accountList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); removeAccount(del.dataset.del); return; }
      const item = e.target.closest('[data-acc]');
      if (item) setActiveAccount(item.dataset.acc);
    });
    $('#btnEditProfile').addEventListener('click', () => {
      $('#accountPanel').classList.remove('hidden');
      $('#newAccountName').focus();
    });
    $('#btnSkin').addEventListener('click', () => {
      switchPage('tools');
      switchSub('tools', 'toolbox');
      setTimeout(() => $('#skinPlayer').focus(), 200);
    });

    // 模组
    $('#btnModSearch').addEventListener('click', searchMods);
    $('#modSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMods(); });
    $('#btnRefreshMods').addEventListener('click', refreshModsList);
    $('#btnOpenModsDir').addEventListener('click', () => bmcl.openModsDir());

    // 联机
    $('#btnLobbyClear').addEventListener('click', () => { $('#lobbyCode').value = ''; });
    $('#btnLobbyPaste').addEventListener('click', async () => {
      try {
        if (navigator.clipboard) $('#lobbyCode').value = await navigator.clipboard.readText();
        else toast('无法读取剪贴板，请手动粘贴', 'error');
      } catch { toast('无法读取剪贴板，请手动粘贴', 'error'); }
    });
    $('#btnLobbyJoin').addEventListener('click', () => {
      const code = $('#lobbyCode').value.trim();
      toast(code ? '联机大厅需要 PCL CE 的联机服务，当前版本暂未接入（编号：' + code + '）' : '请输入大厅编号', code ? 'error' : 'error');
    });
    $('#btnLobbyRefresh').addEventListener('click', refreshLobbyInstances);
    $('#btnLobbyManual').addEventListener('click', () => toast('手动输入端口功能暂未接入', 'error'));
    $('#btnLobbyCreate').addEventListener('click', () => toast('创建大厅需要联机服务，当前版本暂未接入', 'error'));

    // 百宝箱
    $('#btnCleanJunk').addEventListener('click', cleanJunk);
    $('#btnFortune').addEventListener('click', () => {
      const fortunes = ['大吉', '中吉', '小吉', '吉', '末吉', '凶'];
      toast('今日人品：' + fortunes[Math.floor(Math.random() * fortunes.length)], 'ok');
    });
    $('#btnShortcut').addEventListener('click', createShortcut);
    $('#btnLaunchCount').addEventListener('click', showLaunchCount);
    $('#btnPickSaveDir').addEventListener('click', pickSaveDir);
    $('#btnCustomDownload').addEventListener('click', customDownload);
    $('#btnOpenCustomDir').addEventListener('click', () => {
      const dir = $('#customSaveDir').value.trim();
      if (dir) bmcl.openPath(dir); else toast('请先选择保存目录', 'error');
    });
    $('#btnDownloadSkin').addEventListener('click', downloadSkin);
    $('#btnNetTest').addEventListener('click', netTest);
  }

  function bindBridgeEvents() {
    bmcl.onLog((entry) => {
      if (entry && entry.level === 'error') appendGameLog('[启动器] ' + entry.message + '\n');
    });
    bmcl.onGameLog((entry) => { if (entry && entry.text) appendGameLog(entry.text); });
    bmcl.onGameState((payload) => {
      const running = Boolean(payload && payload.running);
      setState(running, running ? '游戏运行中' : '未启动');
      if (!running && payload && payload.code === 0) appendGameLog('[游戏已退出]\n');
      if (!running && payload && payload.code != null && payload.code !== 0) appendGameLog('[游戏异常退出，退出码 ' + payload.code + ']\n');
    });
    bmcl.onGameCrash((report) => { openCrashPanel(report); toast('游戏崩溃，已生成诊断', 'error'); });
    bmcl.onInstallProgress((p) => showInstallProgress(p.stage, p.done, p.total));
    bmcl.onUpdateProgress((p) => { $('#updateResult').textContent = '正在应用更新 ' + p.done + ' / ' + p.total; });
    bmcl.onDownloadProgress(() => {});
  }

  async function boot() {
    if (!bmcl) { showBanner('未检测到 Electron 环境：请用 npm start 运行启动器。', 'error'); return; }
    state.info = await bmcl.info();
    state.settings = await bmcl.getSettings();
    ['#sideVersion', '#updVersion', '#updVersion2'].forEach((sel) => {
      const el = $(sel); if (el) el.textContent = 'v' + state.info.version;
    });
    await refreshAccounts();
    applySettingsToForm(state.settings);
    setState(false, '未启动');
    bindEvents();
    bindBridgeEvents();
    await refreshInstalled(true);

    const preflight = await bmcl.preflight();
    state.preflight = preflight;

    if (preflight.selfCheck && !preflight.selfCheck.ok) {
      const bad = preflight.selfCheck.checks.filter((c) => !c.ok).map((c) => c.name).join('、');
      showBanner('启动器自检未通过：' + bad + '（可尝试重新安装启动器，游戏文件不受影响）', 'error');
    }
    if (preflight.crash && preflight.crash.launcherCrashed) {
      openCrashPanel(preflight.crash);
      showBanner('检测到上次启动器异常退出，已自动生成诊断。', 'error');
      $('#crashSettingsResult').innerHTML = '<span class="cause">上次启动器异常退出（' + esc((preflight.crash.startedAt || '').slice(0, 16).replace('T', ' ')) + '）</span>';
    } else if (preflight.crash && preflight.crash.summary) {
      $('#crashSettingsResult').innerHTML = '<span class="tip">' + esc(preflight.crash.summary) + '</span>';
    }
    if (preflight.download && !preflight.download.allowed) {
      showBanner('检测到下载可能被禁止（网络不可用）：已自动跳过更新检查。原因：' + preflight.download.reason, 'error');
      $('#netHint').textContent = '下载可能被禁止';
      $('#updateResult').innerHTML = '<span class="tip">网络不可用，已自动关闭更新检测</span>';
    } else if (preflight.update) {
      state.pendingUpdate = preflight.update;
      if (preflight.update.hasUpdate) {
        showBanner('发现启动器新版本 ' + preflight.update.release.version + '，可在「设置 → 软件更新」中更新。', 'ok');
        $('#btnApplyUpdate').classList.remove('hidden');
        $('#updateResult').innerHTML = '<div><b>发现新版本 ' + esc(preflight.update.release.version) + '</b></div>' +
          (preflight.update.release.notes ? '<div class="diag-sub">' + esc(preflight.update.release.notes).slice(0, 1000) + '</div>' : '');
      } else {
        $('#updateResult').innerHTML = '<span class="tip">已是最新版本</span>';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
