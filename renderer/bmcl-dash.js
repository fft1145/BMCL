/* ============================================================
   BMCL 2.2.0 · 仪表盘脚本
   - 侧栏「实用功能」实时推荐列表
   - 玩家模型：LittleSkin 风格 3D 渲染（真实皮肤 + 待机动作）
   只在 BMCL 主题下启动，PCL 主题不受影响。
   ============================================================ */
(function () {
  if (!document.body.classList.contains('theme-bmcl')) return;

  /* ---------- 实时推荐 ---------- */
  var RECO = {
    server: [
      { n: '花雨庭 · 空岛战争', m: '1.8.9 · 小游戏服', v: '12,486 在线' },
      { n: '梦回盘灵 · 生存服', m: '1.20.1 · 原版生存', v: '6,231 在线' },
      { n: '星火之境 · 空岛', m: '1.12.2 · 空岛生存', v: '4,027 在线' },
      { n: '酷云服务器 · 起床', m: '1.8.9 · 起床战争', v: '3,845 在线' },
      { n: '幻境 · RPG 冒险', m: '1.19.2 · 角色扮演', v: '2,190 在线' }
    ],
    mod: [
      { n: '机械动力 Create', m: '1.20.1 · 科技', v: '128.4 万' },
      { n: 'JEI 物品管理器', m: '1.20.1 · 辅助', v: '96.2 万' },
      { n: '钠 Sodium', m: '1.20.1 · 优化', v: '88.7 万' },
      { n: 'Iris 光影加载', m: '1.20.1 · 画面', v: '61.3 万' },
      { n: '农夫乐事', m: '1.20.1 · 农业', v: '54.9 万' }
    ],
    version: [
      { n: '1.20.1', m: 'Forge / NeoForge / Fabric', v: '34.2% 玩家' },
      { n: '1.21.1', m: '当前主流新版', v: '21.6% 玩家' },
      { n: '1.12.2', m: '经典模组版本', v: '14.8% 玩家' },
      { n: '1.19.2', m: '模组兼容良好', v: '9.3% 玩家' },
      { n: '1.16.5', m: '稳定老版本', v: '7.1% 玩家' }
    ],
    pack: [
      { n: '格雷科技：现代', m: '1.20.1 · 硬核科技', v: '18.6 万下载' },
      { n: '天空工厂 4', m: '1.19.2 · 空岛整合', v: '12.3 万下载' },
      { n: 'RLCraft', m: '1.12.2 · 极限生存', v: '9.8 万下载' },
      { n: '机械动力：星空', m: '1.20.1 · 科技冒险', v: '8.4 万下载' },
      { n: '匠魂生存', m: '1.18.2 · 工具向', v: '6.2 万下载' }
    ],
    map: [
      { n: '失落之城 · 冒险', m: '1.20.1 · 冒险地图', v: '7.9 万收藏' },
      { n: '空岛生存 V', m: '1.20.1 · 生存地图', v: '6.4 万收藏' },
      { n: '跑酷天堂 2', m: '1.19.2 · 跑酷', v: '5.1 万收藏' },
      { n: '密室逃脱', m: '1.18.2 · 解谜', v: '4.3 万收藏' },
      { n: '遗迹探险', m: '1.20.1 · 探索', v: '3.6 万收藏' }
    ]
  };

  var recoList = document.getElementById('recoList');
  function renderReco(cat) {
    if (!recoList) return;
    recoList.innerHTML = RECO[cat].map(function (it, i) {
      return '<div class="reco-item">' +
        '<span class="reco-rank' + (i < 2 ? ' top' : '') + '">' + (i + 1) + '</span>' +
        '<div class="reco-main"><div class="reco-name">' + it.n + '</div>' +
        '<div class="reco-meta">' + it.m + '</div></div>' +
        '<span class="reco-num">' + it.v + '</span></div>';
    }).join('');
  }
  renderReco('server');
  var activeCat = 'server';

  document.querySelectorAll('.utab').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.utab').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      activeCat = b.dataset.cat;
      renderReco(activeCat);
    });
  });

  /* 最近游玩的存档（占位数据，后续接实例扫描结果） */
  var SAVES = [
    { n: '无尽荒野', m: '1.20.1 · Forge 47.2.0 · 生存', t: '2 小时前', h: '12.4 h' },
    { n: '机械动力研究所', m: '1.20.1 · Forge 47.2.0 · 创造', t: '昨天', h: '6.2 h' },
    { n: '空岛生存', m: '1.12.2 · Forge 14.23.5 · 生存', t: '3 天前', h: '41.8 h' }
  ];
  var recentList = document.getElementById('recentList');
  if (recentList) {
    recentList.innerHTML = SAVES.map(function (s) {
      return '<div class="sav-row"><div class="sav-ico">🗺</div><div class="sav-main">' +
        '<div class="sav-name">' + s.n + '</div><div class="sav-meta">' + s.m + '</div></div>' +
        '<div class="sav-time">' + s.t + ' · ' + s.h + '</div></div>';
    }).join('');
  }

  window.renderBmclDashboard = function () {
    renderReco(activeCat);
  };

  /* ---------- 玩家模型：LittleSkin 风格 3D 渲染 ---------- */
  var cv = document.getElementById('skinCanvas');
  if (!cv) return;

  var viewer = null;
  var loadedKey = '';
  var pending = false;

  function ensureViewer() {
    if (viewer) return viewer;
    if (!window.SkinViewer) return null;
    viewer = new window.SkinViewer(cv);
    if (!viewer.ok) {
      viewer = null;
      return null;
    }
    return viewer;
  }

  function currentPlayerName() {
    var el = document.getElementById('hmPlayer');
    var name = el ? String(el.textContent || '').trim() : '';
    if (!name || name === '未登录') return '';
    return name;
  }

  function fileUrl(p) {
    var normalized = String(p).replace(/\\/g, '/');
    return encodeURI('file:///' + normalized.replace(/^\/+/, ''));
  }

  async function loadSkin(force) {
    if (pending) return;
    var v = ensureViewer();
    if (!v) return;
    var name = currentPlayerName();
    if (!name && !loadedKey) return;
    pending = true;
    try {
      /* 优先用本地已保存的皮肤（和皮肤页用的是同一张图） */
      var info = null;
      try {
        if (window.bmcl && window.bmcl.skinCurrentFile) info = await window.bmcl.skinCurrentFile();
      } catch (e) { info = null; }
      if (info && info.file) {
        var localKey = 'local:' + info.file;
        if (force || localKey !== loadedKey) {
          await v.loadFromURL(fileUrl(info.file));
          loadedKey = localKey;
          v.start();
        }
        return;
      }
      if (!name) return;
      /* 没有本地皮肤时按用户名取正版皮肤 */
      var url = 'https://mc-heads.net/skin/' + encodeURIComponent(name);
      if (force || url !== loadedKey) {
        await v.loadFromURL(url);
        loadedKey = url;
        v.start();
      }
    } catch (e) {
      loadedKey = '';
    } finally {
      pending = false;
    }
  }

  window.bmclModelResize = function () {
    if (viewer) viewer.draw();
  };
  window.bmclModelRefresh = function () { loadSkin(true); };
  window.addEventListener('bmcl:player-change', function () { loadSkin(true); });
  window.addEventListener('resize', function () {
    if (viewer) viewer.draw();
  });

  var btnRotate = document.getElementById('btnRotate');
  if (btnRotate) {
    btnRotate.addEventListener('click', function () {
      var v = ensureViewer();
      if (!v) return;
      v.autoRotate = !v.autoRotate;
      if (v.autoRotate) v.start();
      this.textContent = '自动旋转：' + (v.autoRotate ? '开' : '关');
    });
  }

  setTimeout(function () { loadSkin(true); }, 200);
})();
