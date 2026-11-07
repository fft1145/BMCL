/* ============================================================
   BMCL 2.2.0 · 界面逻辑（只作用于 BMCL 主题）
   - 实用 / 管理 / 下载 / 账号 / 设置 五页交互
   - 账号页与玩家模型状态（未登录不显示模型）
   - 管理页版本 / 存档 / mod / 材质包
   PCL 主题完全不使用本文件里的任何节点。
   ============================================================ */
(function () {
  'use strict';

  var API = window.bmcl || null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var ui = {
    accounts: [],
    active: null,
    settings: {},
    versions: [],
    selected: null,
    saves: [],
    mods: [],
    packs: [],
    page: 1,
    pageSize: 7,
    favCount: 0
  };

  /* ---------- 小工具 ---------- */
  function setCount(n) {
    var el = $('#utCount');
    if (el) el.textContent = n + ' 项';
  }

  var SERVER_COUNT = 5;
  function updateCountForActiveTab() {
    var active = $('.ut-tab.on');
    var tab = active ? active.getAttribute('data-utab') : 'bmcl';
    var n = ui.versions.length;
    if (tab === 'last') n = ui.saves.length;
    else if (tab === 'fav') n = ui.favCount;
    else if (tab === 'srv') n = SERVER_COUNT;
    setCount(n);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg, type) {
    var wrap = $('#toastWrap');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .2s';
      setTimeout(function () { el.remove(); }, 250);
    }, 3200);
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmtTime(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '—';
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function onTheme() { return document.body.classList.contains('theme-bmcl'); }

  function resizeModel() {
    if (!onTheme()) return;
    if (typeof window.bmclModelResize === 'function') setTimeout(window.bmclModelResize, 60);
  }

  /* ---------- 顶部标签 ---------- */
  $$('.ut-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.ut-tab').forEach(function (b) { b.classList.toggle('on', b === btn); });
      $$('.ut-pane').forEach(function (p) {
        p.classList.toggle('on', p.getAttribute('data-upane') === btn.getAttribute('data-utab'));
      });
      updateCountForActiveTab();
      resizeModel();
    });
  });

  $$('.mg-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.mg-tab').forEach(function (b) { b.classList.toggle('on', b === btn); });
      $$('.mg-pane').forEach(function (p) {
        p.classList.toggle('on', p.getAttribute('data-mpane') === btn.getAttribute('data-mtab'));
      });
    });
  });

  $$('.ac-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.ac-tab').forEach(function (b) { b.classList.toggle('on', b === btn); });
      $$('.ac-pane').forEach(function (p) {
        p.classList.toggle('on', p.getAttribute('data-apane') === btn.getAttribute('data-atab'));
      });
      var hint = $('#acHeadHint');
      if (hint) {
        hint.textContent = btn.getAttribute('data-atab') === 'official'
          ? '连接 Mojang 服务器获取账号'
          : (btn.getAttribute('data-atab') === 'offline' ? '离线账号仅保存在本地' : '第三方认证服务器登录');
      }
    });
  });

  /* ---------- 下载页顶部分类 ---------- */
  $$('.dl-bmcl-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.dl-bmcl-tab').forEach(function (b) { b.classList.toggle('on', b === btn); });
      var page = $('#page-download');
      if (page) page.classList.remove('dl-empty-mode');
      var target = document.querySelector('.dl-side .dl-cat[data-cat="' + btn.getAttribute('data-mcat') + '"]');
      if (target) target.click();
    });
  });

  $$('.dl-mini').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var page = $('#page-download');
      if (page) page.classList.remove('dl-empty-mode');
      $$('.dl-bmcl-tab').forEach(function (b) { b.classList.remove('on'); });
      var target = document.querySelector('.dl-side .dl-cat[data-cat="' + btn.getAttribute('data-mcat') + '"]');
      if (target) target.click();
    });
  });

  /* ---------- 账号 ---------- */
  function activeOf(type) {
    if (!ui.active) return null;
    if (type === 'microsoft') return ui.active.type === 'microsoft' ? ui.active : null;
    return ui.active.type !== 'microsoft' ? ui.active : null;
  }

  function avatarUrl(name) {
    return 'https://mc-heads.net/avatar/' + encodeURIComponent(name || 'steve') + '/64';
  }

  function syncPlayer() {
    var logged = !!ui.active;
    var name = logged ? ui.active.name : '未登录';

    /* 标题栏玩家名：灰底白字，未登录灰字 */
    var chip = $('#tbAccount');
    var nameEl = $('#tbPlayerName');
    var av = $('#tbAvatar');
    if (chip) chip.classList.toggle('offline', !logged);
    if (nameEl) nameEl.textContent = name;
    if (av) av.src = logged ? avatarUrl(ui.active.name) : '../build/icon.png';

    /* 实用页模型：未登录不显示 */
    var card = $('.hm-card');
    if (card) card.classList.toggle('logged', logged);
    var hmP = $('#hmPlayer');
    if (hmP) {
      hmP.textContent = name;
      hmP.classList.toggle('hm-logouted', !logged);
    }

    /* 账号页：正版 */
    var msAcc = activeOf('microsoft');
    var offAcc = activeOf('offline');
    if ($('#acName')) $('#acName').textContent = msAcc ? msAcc.name : '未登录';
    if ($('#acSub')) {
      $('#acSub').textContent = msAcc
        ? '正版账号 · 已连接 Mojang 服务器'
        : '使用 Microsoft 账号登录后自动获取皮肤与披风';
    }
    if ($('#acBadge')) $('#acBadge').textContent = msAcc ? '正版' : '未登录';
    var acIdentity = $('#acIdentity');
    if (acIdentity) acIdentity.classList.toggle('offline', !msAcc);
    var acAv = $('#acAvatar');
    if (acAv) {
      acAv.src = msAcc ? avatarUrl(msAcc.name) : '../build/icon.png';
      acAv.onerror = function () { this.onerror = null; this.src = '../build/icon.png'; };
    }

    /* 账号页：离线（灰显） */
    var offIdentity = $('#acOfflineIdentity');
    if (offIdentity) offIdentity.classList.toggle('offline', !offAcc);
    if ($('#acOfflineName')) $('#acOfflineName').textContent = offAcc ? offAcc.name : '未登录';
    if ($('#acOfflineBadge')) $('#acOfflineBadge').textContent = offAcc ? '离线' : '未登录';
    var offAv = $('#acOfflineAvatar');
    if (offAv) {
      offAv.src = offAcc ? avatarUrl(offAcc.name) : '../build/icon.png';
      offAv.onerror = function () { this.onerror = null; this.src = '../build/icon.png'; };
    }

    renderAccountList();
    updateUtilVersion();
    resizeModel();
  }

  function renderAccountList() {
    var list = $('#acAccountList');
    if (!list) return;
    if (!ui.accounts.length) {
      list.innerHTML = '<div class="ut-empty-row">还没有账号，先添加一个离线账号或登录正版账号</div>';
      return;
    }
    list.innerHTML = ui.accounts.map(function (a) {
      return '<div class="ac-row' + (ui.active && ui.active.id === a.id ? ' on' : '') + '" data-acc="' + esc(a.id) + '">' +
        '<span class="ac-row-name">' + esc(a.name) + '</span>' +
        '<span class="ac-row-type">' + (a.type === 'microsoft' ? '正版' : '离线') + '</span>' +
        '<button class="ac-row-del" data-accdel="' + esc(a.id) + '">删除</button>' +
        '</div>';
    }).join('');
  }

  async function refreshAccounts() {
    if (!API) { syncPlayer(); return; }
    try {
      var data = await API.listAccounts();
      ui.accounts = (data && data.accounts) || [];
      ui.active = ui.accounts.filter(function (a) { return a.id === data.active; })[0] || null;
    } catch (e) {
      ui.accounts = [];
      ui.active = null;
    }
    syncPlayer();
  }

  /* 账号列表点击：切换 / 删除 */
  document.addEventListener('click', function (e) {
    var del = e.target.closest('[data-accdel]');
    if (del) {
      e.stopPropagation();
      var id = del.getAttribute('data-accdel');
      if (!API) return;
      API.removeAccount(id).then(function () {
        toast('账号已删除', 'ok');
        return refreshAccounts();
      }).catch(function (err) { toast('删除失败：' + err.message, 'error'); });
      return;
    }
    var row = e.target.closest('[data-acc]');
    if (row && !row.classList.contains('ac-row-del')) {
      var accId = row.getAttribute('data-acc');
      if (!API) return;
      API.setActiveAccount(accId).then(function () {
        toast('已切换账号', 'ok');
        return refreshAccounts();
      }).catch(function (err) { toast('切换失败：' + err.message, 'error'); });
    }
  });

  /* 添加离线账号 */
  var btnAdd = $('#acBtnAdd');
  if (btnAdd) {
    btnAdd.addEventListener('click', async function () {
      var input = $('#acNewName');
      var name = (input && input.value || '').trim();
      if (!name) { toast('请输入玩家名', 'error'); return; }
      if (!API) return;
      try {
        await API.addAccount(name);
        if (input) input.value = '';
        await refreshAccounts();
        toast('离线账号「' + name + '」已添加并设为当前', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* 微软正版登录（设备代码流） */
  var msFlowId = null;
  var msTimer = null;
  var msInterval = 5000;

  function stopMsFlow() {
    if (msTimer) { clearTimeout(msTimer); msTimer = null; }
    msFlowId = null;
  }

  function setFlowVisible(v) {
    var flow = $('#acFlow');
    if (flow) flow.classList.toggle('hidden', !v);
  }

  function pollMs() {
    if (!msFlowId || !API) return;
    API.msLoginPoll(msFlowId).then(function (r) {
      if (!r || r.pending) {
        msTimer = setTimeout(pollMs, msInterval);
        return;
      }
      stopMsFlow();
      setFlowVisible(false);
      toast('正版登录成功：' + (r.account && r.account.name || ''), 'ok');
      refreshAccounts();
    }).catch(function (err) {
      stopMsFlow();
      var st = $('#acFlowStatus');
      if (st) st.textContent = '登录失败：' + err.message;
      toast('登录失败：' + err.message, 'error');
    });
  }

  var btnMs = $('#acBtnMs');
  if (btnMs) {
    btnMs.addEventListener('click', async function () {
      if (!API) return;
      btnMs.disabled = true;
      try {
        var r = await API.msLoginStart();
        msFlowId = r.flowId;
        msInterval = Math.max(3000, (r.interval || 5) * 1000);
        if ($('#acFlowCode')) $('#acFlowCode').textContent = r.userCode || '--------';
        var url = $('#acFlowUrl');
        if (url) {
          url.href = r.verificationUri || 'https://microsoft.com/devicelogin';
          url.textContent = r.verificationUri || 'microsoft.com/devicelogin';
        }
        if ($('#acFlowStatus')) $('#acFlowStatus').textContent = '等待授权…（' + Math.round(r.expiresIn / 60) + ' 分钟内有效）';
        setFlowVisible(true);
        msTimer = setTimeout(pollMs, msInterval);
      } catch (err) {
        toast('发起登录失败：' + err.message, 'error');
      } finally {
        btnMs.disabled = false;
      }
    });
  }

  var btnCopy = $('#acBtnCopy');
  if (btnCopy) {
    btnCopy.addEventListener('click', function () {
      var code = $('#acFlowCode') ? $('#acFlowCode').textContent : '';
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast('代码已复制', 'ok'); });
    });
  }

  var btnCancel = $('#acBtnCancel');
  if (btnCancel) {
    btnCancel.addEventListener('click', function () {
      if (API && msFlowId) API.msLoginCancel(msFlowId).catch(function () {});
      stopMsFlow();
      setFlowVisible(false);
      toast('已取消登录', 'ok');
    });
  }

  var btnActiveRefresh = $('#acBtnActiveRefresh');
  if (btnActiveRefresh) {
    btnActiveRefresh.addEventListener('click', function () {
      refreshAccounts().then(function () { toast('账号信息已刷新', 'ok'); });
    });
  }

  /* 皮肤 / 披风 */
  var btnSkin = $('#acBtnSkin');
  if (btnSkin) {
    btnSkin.addEventListener('click', async function () {
      if (!API) return;
      var variant = $('#acSkinVariant') ? $('#acSkinVariant').value : 'classic';
      try {
        var r = await API.uploadSkin(variant);
        if (!r) return;
        if ($('#acSkinPrev')) $('#acSkinPrev').textContent = '皮肤已上传：' + r.name;
        toast('皮肤已写入 Mojang 数据库', 'ok');
        refreshAccounts();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  var btnCape = $('#acBtnCape');
  if (btnCape) {
    btnCape.addEventListener('click', async function () {
      if (!API) return;
      try {
        var file = await API.pickFile('选择披风 PNG（64×32）');
        if (!file) return;
        if ($('#acSkinPrev')) $('#acSkinPrev').textContent = '披风文件：' + file.split(/[\\/]/).pop();
        toast('已选择披风文件；正版披风需在 Mojang 后台审核后写入', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  var btnSkinReset = $('#acBtnSkinReset');
  if (btnSkinReset) {
    btnSkinReset.addEventListener('click', async function () {
      if (!API) return;
      try {
        await API.resetSkin();
        if ($('#acSkinPrev')) $('#acSkinPrev').textContent = '已恢复默认皮肤';
        toast('已恢复默认皮肤', 'ok');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  var btnThird = $('#acBtnThird');
  if (btnThird) {
    btnThird.addEventListener('click', function () {
      var server = $('#acThirdServer') ? $('#acThirdServer').value.trim() : '';
      if (!server) { toast('请填写认证服务器地址', 'error'); return; }
      toast('第三方认证需要 authlib-injector，当前版本暂未接入', 'error');
    });
  }

  /* ---------- 实用页：上次游玩 / 收藏 / 服务器推荐 ---------- */
  function renderLastPlayed() {
    var el = $('#utLastList');
    if (!el) return;
    updateCountForActiveTab();
    if (!ui.saves.length) {
      el.innerHTML = '<div class="ut-empty-row">还没有上次游玩记录，启动一次游戏后就会出现在这里</div>';
      updatePager(0);
      return;
    }
    var total = ui.saves.length;
    var pages = Math.max(1, Math.ceil(total / ui.pageSize));
    ui.page = Math.min(ui.page, pages);
    var slice = ui.saves.slice((ui.page - 1) * ui.pageSize, ui.page * ui.pageSize);
    var verId = ui.settings.versionId || (ui.versions[0] && ui.versions[0].id) || '未选择版本';
    var offset = (ui.page - 1) * ui.pageSize;
    el.innerHTML = slice.map(function (s, i) {
      return '<div class="ut-row">' +
        '<div class="r-main">' +
          '<button class="ut-star" data-favsave="' + esc(s.name) + '" title="收藏">☆</button>' +
          '<span class="r-name">' + esc(s.name) + '</span>' +
          '<span class="r-dim">' + esc(verId) + '</span>' +
        '</div>' +
        '<span class="r-dim">' + fmtTime(s.lastPlayed) + '</span>' +
        '<span class="r-end">ID ' + ('00' + (offset + i + 1)).slice(-3) + '</span>' +
        '</div>';
    }).join('');
    updatePager(pages);
  }

  function updatePager(pages) {
    if ($('#utPgInfo')) $('#utPgInfo').textContent = Math.min(ui.page, Math.max(1, pages)) + ' / ' + Math.max(1, pages);
    if ($('#utPgPrev')) $('#utPgPrev').disabled = ui.page <= 1;
    if ($('#utPgNext')) $('#utPgNext').disabled = ui.page >= Math.max(1, pages);
  }

  var pgPrev = $('#utPgPrev');
  if (pgPrev) pgPrev.addEventListener('click', function () { if (ui.page > 1) { ui.page--; renderLastPlayed(); } });
  var pgNext = $('#utPgNext');
  if (pgNext) pgNext.addEventListener('click', function () { ui.page++; renderLastPlayed(); });

  document.addEventListener('click', function (e) {
    var star = e.target.closest('[data-favsave]');
    if (star) {
      star.classList.toggle('on');
      star.textContent = star.classList.contains('on') ? '★' : '☆';
    }
  });

  function renderFavorites() {
    var el = $('#utFavList');
    if (!el) return;
    var favs = [];
    try {
      var raw = localStorage.getItem('bmcl.favorites');
      favs = raw ? JSON.parse(raw) : [];
    } catch (e) { favs = []; }
    ui.favCount = Array.isArray(favs) ? favs.length : 0;
    updateCountForActiveTab();
    if (!Array.isArray(favs) || !favs.length) {
      el.innerHTML = '<div class="ut-empty-row">收藏夹是空的。在「下载」里点 ☆ 即可收藏</div>';
      return;
    }
    el.innerHTML = favs.map(function (m) {
      return '<div class="ut-row">' +
        '<div class="r-main"><span class="r-name">' + esc(m.title) + '</span></div>' +
        '<span class="r-dim">' + esc(m.projectType || 'mod') + '</span>' +
        '<span class="r-end">' + esc(m.source || '') + '</span>' +
        '</div>';
    }).join('');
  }

  var SERVERS = [
    { n: '花雨庭 · 空岛战争', ip: 'play.huayuting.net', on: '12,486' },
    { n: '梦回盘灵 · 生存服', ip: 'mc.mhpl.net', on: '6,231' },
    { n: '星火之境 · 空岛', ip: 'play.xhzj.cn', on: '4,027' },
    { n: '酷云服务器 · 起床战争', ip: 'play.kcloud.cn', on: '3,845' },
    { n: '幻境 · RPG 冒险', ip: 'mc.huanjing.net', on: '2,190' }
  ];

  function renderServers() {
    var el = $('#utSrvList');
    if (!el) return;
    updateCountForActiveTab();
    el.innerHTML = SERVERS.map(function (s) {
      return '<div class="ut-row">' +
        '<div class="r-main"><span class="r-name">' + esc(s.n) + '</span></div>' +
        '<span class="r-dim">' + esc(s.ip) + '</span>' +
        '<span class="r-end">' + esc(s.on) + ' 在线</span>' +
        '</div>';
    }).join('');
  }

  /* ---------- 管理页 ---------- */
  function currentVersionId() {
    return ui.settings.versionId || (ui.versions[0] && ui.versions[0].id) || '';
  }

  async function loadVersions() {
    if (!API) return;
    try {
      var gs = await API.listInstalled();
      ui.versions = (gs && gs.versions) || [];
    } catch (e) { ui.versions = []; }
    if (!ui.selected && ui.versions.length) {
      var cur = ui.versions.filter(function (v) { return v.id === currentVersionId(); })[0];
      ui.selected = cur || ui.versions[0];
    }
    if (ui.selected && !ui.versions.some(function (v) { return v.id === ui.selected.id; })) {
      ui.selected = ui.versions[0] || null;
    }
    renderVersionList();
    renderManageDetail();
    renderLastPlayed();
    updateUtilVersion();
  }

  async function loadSaves() {
    if (!API) return;
    try { ui.saves = await API.listSaves() || []; } catch (e) { ui.saves = []; }
    renderLastPlayed();
    renderSaves();
    renderVersionList();
    renderManageDetail();
  }

  async function loadMods() {
    if (!API) return;
    try {
      ui.mods = await API.listInstalledMods('mod') || [];
      ui.packs = await API.listInstalledMods('resourcepack') || [];
    } catch (e) { ui.mods = []; ui.packs = []; }
    renderModLists();
    renderVersionList();
    renderManageDetail();
  }

  function renderVersionList() {
    var list = $('#mgVersionList');
    if (!list) return;
    if (!ui.versions.length) {
      list.innerHTML = '<p class="ut-empty-row">没有识别到已安装版本。可在「下载」页安装，或在设置里指定游戏目录。</p>';
      return;
    }
    list.innerHTML = ui.versions.map(function (v) {
      var on = ui.selected && ui.selected.id === v.id;
      return '<div class="mg-row' + (on ? ' on' : '') + '" data-vid="' + esc(v.id) + '">' +
        '<div class="mg-row-top">' +
          '<span class="mg-row-name">' + esc(v.id) + '</span>' +
          '<button class="mg-del" data-vdel="' + esc(v.id) + '">删除</button>' +
        '</div>' +
        '<div class="mg-row-meta">' +
          '<span class="mg-chip">mod ' + ui.mods.length + '</span>' +
          '<span class="mg-chip dim">存档 ' + ui.saves.length + '</span>' +
          '<span class="mg-chip dim">' + esc(v.type || 'release') + '</span>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function renderManageDetail() {
    var title = $('#mgTitle');
    var sub = $('#mgSub');
    if (!ui.selected) {
      if (title) title.textContent = '版本管理';
      if (sub) sub.textContent = '选择左侧版本查看详情';
      renderSaves();
      renderModLists();
      return;
    }
    if (title) title.textContent = ui.selected.id;
    if (sub) {
      sub.textContent = 'mod ' + ui.mods.length + ' · 存档 ' + ui.saves.length +
        ' · ' + (ui.selected.type || 'release');
    }
    renderSaves();
    renderModLists();
  }

  function renderSaves() {
    var el = $('#mgSaves');
    if (!el) return;
    if (!ui.saves.length) {
      el.innerHTML = '<div class="ut-empty-row">还没有存档，进入游戏后会自动生成</div>';
      return;
    }
    el.innerHTML = ui.saves.map(function (s) {
      return '<div class="ut-row" data-save="' + esc(s.name) + '">' +
        '<div class="r-main"><span class="r-name">' + esc(s.name) + '</span></div>' +
        '<span class="r-dim">' + fmtTime(s.lastPlayed) + '</span>' +
        '<span class="r-end">—</span>' +
        '</div>';
    }).join('');
  }

  function renderModLists() {
    var m = $('#mgMods');
    if (m) {
      m.innerHTML = ui.mods.length ? ui.mods.map(function (f) {
        return '<div class="ut-row">' +
          '<div class="r-main"><span class="r-name">' + esc(f.name) + '</span></div>' +
          '<span class="r-dim">mod</span>' +
          '<span class="r-end">' + (f.size ? (f.size / 1024 / 1024).toFixed(1) + ' MB' : '—') + '</span>' +
          '</div>';
      }).join('') : '<div class="ut-empty-row">还没有安装 mod</div>';
    }
    var p = $('#mgPacks');
    if (p) {
      p.innerHTML = ui.packs.length ? ui.packs.map(function (f) {
        return '<div class="ut-row">' +
          '<div class="r-main"><span class="r-name">' + esc(f.name) + '</span></div>' +
          '<span class="r-dim">材质包</span>' +
          '<span class="r-end">' + (f.size ? (f.size / 1024 / 1024).toFixed(1) + ' MB' : '—') + '</span>' +
          '</div>';
      }).join('') : '<div class="ut-empty-row">还没有材质包</div>';
    }
  }

  document.addEventListener('click', async function (e) {
    var delBtn = e.target.closest('[data-vdel]');
    if (delBtn) {
      e.stopPropagation();
      if (!API) return;
      var id = delBtn.getAttribute('data-vdel');
      delBtn.disabled = true;
      try {
        var r = await API.deleteVersion(id);
        if (r && r.ok) {
          toast('已删除版本 ' + id, 'ok');
          ui.selected = null;
          await API.rescanVersions().catch(function () {});
          await loadVersions();
          await loadSaves();
          await loadMods();
        } else {
          toast('已取消删除', 'ok');
        }
      } catch (err) {
        toast('删除失败：' + err.message, 'error');
      } finally {
        delBtn.disabled = false;
      }
      return;
    }

    var row = e.target.closest('[data-vid]');
    if (row) {
      var vid = row.getAttribute('data-vid');
      ui.selected = ui.versions.filter(function (v) { return v.id === vid; })[0] || null;
      renderVersionList();
      renderManageDetail();
      resizeModel();
      return;
    }

    var save = e.target.closest('[data-save]');
    if (save) {
      var sname = save.getAttribute('data-save');
      var modNames = ui.mods.map(function (f) { return f.name; });
      if ($('#mgTitle')) $('#mgTitle').textContent = '存档—' + sname + ', mod - [' + (modNames.join(', ') || '无') + ']';
      if ($('#mgSub')) $('#mgSub').textContent = 'mod ' + ui.mods.length + ' · 存档 ' + ui.saves.length;
    }
  });

  function updateUtilVersion() {
    var el = $('#utilLaunchVersion');
    if (!el) return;
    var id = currentVersionId();
    el.textContent = id || '未选择版本';
    if ($('#utilHint')) $('#utilHint').textContent = id ? ('当前版本：' + id) : '点击启动将打开「管理 → 版本」';
  }

  /* 启动按钮：BMCL 主题下先跳到「管理 → 版本」 */
  function openManage() {
    var nav = document.querySelector('.nav-btn[data-page="manage"]');
    if (nav) nav.click();
    if (!ui.selected && ui.versions.length) {
      var cur = ui.versions.filter(function (v) { return v.id === currentVersionId(); })[0];
      ui.selected = cur || ui.versions[0];
      renderVersionList();
      renderManageDetail();
    }
    resizeModel();
  }

  ['#btnUtilLaunch', '#btnUtilManage'].forEach(function (sel) {
    var b = $(sel);
    if (b) b.addEventListener('click', openManage);
  });

  var mgLaunch = $('#mgLaunch');
  if (mgLaunch) {
    mgLaunch.addEventListener('click', async function () {
      if (!API) return;
      if (!ui.selected) { toast('请先选择版本', 'error'); return; }
      var id = ui.selected.id;
      try {
        await API.saveSettings({ versionId: id });
        ui.settings.versionId = id;
        updateUtilVersion();
        await API.launch(id);
        toast('正在启动 ' + id + '…', 'ok');
      } catch (err) { toast('启动失败：' + err.message, 'error'); }
    });
  }

  var mgOpenDir = $('#mgOpenDir');
  if (mgOpenDir) mgOpenDir.addEventListener('click', function () { if (API) API.openGameDir(); });

  var mgRescan = $('#mgRescan');
  if (mgRescan) {
    mgRescan.addEventListener('click', async function () {
      if (!API) return;
      try {
        await API.rescanVersions();
        await loadVersions();
        toast('已重新扫描版本', 'ok');
      } catch (err) { toast('扫描失败：' + err.message, 'error'); }
    });
  }

  var packSave = $('#mgPackSave');
  if (packSave) {
    packSave.addEventListener('click', function () {
      if (API) {
        API.saveSettings({
          memoryMB: Number($('#mgPackMem') && $('#mgPackMem').value) || 4096
        }).catch(function () {});
      }
      if ($('#mgPackHint')) $('#mgPackHint').textContent = '已保存';
      toast('整合包设置已保存', 'ok');
    });
  }

  /* ---------- 设置页额外项持久化 ---------- */
  function bindExtraSetting(id, key, def) {
    var el = document.getElementById(id);
    if (!el) return;
    var saved = localStorage.getItem('bmcl.' + key);
    el.checked = saved == null ? def : saved === '1';
    el.addEventListener('change', function () {
      localStorage.setItem('bmcl.' + key, el.checked ? '1' : '0');
    });
  }
  bindExtraSetting('setIntroAnim', 'introAnim', true);
  bindExtraSetting('setAutoBackup', 'autoBackup', false);

  /* ---------- 初始化 ---------- */
  async function loadSettings() {
    if (!API) return;
    try { ui.settings = await API.getSettings() || {}; } catch (e) { ui.settings = {}; }
    updateUtilVersion();
  }

  async function refreshAll() {
    await loadSettings();
    await loadVersions();
    await loadSaves();
    await loadMods();
  }

  document.addEventListener('bmcl:accounts', function () { refreshAccounts(); });
  document.addEventListener('bmcl:versions', function () {
    refreshAll();
  });

  renderServers();
  renderFavorites();
  refreshAll().then(function () {
    refreshAccounts();
    renderLastPlayed();
  });

  var mo = new MutationObserver(function () {
    if (onTheme()) {
      var active = document.querySelector('.page.active');
      if (active && active.id === 'page-util') resizeModel();
      syncPlayer();
      renderFavorites();
    }
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  window.bmclUi = {
    refresh: refreshAll,
    refreshAccounts: refreshAccounts,
    openManage: openManage
  };
})();
