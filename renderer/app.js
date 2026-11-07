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
    repair: null,
    msLogin: null,
    versionShown: { release: 200, snapshot: 200, old: 200, april: 200 }
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
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    const target = $('#page-' + name);
    if (target) {
      target.classList.add('active');
      // 强制重排以重放进入动画
      void target.offsetWidth;
      target.style.animation = 'none';
      void target.offsetWidth;
      target.style.animation = '';
    }
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
    if (av) {
      av.onerror = () => { av.onerror = null; av.src = '../build/icon.png'; };
      av.src = 'https://mc-heads.net/avatar/' + encodeURIComponent(name || 'fft1145') + '/96';
    }
    const body = $('#playerBody');
    if (body) {
      body.onerror = () => { body.onerror = null; };
      body.src = 'https://mc-heads.net/body/' + encodeURIComponent(name || 'fft1145') + '/right';
    }
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

  // ===== GUI 主题 =====
  function applyTheme(theme) {
    const bmcl = theme === 'bmcl';
    document.body.classList.toggle('theme-bmcl', bmcl);
    const dash = $('#bmclDashboard');
    if (dash) dash.classList.toggle('hidden', !bmcl);
    // 同步设置页里的单选
    const radios = document.querySelectorAll('input[name="uiTheme"]');
    radios.forEach((r) => { r.checked = (r.value === theme); });
    if (bmcl) {
      const cur = document.querySelector('.page.active');
      const ok = cur && /^page-(util|manage|download|account|settings)$/.test(cur.id);
      if (!ok) switchPage('util');
      renderBmclDashboard();
    } else {
      const cur = document.querySelector('.page.active');
      if (cur && /^page-(util|manage|account)$/.test(cur.id)) switchPage('launch');
    }
  }

  // BMCL 模式专属仪表盘
  async function renderBmclDashboard() {
    const mem = $('#bmclMemory');
    if (mem) mem.textContent = (state.settings.memoryMB || 2048) + ' MB';
    const vEl = $('#bmclVersions');
    if (vEl) vEl.textContent = String((state.gameState.versions || []).length);

    // Java（异步探测，避免阻塞）
    const jEl = $('#bmclJava');
    if (jEl) {
      try {
        const j = await bmcl.probeJava(state.settings.javaPath || '');
        jEl.textContent = j && j.ok ? (j.version || '已就绪') : (j && j.message ? j.message : '未找到');
        jEl.style.color = j && j.ok ? '' : '';
      } catch (e) { jEl.textContent = '探测失败'; }
    }

    // 启动计数
    const lEl = $('#bmclLaunches');
    if (lEl) {
      try { lEl.textContent = String(await bmcl.getLaunchCount()); } catch (e) { lEl.textContent = '0'; }
    }

    // 快捷启动列表
    const list = $('#bmclQuickList');
    if (!list) return;
    const versions = (state.gameState.versions || []).slice(0, 6);
    if (!versions.length) {
      list.innerHTML = '<div class="bmcl-quick-empty">还没有已安装的版本</div>';
      return;
    }
    list.innerHTML = versions.map((v) =>
      '<div class="bmcl-quick-item" data-quick="' + esc(v.id) + '">' +
        '<span class="bmcl-quick-id">' + esc(v.id) + '</span>' +
        '<span class="bmcl-quick-type">' + esc(v.type || 'release') + '</span>' +
      '</div>'
    ).join('');
  }

  function applySettingsToForm(s) {
    $('#setPlayer').value = s.playerName || '';
    $('#setMemory').value = s.memoryMB || 2048;
    $('#setJava').value = s.javaPath || '';
    $('#setGameDir').value = s.gameDir || '';
    $('#setSource').value = s.source || 'bmclapi';
    if ($('#setCurseKey')) $('#setCurseKey').value = s.curseForgeApiKey || '';
    if ($('#setMsClientId')) $('#setMsClientId').value = s.msClientId || '';
    $('#setAutoUpdate').checked = Boolean(s.autoUpdate);
    $('#setCrashWatch').checked = Boolean(s.crashWatch);
    $('#setCheckDownloads').checked = Boolean(s.checkDownloads);
    applyTheme(s.uiTheme || 'pcl');
    syncAccountCard();
    syncVersionLabel();
  }

  // ===== 游戏目录 / 已安装版本 =====
  function renderGameDirState() {
    const gs = state.gameState;
    const lines = [];
    lines.push('<div><b>当前目录：</b>' + esc(gs.gameDir || '(未设置)') + '</div>');
    lines.push('<div class="tip">识别到 ' + (gs.versions.length || 0) + ' 个版本' + (gs.valid ? '' : '（该目录下没有可识别的版本，可直接选择 versions 或某个版本文件夹）') + '</div>');
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
    populatePackGames();
    if (document.body.classList.contains('theme-bmcl') && typeof renderBmclDashboard === 'function') renderBmclDashboard();
    document.dispatchEvent(new CustomEvent('bmcl:versions'));
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
      const dir = await bmcl.pickDirectory('选择 .minecraft、versions 或版本文件夹');
      if (!dir) return;
      const applied = await bmcl.setGameDir(dir);
      state.gameState = applied;
      state.settings = await bmcl.getSettings();
      applySettingsToForm(state.settings);
      await refreshInstalled();
      if (applied.versions.length) {
        toast('已设置游戏目录，识别到 ' + applied.versions.length + ' 个版本', 'ok');
      } else {
        toast('目录已设置，但没有识别到版本（需要 <版本>/<版本>.json）', 'error');
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
      const total = groups[key].length;
      if (count) count.textContent = '(' + total + ')';
      if (!body) continue;
      if (!total) {
        body.innerHTML = '<p class="empty">没有匹配的版本。</p>';
        continue;
      }
      const shown = Math.min(state.versionShown[key] || 200, total);
      const items = groups[key].slice(0, shown).map((v) => versionItem(v, installedIds.has(v.id))).join('');
      let more = '';
      if (shown < total) {
        const remain = total - shown;
        more = '<div class="row" style="margin-top:8px"><button class="btn btn-sm" data-vmore="' + key + '">显示更多（还有 ' + remain + ' 个）</button></div>';
      }
      body.innerHTML = items + more;
    }
  }

  function showMoreVersions(key) {
    if (!key || !state.versionShown) return;
    state.versionShown[key] = (state.versionShown[key] || 200) + 200;
    renderRemote($('#dlFilter') ? $('#dlFilter').value : '');
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
    const packStatus = $('#packStatus');
    if (packStatus && $('#packNoticePanel') && !$('#packNoticePanel').classList.contains('hidden')) {
      packStatus.textContent = (stage || '安装中') + (total ? ' — ' + done + ' / ' + total : '');
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
      title: 'Forge 安装',
      hint: '下载官方 installer.jar 并执行 --installClient',
      body: '会先确保原版已安装，再运行 Forge 官方安装器；安装完成后自动识别新版本并设为当前实例。',
      url: 'https://files.minecraftforge.net/net/minecraftforge/forge/'
    },
    neoforge: {
      title: 'NeoForge 安装',
      hint: '下载官方 installer.jar 并执行 --installClient',
      body: '会先确保原版已安装，再运行 NeoForge 官方安装器；安装完成后自动识别新版本并设为当前实例。',
      url: 'https://neoforged.net/'
    },
    optifine: {
      title: 'OptiFine 安装',
      hint: '下载官方安装器并执行 --installClient',
      body: '会先确保原版已安装，再运行 OptiFine 官方安装器给客户端 jar 打补丁；安装完成后自动识别新版本并设为当前实例。',
      url: 'https://optifine.net/downloads'
    }
  };

  function showPackNotice(kind) {
    state.packKind = kind === 'neoforge' ? 'neoforge' : (kind === 'optifine' ? 'optifine' : 'forge');
    const info = PACK_NOTICES[state.packKind];
    $('#packNoticeTitle').textContent = info.title;
    $('#packNoticeHint').textContent = info.hint;
    $('#packNoticeBody').textContent = info.body;
    $('#packStatus').textContent = '';
    // 所有类型都显示安装表单
    $('#packForm').classList.remove('hidden');
    $('#btnPackOpenSite').onclick = () => bmcl.openExternal(info.url);
    populatePackGames();
  }

  function populatePackGames() {
    const sel = $('#packGame');
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

  async function loadPackLoaders() {
    const game = $('#packGame').value;
    if (!game) { toast('请先选择游戏版本', 'error'); return; }
    const sel = $('#packLoaderVer');
    try {
      sel.innerHTML = '<option value="">加载中…</option>';
      const list = state.packKind === 'optifine'
        ? await bmcl.listOptifineLoaders(game)
        : await bmcl.listForgeLoaders(game, state.packKind);
      if (!list.length) { sel.innerHTML = '<option value="">该版本没有可用安装器</option>'; return; }
      sel.innerHTML = '<option value="">自动选择最新</option>' + list.map((item) =>
        '<option value="' + esc(item.version) + '">' + esc(item.version) + (item.tag ? '（' + item.tag + '）' : '') + '</option>'
      ).join('');
    } catch (err) {
      sel.innerHTML = '<option value="">获取失败：' + esc(err.message) + '</option>';
    }
  }

  async function installPack() {
    const kind = state.packKind || 'forge';
    const game = $('#packGame').value;
    if (!game) { toast('请先选择游戏版本', 'error'); return; }
    if (state.installing) return;
    const version = $('#packLoaderVer').value;
    state.installing = true;
    $('#packStatus').textContent = '准备安装 ' + kind + '（' + game + '）…';
    $('#btnPackInstall').disabled = true;
    try {
      const result = kind === 'optifine'
        ? await bmcl.installOptifine(game, version)
        : await bmcl.installForge(game, kind, version);
      toast(kind + ' 安装完成：' + result.versionId, 'ok');
      $('#packStatus').textContent = '安装完成：' + result.versionId + '，已设为当前实例。';
      state.settings = await bmcl.getSettings();
      await refreshInstalled(true);
      syncVersionLabel();
      populatePackGames();
    } catch (err) {
      toast(kind + ' 安装失败：' + err.message, 'error');
      $('#packStatus').textContent = '安装失败：' + err.message;
    } finally {
      state.installing = false;
      $('#btnPackInstall').disabled = false;
    }
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
      curseForgeApiKey: $('#setCurseKey') ? $('#setCurseKey').value.trim() : '',
      msClientId: $('#setMsClientId') ? $('#setMsClientId').value.trim() : '',
      autoUpdate: $('#setAutoUpdate').checked,
      crashWatch: $('#setCrashWatch').checked,
      checkDownloads: $('#setCheckDownloads').checked,
      uiTheme: (document.querySelector('input[name="uiTheme"]:checked') || {}).value || 'pcl',
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
    const input = $('#setJava').value.trim();
    const result = await bmcl.probeJava(input);
    if (result.ok) {
      const resolved = result.javaPath && result.javaPath !== input ? ' · ' + result.javaPath : '';
      $('#javaHint').textContent = 'Java ' + result.version + '（主版本 ' + result.major + '）' + resolved;
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
    state.activeAccount = state.accounts.find((a) => a.id === data.active) || state.accounts[0] || null;
    renderAccountList();
    syncAccountCard();
    document.dispatchEvent(new CustomEvent('bmcl:accounts'));
  }

  function renderAccountList() {
    const list = $('#accountList');
    if (!list) return;
    if (!state.accounts.length) {
      list.innerHTML = '<p class="empty" style="padding:10px">暂无账号。可以添加离线账号，或使用上方「微软正版登录」。</p>';
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

  // ===== 微软正版登录（设备代码流）=====
  function stopMsPolling() {
    if (state.msLogin && state.msLogin.timer) clearTimeout(state.msLogin.timer);
    state.msLogin = null;
  }

  async function startMsLogin() {
    stopMsPolling();
    try {
      const flow = await bmcl.msLoginStart();
      state.msLogin = { flowId: flow.flowId, interval: flow.interval || 5, timer: null };
      $('#msFlow').classList.remove('hidden');
      $('#msFlowCode').textContent = flow.userCode;
      const url = flow.verificationUri || 'https://microsoft.com/devicelogin';
      $('#msFlowUrl').textContent = url;
      $('#msFlowUrl').href = url;
      $('#msFlowStatus').textContent = '等待你在浏览器中授权…（' + Math.round((flow.expiresIn || 900) / 60) + ' 分钟内有效）';
      try { await bmcl.openExternal(url); } catch (e) { /* 打不开浏览器时用户可手动复制 */ }
      scheduleMsPoll();
    } catch (err) {
      toast('发起微软登录失败：' + err.message, 'error');
    }
  }

  function scheduleMsPoll() {
    if (!state.msLogin) return;
    state.msLogin.timer = setTimeout(pollMsLogin, Math.max(3, state.msLogin.interval || 5) * 1000);
  }

  async function pollMsLogin() {
    if (!state.msLogin) return;
    const flowId = state.msLogin.flowId;
    try {
      const result = await bmcl.msLoginPoll(flowId);
      if (result.pending) {
        if (result.slowDown) state.msLogin.interval = (state.msLogin.interval || 5) + 5;
        $('#msFlowStatus').textContent = '等待你在浏览器中授权…';
        scheduleMsPoll();
        return;
      }
      stopMsPolling();
      $('#msFlow').classList.add('hidden');
      await refreshAccounts();
      state.settings = await bmcl.getSettings();
      applySettingsToForm(state.settings);
      toast('微软正版登录成功：' + result.account.name, 'ok');
    } catch (err) {
      stopMsPolling();
      $('#msFlow').classList.add('hidden');
      toast('微软登录失败：' + err.message, 'error');
    }
  }

  async function cancelMsLogin() {
    const flowId = state.msLogin && state.msLogin.flowId;
    stopMsPolling();
    $('#msFlow').classList.add('hidden');
    if (flowId) { try { await bmcl.msLoginCancel(flowId); } catch (e) { /* ignore */ } }
    toast('已取消微软登录', 'ok');
  }

  async function uploadSkinFromTool() {
    const variant = $('#skinVariant') ? $('#skinVariant').value : 'classic';
    try {
      const result = await bmcl.uploadSkin(variant);
      if (!result) return;
      toast('皮肤已上传到正版账号「' + result.name + '」', 'ok');
      updateAvatar(result.name);
    } catch (err) {
      toast('上传皮肤失败：' + err.message, 'error');
    }
  }

  async function resetSkinFromTool() {
    try {
      await bmcl.resetSkin();
      toast('已恢复默认皮肤', 'ok');
    } catch (err) {
      toast('恢复默认皮肤失败：' + err.message, 'error');
    }
  }

  // ===== 社区资源（模组 / 整合包 / 资源包 / 光影 / 数据包 / 世界）=====
  const MOD_TYPE_META = {
    mod: { title: '模组', instTitle: '已安装模组', dir: 'mods', placeholder: '搜索模组，例如 sodium / jei' },
    modpack: { title: '整合包', instTitle: '已安装整合包', dir: 'modpacks', placeholder: '搜索整合包，例如 better mc' },
    resourcepack: { title: '资源包', instTitle: '已安装资源包', dir: 'resourcepacks', placeholder: '搜索资源包' },
    shader: { title: '光影包', instTitle: '已安装光影包', dir: 'shaderpacks', placeholder: '搜索光影，例如 complementary' },
    datapack: { title: '数据包', instTitle: '已安装数据包', dir: 'datapacks', placeholder: '搜索数据包' },
    world: { title: '世界', instTitle: '已安装世界', dir: 'saves', placeholder: '搜索世界' }
  };

  function modType() { return state.modType || 'mod'; }
  function modMeta(type) { return MOD_TYPE_META[type] || MOD_TYPE_META.mod; }
  function modSource() { return $('#modSource') ? $('#modSource').value : 'curseforge'; }

  function fmtDownloads(n) {
    const value = Number(n) || 0;
    if (value >= 1e8) return (value / 1e8).toFixed(1) + ' 亿';
    if (value >= 1e4) return (value / 1e4).toFixed(1) + ' 万';
    return String(value);
  }

  function findProject(id) {
    return (state.modResults || []).find((m) => m.id === String(id)) ||
      (state.modFavorites || []).find((m) => m.id === String(id)) || null;
  }

  function loadFavorites() {
    try {
      const raw = localStorage.getItem('bmcl.favorites');
      const list = raw ? JSON.parse(raw) : [];
      state.modFavorites = Array.isArray(list) ? list : [];
    } catch { state.modFavorites = []; }
  }

  function saveFavorites() {
    try { localStorage.setItem('bmcl.favorites', JSON.stringify(state.modFavorites || [])); } catch { /* ignore */ }
  }

  function toggleFavorite(project) {
    if (!project) return;
    state.modFavorites = state.modFavorites || [];
    const idx = state.modFavorites.findIndex((m) => m.id === project.id && m.source === project.source);
    if (idx >= 0) {
      state.modFavorites.splice(idx, 1);
      toast('已取消收藏', 'ok');
    } else {
      state.modFavorites.unshift({
        id: project.id, title: project.title, iconUrl: project.iconUrl,
        source: project.source, projectType: project.projectType,
        downloads: project.downloads, description: project.description
      });
      toast('已加入收藏夹', 'ok');
    }
    saveFavorites();
    renderModResults(state.modResults || []);
  }

  function setModType(type) {
    const meta = modMeta(type);
    state.modType = MOD_TYPE_META[type] ? type : 'mod';
    state.modOffset = 0;
    if ($('#modPanelTitle')) $('#modPanelTitle').textContent = meta.title + '下载';
    if ($('#modInstalledTitle')) $('#modInstalledTitle').textContent = meta.instTitle;
    if ($('#modSearch')) $('#modSearch').placeholder = meta.placeholder;
    if ($('#btnOpenModsDir')) $('#btnOpenModsDir').textContent = '打开 ' + meta.dir + ' 目录';
    if ($('#modResults')) $('#modResults').innerHTML = '<p class="empty">正在获取' + meta.title + '列表…</p>';
    if (state.viewingFavorites === true) { renderFavorites(); return; }
    refreshModsList();
    loadModResults(true);
  }

  async function loadModResults(reset) {
    if (state.modLoading) return;
    const btn = $('#btnModSearch');
    const isFav = state.viewingFavorites === true;
    if (reset) {
      state.modOffset = 0;
      state.modResults = [];
      $('#modResults').innerHTML = '<p class="empty">正在获取…</p>';
    }
    const query = $('#modSearch') ? $('#modSearch').value.trim() : '';
    const requestedSource = isFav ? 'curseforge' : modSource();
    const options = {
      source: requestedSource,
      projectType: modType(),
      sort: $('#modSort') ? $('#modSort').value : 'downloads',
      limit: 20,
      offset: state.modOffset
    };
    const gv = $('#modGameVersion') ? $('#modGameVersion').value : '';
    if (gv) options.gameVersion = gv;
    if (btn) { btn.disabled = true; btn.textContent = '获取中…'; }
    state.modLoading = true;
    try {
      const results = await bmcl.searchMods(query, options);
      // 检测后端是否因 CurseForge Key 失效而回退到了 Modrinth
      const actualSource = results.length && results[0].source ? results[0].source : requestedSource;
      if (requestedSource === 'curseforge' && actualSource === 'modrinth') {
        const sel = $('#modSource');
        if (sel) sel.value = 'modrinth';
        toast('CurseForge 不可用，已自动切换到 Modrinth', 'ok');
      }
      state.modResults = reset ? results : (state.modResults || []).concat(results);
      state.modOffset += results.length;
      renderModResults(state.modResults);
      if ($('#btnModMore')) $('#btnModMore').classList.toggle('hidden', results.length < 20);
      if (!state.modResults.length) {
        $('#modResults').innerHTML = '<p class="empty">没有找到结果。换个关键词，或在右上角切换到 Modrinth 试试。</p>';
      }
    } catch (err) {
      $('#modResults').innerHTML = '<p class="empty">获取失败：' + esc(err.message) + '</p>';
      toast('获取失败：' + err.message, 'error');
      if ($('#btnModMore')) $('#btnModMore').classList.add('hidden');
    } finally {
      state.modLoading = false;
      if (btn) { btn.disabled = false; btn.textContent = '搜索'; }
    }
  }

  async function searchMods() {
    state.viewingFavorites = false;
    await loadModResults(true);
  }

  function renderFavorites() {
    const list = state.modFavorites || [];
    if (!list.length) {
      $('#modResults').innerHTML = '<p class="empty">收藏夹是空的。在结果里点 ☆ 即可收藏。</p>';
      if ($('#btnModMore')) $('#btnModMore').classList.add('hidden');
      return;
    }
    $('#modResults').innerHTML = list.map((m) => {
      return '<div class="mod-item">' +
        (m.iconUrl ? '<img class="mod-icon" src="' + esc(m.iconUrl) + '" alt="" loading="lazy">' : '<div class="mod-icon"></div>') +
        '<div class="mod-info">' +
          '<div class="mod-title">' + esc(m.title) + '</div>' +
          '<div class="mod-desc">' + esc(m.description || '') + '</div>' +
          '<div class="mod-meta">' + esc(m.source === 'modrinth' ? 'Modrinth' : 'CurseForge') +
            ' · 下载量 ' + fmtDownloads(m.downloads) + '</div>' +
        '</div>' +
        '<div class="mod-actions">' +
          '<button class="btn btn-sm btn-primary" data-modinstall="' + esc(m.id) + '" data-src="' + esc(m.source || 'curseforge') + '" data-ptype="' + esc(m.projectType || 'mod') + '">安装</button>' +
          '<button class="btn btn-sm" data-modview="' + esc(m.id) + '" data-src="' + esc(m.source || 'curseforge') + '" data-ptype="' + esc(m.projectType || 'mod') + '">版本</button>' +
          '<button class="btn btn-sm" data-unfav="' + esc(m.id) + '">☆</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderModResults(results) {
    const list = $('#modResults');
    if (!results.length) { list.innerHTML = '<p class="empty">没有找到结果。</p>'; return; }
    list.innerHTML = results.map((m) =>
      '<div class="mod-item">' +
        (m.iconUrl ? '<img class="mod-icon" src="' + esc(m.iconUrl) + '" alt="" loading="lazy">' : '<div class="mod-icon"></div>') +
        '<div class="mod-info">' +
          '<div class="mod-title">' + esc(m.title) + '</div>' +
          '<div class="mod-desc">' + esc(m.description || '') + '</div>' +
          '<div class="mod-cats">' + (m.categories || []).slice(0, 4).map((c) => '<span class="mod-cat">' + esc(c) + '</span>').join('') + '</div>' +
          '<div class="mod-meta">' + esc(m.author || '未知作者') + ' · 下载量 ' + fmtDownloads(m.downloads) +
            ' · ' + esc(m.source === 'modrinth' ? 'Modrinth' : 'CurseForge') + '</div>' +
        '</div>' +
        '<div class="mod-actions">' +
          '<button class="btn btn-sm btn-primary" data-modinstall="' + esc(m.id) + '" data-src="' + esc(m.source || 'curseforge') + '" data-ptype="' + esc(m.projectType || modType()) + '">安装</button>' +
          '<button class="btn btn-sm" data-modview="' + esc(m.id) + '" data-src="' + esc(m.source || 'curseforge') + '" data-ptype="' + esc(m.projectType || modType()) + '">版本</button>' +
          '<button class="btn btn-sm" data-fav="' + esc(m.id) + '">' +
            ((state.modFavorites || []).some((f) => f.id === m.id && f.source === m.source) ? '★' : '☆') +
          '</button>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  async function showModVersions(projectId, source, projectType) {
    const mod = findProject(projectId);
    const gv = $('#modGameVersion') ? $('#modGameVersion').value : '';
    const src = source || (mod && mod.source) || modSource();
    const ptype = projectType || (mod && mod.projectType) || modType();
    try {
      const versions = await bmcl.getModVersions(src, projectId, gv || undefined);
      const list = $('#modResults');
      if (!versions.length) {
        list.innerHTML = '<p class="empty">' + esc(mod ? mod.title : projectId) +
          ' 没有适配当前游戏版本的文件。可在上方把「游戏版本」设为全部再试。</p>';
        return;
      }
      list.innerHTML = '<div class="version-item"><b>' + esc(mod ? mod.title : projectId) + ' — 可用文件（' + versions.length + '）</b></div>' +
        versions.slice(0, 40).map((v) =>
          '<div class="version-item">' +
            '<div class="v-left">' +
              '<span class="v-id">' + esc(v.versionNumber || v.name) + '</span>' +
              '<span class="v-meta">' + esc((v.gameVersions || []).slice(0, 5).join(', ')) + '</span>' +
              '<span class="v-meta">' + esc((v.loaders || []).map(String).join(', ')) +
                ' · ' + ((v.fileSize || 0) / 1024 / 1024).toFixed(2) + ' MB</span>' +
            '</div>' +
            '<button class="btn btn-sm btn-primary" data-modfile="' + esc(v.fileUrl) + '" data-fn="' + esc(v.fileName) +
              '" data-ptype="' + esc(ptype) + '">下载</button>' +
          '</div>'
        ).join('');
    } catch (err) {
      toast('获取文件列表失败：' + err.message, 'error');
    }
  }

  async function quickInstallMod(projectId, source, projectType) {
    const mod = findProject(projectId);
    const src = source || (mod && mod.source) || modSource();
    const ptype = projectType || (mod && mod.projectType) || modType();
    const gv = $('#modGameVersion') ? $('#modGameVersion').value : '';
    try {
      const versions = await bmcl.getModVersions(src, projectId, gv || undefined);
      if (!versions.length) {
        toast('该项目没有适配 ' + (gv || '当前') + ' 版本的文件，试试切换游戏版本', 'error');
        return;
      }
      const release = versions.find((v) => v.releaseType === 1) || versions.find((v) => !v.releaseType) || versions[0];
      await doInstallMod({
        fileUrl: release.fileUrl,
        fileName: release.fileName,
        projectType: ptype,
        source: src
      });
    } catch (err) {
      toast('安装失败：' + err.message, 'error');
    }
  }

  async function doInstallMod(modVersion, btn) {
    if (!modVersion || !modVersion.fileUrl) { toast('该文件没有可用的下载地址', 'error'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
    try {
      const r = await bmcl.installMod(modVersion, modVersion.projectType);
      toast('已安装 ' + modVersion.fileName + '（' + (r.size / 1024 / 1024).toFixed(2) + ' MB）', 'ok');
      await refreshModsList();
    } catch (err) {
      toast('下载失败：' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '下载'; }
    }
  }

  async function refreshModsList() {
    const list = $('#installedMods');
    if (!list) return;
    const meta = modMeta(modType());
    try {
      const mods = await bmcl.listInstalledMods(modType());
      if (!mods.length) { list.innerHTML = '<p class="empty">尚未安装任何' + meta.title + '。</p>'; return; }
      list.innerHTML = mods.map((m) =>
        '<div class="version-item">' +
          '<div class="v-left"><span class="v-id">' + esc(m.name) + '</span>' +
          '<span class="v-meta">' + (m.size / 1024 / 1024).toFixed(2) + ' MB</span>' +
          '<span class="v-meta">' + esc((m.modifiedAt || '').slice(0, 10)) + '</span></div>' +
        '</div>'
      ).join('');
    } catch {
      list.innerHTML = '<p class="empty">读取列表失败。</p>';
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
      mods: () => { showDlPanel('#modPanel'); setModType('mod'); },
      mods2: () => { showDlPanel('#modPanel'); setModType('mod'); },
      modpacks: () => { showDlPanel('#modPanel'); setModType('modpack'); },
      datapacks: () => { showDlPanel('#modPanel'); setModType('datapack'); },
      resourcepacks: () => { showDlPanel('#modPanel'); setModType('resourcepack'); },
      shaders: () => { showDlPanel('#modPanel'); setModType('shader'); },
      worlds: () => { showDlPanel('#modPanel'); setModType('world'); },
      favorites: () => {
        showDlPanel('#modPanel');
        state.viewingFavorites = true;
        setModType('mod');
        renderFavorites();
      },
      fabric: () => { showDlPanel('#loaderPanel'); populateFabricGames(); },
      forge: () => { showDlPanel('#packNoticePanel'); showPackNotice('forge'); },
      neoforge: () => { showDlPanel('#packNoticePanel'); showPackNotice('neoforge'); },
      optifine: () => { showDlPanel('#packNoticePanel'); showPackNotice('optifine'); }
    };
    document.querySelectorAll('.dl-cat').forEach((cat) => {
      cat.addEventListener('click', () => {
        cat.parentElement.querySelectorAll('.dl-cat').forEach((c) => c.classList.remove('active'));
        cat.classList.add('active');
        state.viewingFavorites = false;
        const handler = catHandlers[cat.dataset.cat] || catHandlers.mc;
        handler();
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

    // Forge / NeoForge 安装
    $('#btnPackGames').addEventListener('click', async () => {
      await loadRemoteVersions();
      populatePackGames();
    });
    $('#btnPackLoaders').addEventListener('click', loadPackLoaders);
    $('#btnPackInstall').addEventListener('click', installPack);

    // 版本列表：安装 / 启动 / 设为当前
    document.addEventListener('click', (e) => {
      const vmore = e.target.closest('[data-vmore]');
      if (vmore) { showMoreVersions(vmore.dataset.vmore); return; }
      const install = e.target.closest('[data-install]');
      if (install) { installVersion(install.dataset.install); return; }
      const launch = e.target.closest('[data-launch]');
      if (launch) {
        state.settings.versionId = launch.dataset.launch;
        syncVersionLabel();
        if (!document.body.classList.contains('theme-bmcl')) switchPage('launch');
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
      if (modInstall) {
        quickInstallMod(modInstall.dataset.modinstall, modInstall.dataset.src, modInstall.dataset.ptype);
        return;
      }
      const modView = e.target.closest('[data-modview]');
      if (modView) {
        showModVersions(modView.dataset.modview, modView.dataset.src, modView.dataset.ptype);
        return;
      }
      const modFile = e.target.closest('[data-modfile]');
      if (modFile) {
        doInstallMod({
          fileUrl: modFile.dataset.modfile,
          fileName: modFile.dataset.fn,
          projectType: modFile.dataset.ptype || modType()
        }, modFile);
        return;
      }
      const fav = e.target.closest('[data-fav]');
      if (fav) { toggleFavorite(findProject(fav.dataset.fav)); return; }
      const unfav = e.target.closest('[data-unfav]');
      if (unfav) {
        state.modFavorites = (state.modFavorites || []).filter((m) => m.id !== unfav.dataset.unfav);
        saveFavorites();
        renderFavorites();
        return;
      }
      const quick = e.target.closest('[data-quick]');
      if (quick) {
        const id = quick.dataset.quick;
        bmcl.saveSettings({ ...state.settings, versionId: id }).then(() => {
          state.settings = Object.assign(state.settings, { versionId: id });
          syncVersionLabel();
          launchGame(id);
        }).catch((err) => toast('启动失败：' + err.message, 'error'));
        return;
      }
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
    document.querySelectorAll('input[name="uiTheme"]').forEach((r) => {
      r.addEventListener('change', async () => {
        applyTheme(r.value);
        try {
          state.settings = await bmcl.saveSettings({ ...state.settings, uiTheme: r.value });
        } catch (e) { /* ignore */ }
      });
    });

    // 账号
    $('#btnSwitchAccount').addEventListener('click', () => $('#accountPanel').classList.toggle('hidden'));
    $('#btnAccountClose').addEventListener('click', () => $('#accountPanel').classList.add('hidden'));
    $('#btnAddAccount').addEventListener('click', addAccount);
    $('#btnMsLogin').addEventListener('click', startMsLogin);
    $('#btnMsCancel').addEventListener('click', cancelMsLogin);
    $('#btnMsCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('#msFlowCode').textContent || '');
        toast('登录代码已复制', 'ok');
      } catch (e) { toast('无法写入剪贴板，请手动复制', 'error'); }
    });
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
    $('#btnUploadSkin').addEventListener('click', uploadSkinFromTool);
    $('#btnResetSkin').addEventListener('click', resetSkinFromTool);

    // 模组
    $('#btnModSearch').addEventListener('click', searchMods);
    $('#modSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMods(); });
    $('#modSource').addEventListener('change', () => { state.modOffset = 0; loadModResults(true); });
    $('#modSort').addEventListener('change', () => loadModResults(true));
    $('#modGameVersion').addEventListener('change', () => loadModResults(true));
    $('#btnModMore').addEventListener('click', () => loadModResults(false));
    $('#btnRefreshMods').addEventListener('click', refreshModsList);
    $('#btnOpenModsDir').addEventListener('click', () => bmcl.openModsDir(modType()));

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

    // BMCL 模式：退出启动器
    const btnQuit = $('#btnQuit');
    if (btnQuit) btnQuit.addEventListener('click', () => { if (bmcl && bmcl.winClose) bmcl.winClose(); });

    // BMCL「更多」页按钮
    if ($('#btnSkinMgr')) $('#btnSkinMgr').addEventListener('click', () => switchPage('tools'));
    if ($('#btnAccount')) $('#btnAccount').addEventListener('click', () => {
      switchPage('launch');
      $('#accountPanel').classList.remove('hidden');
    });
    if ($('#btnSkinUpload')) $('#btnSkinUpload').addEventListener('click', uploadSkinFromTool);
    if ($('#btnCape')) $('#btnCape').addEventListener('click', () => toast('披风管理将在后续版本接入（支持 LittleSkin）', 'info'));
    if ($('#btnProfileEdit')) $('#btnProfileEdit').addEventListener('click', () => {
      switchPage('launch');
      $('#accountPanel').classList.remove('hidden');
      $('#newAccountName').focus();
    });
    if ($('#btnBackup')) $('#btnBackup').addEventListener('click', () => toast('游戏目录备份功能开发中', 'info'));
    if ($('#btnRestore')) $('#btnRestore').addEventListener('click', () => toast('还原备份功能开发中', 'info'));
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

  /** 管理员下发公告：读取 notices.json，展示最新一条未被关闭的公告。 */
  async function loadAnnouncements() {
    const cards = document.querySelectorAll('.ann-card');
    if (!cards.length || !bmcl || !bmcl.getNotices) return;
    let res = null;
    try { res = await bmcl.getNotices(); } catch (_) { return; }
    const notices = (res && res.notices) || [];
    const visible = notices.filter((n) => n && n.id && !localStorage.getItem('bmcl.notice.' + n.id));
    if (!visible.length) return;
    const n = visible[0];
    cards.forEach((card) => {
      card.querySelector('.notice-title').textContent = n.title || '公告';
      const body = card.querySelector('.ann-body');
      body.innerHTML = '';
      String(n.body || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        body.appendChild(p);
      });
      const foot = card.querySelector('.ann-foot');
      foot.textContent = '';
      if (n.date) foot.textContent = '下发时间：' + n.date + ' · 管理员公告';
      if (n.url) {
        const a = document.createElement('a');
        a.href = n.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = ' 查看详情 →';
        foot.appendChild(a);
      }
      card.querySelector('.notice-close').onclick = () => {
        try { localStorage.setItem('bmcl.notice.' + n.id, '1'); } catch (_) { /* 忽略 */ }
        cards.forEach((c) => c.classList.add('hidden'));
      };
      card.classList.remove('hidden');
    });
  }

  async function boot() {
    if (!bmcl) { showBanner('未检测到 Electron 环境：请用 npm start 运行启动器。', 'error'); return; }
    state.info = await bmcl.info();
    state.settings = await bmcl.getSettings();
    ['#sideVersion', '#updVersion', '#updVersion2', '#codeVer'].forEach((sel) => {
      const el = $(sel); if (el) el.textContent = 'v' + state.info.version;
    });
    await refreshAccounts();
    loadFavorites();
    applySettingsToForm(state.settings);
    setState(false, '未启动');
    bindEvents();
    bindBridgeEvents();
    loadAnnouncements();
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
