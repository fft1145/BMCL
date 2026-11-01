'use strict';

(function () {
  const bmcl = window.bmcl;
  const $ = (sel) => document.querySelector(sel);
  const state = {
    info: null,
    settings: {},
    installed: [],
    running: false,
    installing: false,
    preflight: null,
    remote: null,
    pendingUpdate: null,
    accounts: [],
    activeAccount: null,
    modSearchResults: []
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
  }

  function switchPage(name) {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
    if (name === 'download' && !state.remote) loadRemoteVersions();
    if (name === 'settings' || name === 'tools') {
      const page = $('#page-' + name);
      const firstCat = page.querySelector('.set-cat');
      if (firstCat) switchSub(name, firstCat.dataset.sub);
    }
    if (name === 'download') refreshInstalledMods();
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
    const id = state.settings.versionId;
    label.textContent = id || '未选择版本';
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
    $('#topAccount').textContent = (state.activeAccount && state.activeAccount.name) || s.playerName || 'fft1145';
    updateAvatar((state.activeAccount && state.activeAccount.name) || s.playerName);
  }

  function renderInstalled() {
    const list = $('#installedVersions');
    if (!state.installed.length) {
      list.innerHTML = '<p class="empty">还没有安装任何版本。可在「下载」页安装，或点击「扫描」检测已有游戏目录。</p>';
      $('#launchHint').textContent = '还没有安装版本，请到「下载」页安装一个。';
    } else {
      $('#launchHint').textContent = '已选版本：' + (state.settings.versionId || '未选择') + '。点击「启动游戏」开始。';
      list.innerHTML = state.installed.map((v) =>
        '<div class="version-item">' +
          '<div class="v-left">' +
            '<span class="v-id">' + esc(v.id) + '</span>' +
            '<span class="v-type ' + esc(v.type) + '">' + esc(v.type) + '</span>' +
            '<span class="v-meta">' + esc((v.installedAt || '').slice(0, 10)) + '</span>' +
          '</div>' +
          '<button class="btn btn-sm btn-primary" data-launch="' + esc(v.id) + '">启动</button>' +
        '</div>'
      ).join('');
    }
    syncVersionLabel();
    // 填充模组游戏版本下拉
    populateModGameVersions();
  }

  function populateModGameVersions() {
    const sel = $('#modGameVersion');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">全部版本</option>';
    for (const v of state.installed) {
      const opt = document.createElement('option');
      opt.value = v.id; opt.textContent = v.id;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  }

  function renderRemote(filter) {
    const list = $('#remoteVersions');
    if (!state.remote) {
      list.innerHTML = '<p class="empty">点击「刷新清单」加载可下载版本。</p>';
      return;
    }
    const q = String(filter || '').trim().toLowerCase();
    const items = state.remote.versions
      .filter((v) => !q || v.id.toLowerCase().includes(q))
      .slice(0, 80);
    if (!items.length) {
      list.innerHTML = '<p class="empty">没有匹配的版本。</p>';
      return;
    }
    list.innerHTML = items.map((v) => {
      const installed = state.installed.some((i) => i.id === v.id);
      const typeCls = v.type === 'snapshot' ? 'snapshot' : v.type === 'old_alpha' || v.type === 'old_beta' ? 'old' : '';
      return '<div class="version-item">' +
        '<div class="v-left">' +
          '<span class="v-id">' + esc(v.id) + '</span>' +
          '<span class="v-type ' + typeCls + '">' + esc(v.type) + '</span>' +
          '<span class="v-meta">' + esc((v.releaseTime || '').slice(0, 10)) + '</span>' +
        '</div>' +
        (installed
          ? '<span class="installed-tag">已安装</span>'
          : '<button class="btn btn-sm" data-install="' + esc(v.id) + '">安装</button>') +
      '</div>';
    }).join('');
  }

  async function refreshInstalled() {
    state.installed = await bmcl.listInstalled();
    renderInstalled();
    if (state.remote) renderRemote($('#dlFilter').value);
  }

  async function loadRemoteVersions() {
    const btn = $('#btnRefreshVersions');
    btn.disabled = true;
    btn.textContent = '加载中…';
    try {
      state.remote = await bmcl.listRemote();
      renderRemote($('#dlFilter').value);
      toast('已加载 ' + state.remote.versions.length + ' 个版本', 'ok');
    } catch (err) {
      $('#remoteVersions').innerHTML = '<p class="empty">版本清单加载失败：' + esc(err.message) + '（可能是网络/下载被禁止）</p>';
      toast('版本清单加载失败，请检查网络或切换下载源', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '刷新清单';
    }
  }

  async function installVersion(id) {
    if (state.installing) return;
    state.installing = true;
    $('#installProgress').classList.remove('hidden');
    $('#installStage').textContent = '准备安装 ' + id;
    $('#installCount').textContent = '';
    $('#installBar').style.width = '0%';
    try {
      await bmcl.installVersion(id);
      toast('版本 ' + id + ' 安装完成', 'ok');
      state.settings = await bmcl.saveSettings({ versionId: id });
      syncVersionLabel();
      await refreshInstalled();
    } catch (err) {
      toast('安装失败：' + err.message, 'error');
      $('#installStage').textContent = '安装失败：' + err.message;
    } finally {
      state.installing = false;
      setTimeout(() => $('#installProgress').classList.add('hidden'), 1200);
    }
  }

  async function launchGame(versionId) {
    const id = versionId || state.settings.versionId;
    if (!id) {
      toast('请先在「下载」页安装并选择一个版本', 'error');
      return;
    }
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

  function renderDiagnosis(target, report) {
    if (!report) { target.innerHTML = '<span class="tip">未发现崩溃记录。</span>'; return; }
    const causes = (report.causes || []).map((c) =>
      '<div class="cause">· ' + esc(c.cause) + '</div><div class="tip">建议：' + esc(c.suggestion) + '</div>'
    ).join('');
    const stack = (report.stack || []).length
      ? '<div class="diag-sub"><b>调用栈</b><br>' + report.stack.map((s) => esc(s)).join('<br>') + '</div>' : '';
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
          (result.release.notes ? '<div class="diag-sub">' + esc(result.release.notes).slice(0, 800) + '</div>' : '');
        showBanner('发现启动器新版本 ' + result.release.version + '，可在「设置」中更新（不会覆盖游戏文件）。', 'ok');
        toast('发现新版本 ' + result.release.version, 'ok');
      } else {
        $('#btnApplyUpdate').classList.add('hidden');
        $('#updateResult').innerHTML = '<span class="tip">已是最新版本（更新检查已自动关闭）</span>';
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

  async function saveSettings() {
    const payload = {
      playerName: $('#setPlayer').value.trim() || 'fft1145',
      memoryMB: Number($('#setMemory').value) || 2048,
      javaPath: $('#setJava').value.trim(),
      gameDir: $('#setGameDir').value.trim(),
      source: $('#setSource').value,
      autoUpdate: $('#setAutoUpdate').checked,
      crashWatch: $('#setCrashWatch').checked,
      checkDownloads: $('#setCheckDownloads').checked,
      versionId: state.settings.versionId || ''
    };
    state.settings = await bmcl.saveSettings(payload);
    applySettingsToForm(state.settings);
    syncVersionLabel();
    await refreshInstalled();
    $('#saveHint').textContent = '已保存';
    toast('设置已保存', 'ok');
    setTimeout(() => { $('#saveHint').textContent = ''; }, 2500);
  }

  async function probeJava() {
    $('#javaHint').textContent = '检测中…';
    const result = await bmcl.probeJava($('#setJava').value.trim());
    if (result.ok) {
      $('#javaHint').textContent = 'Java ' + result.version + '（主版本 ' + result.major + '）';
    } else {
      $('#javaHint').textContent = '未找到可用的 Java：' + (result.message || '');
    }
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
    state.activeAccount = data.accounts.find((a) => a.id === data.active) || state.accounts[0] || null;
    renderAccountList();
    applySettingsToForm(state.settings);
  }

  function renderAccountList() {
    const list = $('#accountList');
    if (!state.accounts.length) {
      list.innerHTML = '<p class="empty" style="padding:10px">暂无账号，请添加。</p>';
      return;
    }
    list.innerHTML = state.accounts.map((a) =>
      '<div class="ap-item' + (state.activeAccount && state.activeAccount.id === a.id ? ' active' : '') + '" data-acc="' + esc(a.id) + '">' +
        '<span class="ap-name">' + esc(a.name) + '</span>' +
        '<span style="font-size:10px;color:#8a9199">离线</span>' +
        '<button class="ap-del" data-del="' + esc(a.id) + '">删除</button>' +
      '</div>'
    ).join('');
  }

  async function addAccount() {
    const name = $('#newAccountName').value.trim();
    if (!name) { toast('请输入玩家名', 'error'); return; }
    try {
      await bmcl.addAccount(name);
      $('#newAccountName').value = '';
      await refreshAccounts();
      toast('账号 ' + name + ' 已添加并设为当前', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function setActiveAccount(id) {
    await bmcl.setActiveAccount(id);
    await refreshAccounts();
  }

  async function removeAccount(id) {
    await bmcl.removeAccount(id);
    await refreshAccounts();
    toast('账号已删除', 'ok');
  }

  // ===== 模组 =====
  async function searchMods() {
    const q = $('#modSearch').value.trim();
    const gv = $('#modGameVersion').value || undefined;
    const btn = $('#btnModSearch');
    btn.disabled = true; btn.textContent = '搜索中…';
    try {
      const results = await bmcl.searchMods(q, gv);
      state.modSearchResults = results;
      renderModResults(results);
      toast('找到 ' + results.length + ' 个模组', 'ok');
    } catch (err) {
      $('#modResults').innerHTML = '<p class="empty">搜索失败：' + esc(err.message) + '</p>';
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
        (m.iconUrl ? '<img class="mod-icon" src="' + esc(m.iconUrl) + '" alt="">' : '<div class="mod-icon"></div>') +
        '<div class="mod-info">' +
          '<div class="mod-title">' + esc(m.title) + '</div>' +
          '<div class="mod-desc">' + esc(m.description || '') + '</div>' +
          '<div class="mod-cats">' + (m.categories || []).slice(0, 4).map((c) => '<span class="mod-cat">' + esc(c) + '</span>').join('') + '</div>' +
          '<div class="mod-meta">作者：' + esc(m.author || '') + ' · 下载量：' + (m.downloads || 0).toLocaleString() + '</div>' +
        '</div>' +
        '<div class="mod-actions">' +
          '<button class="btn btn-sm" data-modview="' + esc(m.id) + '">查看版本</button>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  async function showModVersions(projectId) {
    const mod = state.modSearchResults.find((m) => m.id === projectId);
    const gv = $('#modGameVersion').value || state.settings.versionId || undefined;
    try {
      const versions = await bmcl.getModVersions(projectId, gv);
      const list = $('#modResults');
      if (!versions.length) {
        list.innerHTML = '<p class="empty">没有适配当前游戏版本的文件。</p>';
        return;
      }
      list.innerHTML = '<div class="version-item"><b>' + esc(mod ? mod.title : projectId) + ' — 可用版本</b></div>' +
        versions.map((v) =>
          '<div class="version-item">' +
            '<div class="v-left">' +
              '<span class="v-id">' + esc(v.versionNumber) + '</span>' +
              '<span class="v-meta">' + esc((v.gameVersions || []).join(', ')) + '</span>' +
              '<span class="v-meta">' + esc((v.loaders || []).join(', ')) + '</span>' +
            '</div>' +
            '<button class="btn btn-sm btn-primary" data-modinstall="' + esc(v.id) + '" data-fn="' + esc(v.fileName) + '" data-url="' + esc(v.fileUrl) + '" data-size="' + (v.fileSize || 0) + '">下载</button>' +
          '</div>'
        ).join('');
    } catch (err) {
      toast('获取模组版本失败：' + err.message, 'error');
    }
  }

  async function installModHandler(btn) {
    const modVersion = {
      id: btn.dataset.modinstall,
      fileName: btn.dataset.fn,
      fileUrl: btn.dataset.url,
      fileSize: Number(btn.dataset.size) || 0
    };
    btn.disabled = true; btn.textContent = '下载中…';
    try {
      await bmcl.installMod(modVersion);
      toast('模组 ' + modVersion.fileName + ' 安装完成', 'ok');
      await refreshInstalledMods();
    } catch (err) {
      toast('模组安装失败：' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '下载';
    }
  }

  async function refreshInstalledMods() {
    const list = $('#installedMods');
    if (!list) return;
    try {
      const mods = await bmcl.listInstalledMods();
      if (!mods.length) { list.innerHTML = '<p class="empty">尚未安装任何模组。</p>'; return; }
      list.innerHTML = mods.map((m) =>
        '<div class="version-item">' +
          '<div class="v-left">' +
            '<span class="v-id">' + esc(m.name) + '</span>' +
            '<span class="v-meta">' + (m.size / 1024 / 1024).toFixed(2) + ' MB</span>' +
          '</div>' +
          '<button class="btn btn-sm" data-openmoddir>打开目录</button>' +
        '</div>'
      ).join('');
    } catch (e) { list.innerHTML = '<p class="empty">读取模组列表失败。</p>'; }
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
    } catch (err) { toast('读取启动计数失败', 'error'); }
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
    try {
      const r = await bmcl.downloadFile(url, dir, name);
      toast('下载完成：' + (r.bytes / 1024 / 1024).toFixed(2) + ' MB', 'ok');
    } catch (err) { toast('下载失败：' + err.message, 'error'); }
  }

  async function pickSaveDir() {
    // 使用 Electron 的 dialog 选择目录
    try {
      const dir = await bmcl.downloadFile('', '', '');
    } catch (e) {}
    // 简单方案：用 input[type=file] webkitdirectory 不可靠，这里提示用户手动输入
    toast('请在「保存到」输入框中手动填写目录路径', 'error');
  }

  async function openCustomDir() {
    if (bmcl && bmcl.openGameDir) bmcl.openGameDir();
  }

  async function downloadSkin() {
    const name = $('#skinPlayer').value.trim();
    if (!name) { toast('请输入玩家名', 'error'); return; }
    try {
      const r = await bmcl.downloadSkin(name);
      toast('皮肤已下载到 skins/' + name + '.png', 'ok');
    } catch (err) { toast('下载皮肤失败：' + err.message, 'error'); }
  }

  async function netTest() {
    $('#netTestResult').innerHTML = '<span class="tip">测试中…</span>';
    try {
      const result = await bmcl.checkNetwork();
      if (result.allowed) {
        $('#netTestResult').innerHTML = '<span class="tip">网络正常（HTTP ' + result.status + '）</span>';
        toast('网络测试通过', 'ok');
      } else {
        $('#netTestResult').innerHTML = '<span class="cause">网络不可用：' + esc(result.reason || '') + '</span>';
        toast('网络测试失败', 'error');
      }
    } catch (err) {
      $('#netTestResult').innerHTML = '<span class="cause">测试失败：' + esc(err.message) + '</span>';
    }
  }

  // ===== 联机大厅 =====
  async function lobbyJoin() {
    const code = $('#lobbyCode').value.trim();
    if (!code) { toast('请输入大厅编号', 'error'); return; }
    toast('联机功能开发中（编号：' + code + '）', 'error');
  }
  async function lobbyCreate() {
    const inst = $('#lobbyInstance').value;
    if (!inst) { toast('请选择实例', 'error'); return; }
    toast('创建大厅功能开发中', 'error');
  }
  async function refreshLobbyInstances() {
    const sel = $('#lobbyInstance');
    sel.innerHTML = '<option value="">（请选择实例）</option>';
    for (const v of state.installed) {
      const opt = document.createElement('option');
      opt.value = v.id; opt.textContent = v.id;
      sel.appendChild(opt);
    }
    toast('已刷新实例列表', 'ok');
  }

  // ===== 游戏目录扫描 =====
  async function scanGameDirs() {
    try {
      const dirs = await bmcl.scanGameDirs();
      if (!dirs.length) { toast('未检测到已有的 Minecraft 安装目录', 'error'); return; }
      const input = $('#setGameDir');
      const choice = dirs[0].path;
      input.value = choice;
      toast('已选择：' + dirs[0].label + '（' + choice + '）。点击「保存设置」生效。', 'ok');
    } catch (err) { toast('扫描失败：' + err.message, 'error'); }
  }

  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.page));
    });
    document.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.goto));
    });

    // 设置/工具子页切换
    document.querySelectorAll('.set-cat').forEach((cat) => {
      cat.addEventListener('click', () => {
        const page = cat.closest('.page');
        switchSub(page.id.replace('page-', ''), cat.dataset.sub);
      });
    });

    // 下载页分类：模组与 Minecraft 切换面板
    document.querySelectorAll('.dl-cat').forEach((cat) => {
      cat.addEventListener('click', () => {
        const parent = cat.parentElement;
        parent.querySelectorAll('.dl-cat').forEach((c) => c.classList.remove('active'));
        cat.classList.add('active');
        const isMod = cat.dataset.cat === 'mods2' || cat.dataset.cat === 'modpacks';
        $('#mcPanel').classList.toggle('hidden', isMod);
        $('#modPanel').classList.toggle('hidden', !isMod);
        if (isMod) refreshInstalledMods();
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

    $('#btnLaunch').addEventListener('click', () => launchGame());
    $('#btnStop').addEventListener('click', stopGame);
    ['#btnOpenDir2', '#btnOpenDir3', '#btnOpenDir4'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('click', () => bmcl.openGameDir());
    });
    $('#btnClearLog').addEventListener('click', () => { $('#gameLog').textContent = ''; });
    $('#btnClearLog2').addEventListener('click', () => { $('#gameLog2').textContent = ''; });
    $('#btnCloseCrash').addEventListener('click', () => { $('#crashBox').hidden = true; });
    $('#btnNoticeClose').addEventListener('click', () => { $('#noticeCard').classList.add('hidden'); });

    $('#btnRefreshVersions').addEventListener('click', loadRemoteVersions);
    $('#dlFilter').addEventListener('input', (e) => renderRemote(e.target.value));

    $('#remoteVersions').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-install]');
      if (btn) installVersion(btn.dataset.install);
    });
    $('#installedVersions').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-launch]');
      if (btn) {
        state.settings.versionId = btn.dataset.launch;
        syncVersionLabel();
        switchPage('launch');
        launchGame(btn.dataset.launch);
      }
    });

    $('#btnSaveSettings').addEventListener('click', saveSettings);
    $('#btnProbeJava').addEventListener('click', probeJava);
    $('#btnCheckNet').addEventListener('click', checkNet);
    $('#btnCheckUpdate').addEventListener('click', checkUpdate);
    $('#btnApplyUpdate').addEventListener('click', applyUpdate);
    $('#btnDiagnose').addEventListener('click', diagnoseNow);
    $('#btnRepairScan').addEventListener('click', scanRepair);
    $('#btnRepairRun').addEventListener('click', runRepair);
    $('#btnScanGameDir').addEventListener('click', scanGameDirs);

    $('#setSource').addEventListener('change', () => { state.remote = null; renderRemote(''); });

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

    // 编辑资料（玩家名）
    $('#btnEditProfile').addEventListener('click', () => {
      $('#accountPanel').classList.remove('hidden');
      toast('在下方输入新玩家名并点击「添加」即可切换账号', 'ok');
    });

    // 皮肤
    $('#btnSkin').addEventListener('click', () => toast('皮肤与披风功能开发中', 'error'));

    // 模组
    $('#btnModSearch').addEventListener('click', searchMods);
    $('#modSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMods(); });
    $('#btnRefreshMods').addEventListener('click', refreshInstalledMods);
    $('#modResults').addEventListener('click', (e) => {
      const view = e.target.closest('[data-modview]');
      if (view) { showModVersions(view.dataset.modview); return; }
      const inst = e.target.closest('[data-modinstall]');
      if (inst) installModHandler(inst);
    });
    $('#installedMods').addEventListener('click', (e) => {
      if (e.target.closest('[data-openmoddir]')) bmcl.openGameDir();
    });

    // 联机大厅
    $('#btnLobbyClear').addEventListener('click', () => { $('#lobbyCode').value = ''; });
    $('#btnLobbyPaste').addEventListener('click', async () => {
      try {
        if (navigator.clipboard) $('#lobbyCode').value = await navigator.clipboard.readText();
        else toast('无法读取剪贴板，请手动粘贴', 'error');
      } catch { toast('无法读取剪贴板，请手动粘贴', 'error'); }
    });
    $('#btnLobbyJoin').addEventListener('click', lobbyJoin);
    $('#btnLobbyManual').addEventListener('click', () => toast('手动输入端口功能开发中', 'error'));
    $('#btnLobbyRefresh').addEventListener('click', refreshLobbyInstances);
    $('#btnLobbyCreate').addEventListener('click', lobbyCreate);

    // 百宝箱
    $('#btnCleanJunk').addEventListener('click', cleanJunk);
    $('#btnFortune').addEventListener('click', () => {
      const fortunes = ['大吉', '中吉', '小吉', '吉', '末吉', '凶'];
      toast('今日人品：' + fortunes[Math.floor(Math.random() * fortunes.length)], 'ok');
    });
    $('#btnShortcut').addEventListener('click', createShortcut);
    $('#btnLaunchCount').addEventListener('click', showLaunchCount);

    // 下载自定义文件
    $('#btnPickSaveDir').addEventListener('click', pickSaveDir);
    $('#btnCustomDownload').addEventListener('click', customDownload);
    $('#btnOpenCustomDir').addEventListener('click', openCustomDir);

    // 下载皮肤
    $('#btnDownloadSkin').addEventListener('click', downloadSkin);

    // 网络测试
    $('#btnNetTest').addEventListener('click', netTest);
  }

  function bindBridgeEvents() {
    bmcl.onLog((entry) => {
      if (entry && entry.level === 'error') appendGameLog('[启动器] ' + entry.message + '\n');
    });
    bmcl.onGameLog((entry) => {
      if (entry && entry.text) appendGameLog(entry.text);
    });
    bmcl.onGameState((payload) => {
      state.running = Boolean(payload && payload.running);
      setState(state.running, state.running ? '游戏运行中' : '未启动');
      if (!state.running && payload && payload.code === 0) appendGameLog('[游戏已退出]\n');
      if (!state.running && payload && payload.code != null && payload.code !== 0) {
        appendGameLog('[游戏异常退出，退出码 ' + payload.code + ']\n');
      }
    });
    bmcl.onGameCrash((report) => { openCrashPanel(report); toast('游戏崩溃，已生成诊断', 'error'); });
    bmcl.onInstallProgress((p) => {
      $('#installProgress').classList.remove('hidden');
      $('#installStage').textContent = p.stage || '安装中';
      $('#installCount').textContent = p.total ? p.done + ' / ' + p.total : '';
      $('#installBar').style.width = p.total ? Math.min(100, (p.done / p.total) * 100) + '%' : '0%';
    });
    bmcl.onUpdateProgress((p) => {
      $('#updateResult').textContent = '正在应用更新 ' + p.done + ' / ' + p.total;
    });
    bmcl.onDownloadProgress((p) => {
      // 通用下载进度（模组/自定义文件）— 暂用 toast 提示
    });
  }

  async function boot() {
    if (!bmcl) { showBanner('未检测到 Electron 环境：请用 npm start 运行启动器。', 'error'); return; }
    state.info = await bmcl.info();
    state.settings = await bmcl.getSettings();
    $('#sideVersion').textContent = 'v' + state.info.version;
    $('#updVersion').textContent = 'v' + state.info.version;
    const v2 = $('#updVersion2'); if (v2) v2.textContent = 'v' + state.info.version;
    await refreshAccounts();
    applySettingsToForm(state.settings);
    setState(false, '未启动');
    bindEvents();
    bindBridgeEvents();
    await refreshInstalled();

    const preflight = await bmcl.preflight();
    state.preflight = preflight;

    if (preflight.selfCheck && !preflight.selfCheck.ok) {
      const bad = preflight.selfCheck.checks.filter((c) => !c.ok).map((c) => c.name).join('、');
      showBanner('启动器自检未通过：' + bad + '（可尝试重新安装启动器，游戏文件不受影响）', 'error');
    }
    if (preflight.crash && preflight.crash.launcherCrashed) {
      openCrashPanel(preflight.crash);
      showBanner('检测到上次启动器异常退出，已自动生成诊断。', 'error');
      const before = preflight.crash;
      $('#crashSettingsResult').innerHTML = '<span class="cause">上次启动器异常退出（' + esc((before.startedAt || '').slice(0, 16).replace('T', ' ')) + '）</span>';
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
        showBanner('发现启动器新版本 ' + preflight.update.release.version + '，可在「设置」中更新。', 'ok');
        $('#btnApplyUpdate').classList.remove('hidden');
        $('#updateResult').innerHTML = '<div><b>发现新版本 ' + esc(preflight.update.release.version) + '</b></div>' +
          (preflight.update.release.notes ? '<div class="diag-sub">' + esc(preflight.update.release.notes) + '</div>' : '');
      } else {
        $('#updateResult').innerHTML = '<span class="tip">已是最新版本（已自动关闭更新）</span>';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
