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
    // 设置/工具页：激活第一个子页
    if (name === 'settings' || name === 'tools') {
      const page = $('#page-' + name);
      const firstCat = page.querySelector('.set-cat');
      if (firstCat) switchSub(name, firstCat.dataset.sub);
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
    $('#topAccount').textContent = s.playerName || 'fft1145';
    updateAvatar(s.playerName);
  }

  function renderInstalled() {
    const list = $('#installedVersions');
    if (!state.installed.length) {
      list.innerHTML = '<p class="empty">还没有安装任何版本。</p>';
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
    // 同步到设置页日志
    const el2 = $('#gameLog2');
    if (el2) {
      el2.textContent = el.textContent;
      el2.scrollTop = el2.scrollHeight;
    }
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
      versionId: state.settings.versionId || ''
    };
    state.settings = await bmcl.saveSettings(payload);
    applySettingsToForm(state.settings);
    syncVersionLabel();
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
    btn.disabled = true;
    btn.textContent = '修复中…';
    try {
      const result = await bmcl.runRepair();
      state.repair = result;
      renderRepair(result, 'fixed');
      state.settings = await bmcl.getSettings();
      applySettingsToForm(state.settings);
      await refreshInstalled();
      syncVersionLabel();
      if (result.failed > 0) {
        toast('修复完成，' + result.failed + ' 项需要手动处理', 'error');
      } else {
        toast('修复完成，共修复 ' + result.fixed + ' 项', 'ok');
      }
    } catch (err) {
      toast('修复失败：' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '一键修复';
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
      $('#repairState').textContent = failed > 0
        ? failed + ' 项需手动处理'
        : (pending ? pending + ' 项待修复' : '全部正常');
      $('#btnRepairRun').classList.toggle('hidden', pending === 0);
    }
  }

  // ===== 工具页占位功能 =====
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
  async function cleanJunk() {
    toast('清理游戏垃圾功能开发中', 'error');
  }
  function showFortune() {
    const fortunes = ['大吉', '中吉', '小吉', '吉', '末吉', '凶'];
    const f = fortunes[Math.floor(Math.random() * fortunes.length)];
    toast('今日人品：' + f, 'ok');
  }
  async function createShortcut() {
    toast('创建快捷方式功能开发中', 'error');
  }
  function showLaunchCount() {
    toast('启动计数功能开发中', 'error');
  }
  async function customDownload() {
    const url = $('#customUrl').value.trim();
    if (!url) { toast('请输入下载地址', 'error'); return; }
    toast('自定义下载功能开发中', 'error');
  }
  async function pickSaveDir() {
    toast('选择保存目录功能开发中', 'error');
  }
  async function openCustomDir() {
    if (bmcl && bmcl.openGameDir) bmcl.openGameDir();
  }
  async function downloadSkin() {
    const name = $('#skinPlayer').value.trim();
    if (!name) { toast('请输入玩家名', 'error'); return; }
    toast('下载皮肤功能开发中（玩家：' + name + '）', 'error');
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
  async function editProfile() {
    const name = prompt('请输入新的玩家名：', state.settings.playerName || 'fft1145');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) { toast('玩家名不能为空', 'error'); return; }
    state.settings = await bmcl.saveSettings({ playerName: trimmed });
    applySettingsToForm(state.settings);
    toast('玩家名已更新为 ' + trimmed, 'ok');
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
        const pageName = page.id.replace('page-', '');
        switchSub(pageName, cat.dataset.sub);
      });
    });

    // 下载页分类高亮（仅 UI）
    document.querySelectorAll('.dl-cat').forEach((cat) => {
      cat.addEventListener('click', () => {
        const parent = cat.parentElement;
        parent.querySelectorAll('.dl-cat').forEach((c) => c.classList.remove('active'));
        cat.classList.add('active');
      });
    });

    // 下载页版本组折叠
    document.querySelectorAll('.vg-toggle').forEach((tg) => {
      tg.addEventListener('click', () => {
        const group = tg.closest('.version-group');
        const body = group.querySelector('.vg-body');
        const collapsed = body.classList.toggle('collapsed');
        group.classList.toggle('collapsed', collapsed);
      });
    });

    // 窗口按钮（无最大化）
    [['winMin', 'winMinimize'], ['winClose', 'winClose']].forEach(([id, fn]) => {
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

    $('#setSource').addEventListener('change', () => {
      state.remote = null;
      renderRemote('');
    });

    // 玩家账号操作
    $('#btnSkin').addEventListener('click', () => toast('皮肤与披风功能开发中', 'error'));
    $('#btnEditProfile').addEventListener('click', editProfile);
    $('#btnSwitchAccount').addEventListener('click', () => toast('切换账号功能开发中', 'error'));

    // 联机大厅
    $('#btnLobbyClear').addEventListener('click', () => { $('#lobbyCode').value = ''; });
    $('#btnLobbyPaste').addEventListener('click', async () => {
      try {
        if (navigator.clipboard) {
          const text = await navigator.clipboard.readText();
          $('#lobbyCode').value = text;
        } else {
          toast('无法读取剪贴板，请手动粘贴', 'error');
        }
      } catch { toast('无法读取剪贴板，请手动粘贴', 'error'); }
    });
    $('#btnLobbyJoin').addEventListener('click', lobbyJoin);
    $('#btnLobbyManual').addEventListener('click', () => toast('手动输入端口功能开发中', 'error'));
    $('#btnLobbyRefresh').addEventListener('click', refreshLobbyInstances);
    $('#btnLobbyCreate').addEventListener('click', lobbyCreate);

    // 百宝箱
    $('#btnCleanJunk').addEventListener('click', cleanJunk);
    $('#btnFortune').addEventListener('click', showFortune);
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
    const v2 = $('#updVersion2');
    if (v2) v2.textContent = 'v' + state.info.version;
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
