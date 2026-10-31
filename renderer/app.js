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
    pendingUpdate: null
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
  function hideBanner() {
    $('#banner').classList.add('hidden');
  }

  function switchPage(name) {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
    if (name === 'download' && !state.remote) loadRemoteVersions();
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
    const sel = $('#launchVersion');
    const label = $('#launchVersionLabel');
    if (!sel || !label) return;
    const opt = sel.options[sel.selectedIndex];
    label.textContent = sel.value && opt ? opt.textContent : '未选择版本';
  }

  function applySettingsToForm(s) {
    $('#setPlayer').value = s.playerName || '';
    $('#launchPlayer').value = s.playerName || '';
    $('#setMemory').value = s.memoryMB || 2048;
    $('#setJava').value = s.javaPath || '';
    $('#setGameDir').value = s.gameDir || '';
    $('#setSource').value = s.source || 'bmclapi';
    $('#setAutoUpdate').checked = Boolean(s.autoUpdate);
    $('#setCrashWatch').checked = Boolean(s.crashWatch);
    $('#setCheckDownloads').checked = Boolean(s.checkDownloads);
    $('#topAccount').textContent = s.playerName || 'fft1145';
    $('#topSource').textContent = s.source === 'official' ? '官方源' : 'BMCLAPI';
    updateAvatar(s.playerName);
  }

  function renderInstalled() {
    const select = $('#launchVersion');
    const prev = select.value;
    select.innerHTML = '';
    if (!state.installed.length) {
      select.innerHTML = '<option value="">（暂无已安装版本）</option>';
      $('#launchHint').textContent = '还没有安装版本，请到「下载」页安装一个。';
    } else {
      for (const v of state.installed) {
        const option = document.createElement('option');
        option.value = v.id;
        option.textContent = v.id + '（' + v.type + '）';
        select.appendChild(option);
      }
      if (prev && state.installed.some((v) => v.id === prev)) select.value = prev;
      else if (state.settings.versionId && state.installed.some((v) => v.id === state.settings.versionId)) {
        select.value = state.settings.versionId;
      }
      $('#launchHint').textContent = '选择版本后点击「启动游戏」。首次启动前请确认 Java 路径。';
    }

    const list = $('#installedVersions');
    syncVersionLabel();
    if (!state.installed.length) {
      list.innerHTML = '<p class="empty">还没有安装任何版本。</p>';
      return;
    }
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
      await refreshInstalled();
      $('#launchVersion').value = id;
    } catch (err) {
      toast('安装失败：' + err.message, 'error');
      $('#installStage').textContent = '安装失败：' + err.message;
    } finally {
      state.installing = false;
      setTimeout(() => $('#installProgress').classList.add('hidden'), 1200);
    }
  }

  async function launchGame() {
    const id = $('#launchVersion').value;
    if (!id) {
      toast('请先安装并选择一个版本', 'error');
      return;
    }
    const player = $('#launchPlayer').value.trim();
    if (player && player !== state.settings.playerName) {
      state.settings = await bmcl.saveSettings({ playerName: player });
      applySettingsToForm(state.settings);
    }
    $('#gameLog').textContent = '';
    $('#launchHint').textContent = '正在启动…';
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
    try {
      await bmcl.stop();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function appendGameLog(text) {
    const el = $('#gameLog');
    el.textContent += text;
    if (el.textContent.length > 400000) el.textContent = el.textContent.slice(-300000);
    el.scrollTop = el.scrollHeight;
  }

  function renderDiagnosis(target, report) {
    if (!report) {
      target.innerHTML = '<span class="tip">未发现崩溃记录。</span>';
      return;
    }
    const causes = (report.causes || []).map((c) =>
      '<div class="cause">· ' + esc(c.cause) + '</div><div class="tip">建议：' + esc(c.suggestion) + '</div>'
    ).join('');
    const stack = (report.stack || []).length
      ? '<div class="diag-sub"><b>调用栈</b><br>' + report.stack.map((s) => esc(s)).join('<br>') + '</div>'
      : '';
    target.innerHTML =
      '<div><b>诊断：</b>' + esc(report.summary || '') + '</div>' +
      (causes ? '<div class="diag-sub">' + causes + '</div>' : '') +
      stack +
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
          (result.release.notes ? '<div class="diag-sub">' + esc(result.release.notes).slice(0, 600) + '</div>' : '');
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
    btn.disabled = true;
    btn.textContent = '更新中…';
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
      btn.disabled = false;
      btn.textContent = '立即更新';
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
      versionId: $('#launchVersion').value || state.settings.versionId || ''
    };
    state.settings = await bmcl.saveSettings(payload);
    applySettingsToForm(state.settings);
    $('#saveHint').textContent = '已保存';
    toast('设置已保存', 'ok');
    setTimeout(() => { $('#saveHint').textContent = ''; }, 2500);
  }

  async function probeJava() {
    const javaPath = $('#setJava').value.trim();
    $('#javaHint').textContent = '检测中…';
    const result = await bmcl.probeJava(javaPath);
    if (result.ok) {
      $('#javaHint').textContent = 'Java ' + result.version + '（主版本 ' + result.major + '）';
    } else {
      $('#javaHint').textContent = '未找到可用的 Java：' + (result.message || '');
    }
  }

  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.page));
    });

    document.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => switchPage(btn.dataset.goto));
    });

    [['winMin', 'winMinimize'], ['winMax', 'winMaximize'], ['winClose', 'winClose']].forEach(([id, fn]) => {
      const el = document.getElementById(id);
      if (el && bmcl && typeof bmcl[fn] === 'function') {
        el.addEventListener('click', () => bmcl[fn]());
      }
    });

    document.querySelectorAll('[data-open]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        bmcl.openExternal(el.dataset.open);
      });
    });

    $('#btnLaunch').addEventListener('click', launchGame);
    $('#btnStop').addEventListener('click', stopGame);
    ['#btnOpenDir', '#btnOpenDir2', '#btnOpenDir3', '#btnOpenDir4'].forEach((sel) => {
      $(sel).addEventListener('click', () => bmcl.openGameDir());
    });
    $('#btnClearLog').addEventListener('click', () => { $('#gameLog').textContent = ''; });
    $('#btnCloseCrash').addEventListener('click', () => { $('#crashBox').hidden = true; });

    $('#btnRefreshVersions').addEventListener('click', loadRemoteVersions);
    $('#dlFilter').addEventListener('input', (e) => renderRemote(e.target.value));

    $('#remoteVersions').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-install]');
      if (btn) installVersion(btn.dataset.install);
    });
    $('#installedVersions').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-launch]');
      if (btn) {
        $('#launchVersion').value = btn.dataset.launch;
        switchPage('launch');
        launchGame();
      }
    });

    $('#btnSaveSettings').addEventListener('click', saveSettings);
    $('#btnProbeJava').addEventListener('click', probeJava);
    $('#btnCheckNet').addEventListener('click', checkNet);
    $('#btnCheckUpdate').addEventListener('click', checkUpdate);
    $('#btnApplyUpdate').addEventListener('click', applyUpdate);
    $('#btnDiagnose').addEventListener('click', diagnoseNow);

    $('#setSource').addEventListener('change', () => {
      state.remote = null;
      renderRemote('');
    });
    $('#launchPlayer').addEventListener('change', async () => {
      const name = $('#launchPlayer').value.trim();
      if (!name) return;
      state.settings = await bmcl.saveSettings({ playerName: name });
      applySettingsToForm(state.settings);
    });
    $('#launchVersion').addEventListener('change', async () => {
      state.settings = await bmcl.saveSettings({ versionId: $('#launchVersion').value });
      syncVersionLabel();
    });
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
    bmcl.onGameCrash((report) => {
      openCrashPanel(report);
      toast('游戏崩溃，已生成诊断', 'error');
    });
    bmcl.onInstallProgress((p) => {
      $('#installProgress').classList.remove('hidden');
      $('#installStage').textContent = p.stage || '安装中';
      $('#installCount').textContent = p.total ? p.done + ' / ' + p.total : '';
      $('#installBar').style.width = p.total ? Math.min(100, (p.done / p.total) * 100) + '%' : '0%';
    });
    bmcl.onUpdateProgress((p) => {
      $('#updateResult').textContent = '正在应用更新 ' + p.done + ' / ' + p.total;
    });
  }

  async function boot() {
    if (!bmcl) {
      showBanner('未检测到 Electron 环境：请用 npm start 运行启动器。', 'error');
      return;
    }
    state.info = await bmcl.info();
    state.settings = await bmcl.getSettings();
    $('#sideVersion').textContent = 'v' + state.info.version;
    $('#updVersion').textContent = 'v' + state.info.version;
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
      $('#crashSettingsResult').innerHTML = '<span class="cause">上次启动器异常退出（' +
        esc((before.startedAt || '').slice(0, 16).replace('T', ' ')) + '）</span>';
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
        $('#updateResult').innerHTML = '<div><b>发现新版本 ' + esc(preflight.update.release.version) + '</b></div>';
      } else {
        $('#updateResult').innerHTML = '<span class="tip">已是最新版本（已自动关闭更新）</span>';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
