/* ============================================================
   BMCL 2.2.0 · 仪表盘脚本
   - 侧栏「实用功能」实时推荐列表
   - 玩家模型 canvas 渲染（待机动作 + 披风）
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

  /* ---------- 玩家模型 ---------- */
  var cv = document.getElementById('skinCanvas');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  var W = 300, H = 260, dpr = 1, S = 9.6;

  function resize() {
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    W = r.width; H = r.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.min(H * 0.037, W * 0.05, 13);
  }
  window.addEventListener('resize', resize);
  setTimeout(resize, 30);

  var COL = {
    skin: '#c6976f', hair: '#33251b',
    shirt: '#2b6fb5', pants: '#2c3e6b', shoe: '#26292e',
    cape: '#1d4d80', capeHi: '#4890f5'
  };

  function part(cx, cy, cz, w, h, d, color, pivotY, sw) {
    return { c: [cx, cy, cz], s: [w, h, d], col: color, py: pivotY, sw: sw || 0 };
  }

  var BODY = [
    part(0, 16, 0, 8, 8, 8, COL.skin, 12, 0),
    part(0, 6, 0, 8, 12, 4, COL.shirt, 12, 0),
    part(6, 6, 0, 4, 12, 4, COL.skin, 12, 1),
    part(-6, 6, 0, 4, 12, 4, COL.skin, 12, -1),
    part(2.1, -6, 0, 3.7, 12, 4, COL.pants, 0, -1),
    part(-2.1, -6, 0, 3.7, 12, 4, COL.pants, 0, 1)
  ];

  var rotY = 0.52, rotX = 0.1, dragY = 0, dragX = 0, autoRotate = true, t = 0;
  var DIST = 46, FOC = 33;

  function rotPoint(p, yaw, pitch) {
    var x = p[0], y = p[1], z = p[2];
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var x1 = x * cy - z * sy, z1 = x * sy + z * cy;
    var cx2 = Math.cos(pitch), sx2 = Math.sin(pitch);
    return [x1, y * cx2 - z1 * sx2, y * sx2 + z1 * cx2];
  }

  function project(p, yaw, pitch) {
    var r = rotPoint(p, yaw, pitch);
    var k = FOC / (DIST - r[2]);
    return [W / 2 + r[0] * k * S, H * 0.56 - (r[1] - 2.5) * k * S, r[2]];
  }

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, ((n >> 16) & 255) * amt);
    var g = Math.min(255, ((n >> 8) & 255) * amt);
    var b = Math.min(255, (n & 255) * amt);
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  function hash(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  function drawFace(poly, color, shadeV, seed) {
    var a = poly[0], b = poly[1], c = poly[2], d = poly[3];
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fillStyle = shade(color, shadeV);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.16)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    for (var i = 0; i < 5; i++) {
      var u = hash(seed + i * 3.1), v = hash(seed + i * 7.7 + 1.3), du = 0.14, dv = 0.1;
      function P(uu, vv) {
        return [
          (1 - uu) * (1 - vv) * a[0] + uu * (1 - vv) * b[0] + uu * vv * c[0] + (1 - uu) * vv * d[0],
          (1 - uu) * (1 - vv) * a[1] + uu * (1 - vv) * b[1] + uu * vv * c[1] + (1 - uu) * vv * d[1]
        ];
      }
      var p1 = P(u, v), p2 = P(u + du, v), p3 = P(u + du, v + dv), p4 = P(u, v + dv);
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,' + (0.05 + hash(seed + i) * 0.07).toFixed(3) + ')';
      ctx.fill();
    }
  }

  function draw() {
    var yaw = rotY + dragY, pitch = rotX + dragX;
    var swing = Math.sin(t * 1.5) * 0.38;
    var bob = Math.sin(t * 1.5) * 0.22;
    var all = [], seed = 0, headFront = null;

    BODY.forEach(function (pt, pi) {
      var c = pt.c, s = pt.s;
      var ang = pt.sw * swing;
      var pivot = [c[0], pt.py, c[2]];
      var yOff = pi === 0 ? bob : 0;
      var x0 = c[0] - s[0] / 2, x1 = c[0] + s[0] / 2;
      var y0 = c[1] - s[1] / 2 + yOff, y1 = c[1] + s[1] / 2 + yOff;
      var z0 = c[2] - s[2] / 2, z1 = c[2] + s[2] / 2;

      function px(x, y, z) {
        var q = [x, y, z];
        if (pt.sw) {
          var dy = q[1] - pivot[1], dz = q[2] - pivot[2];
          var ca = Math.cos(ang), sa = Math.sin(ang);
          q[1] = pivot[1] + dy * ca - dz * sa;
          q[2] = pivot[2] + dy * sa + dz * ca;
        }
        return project(q, yaw, pitch);
      }

      var faces = [
        { v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], col: pt.col },
        { v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], col: pi === 0 ? COL.hair : pt.col },
        { v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], col: pt.col },
        { v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], col: pt.col },
        { v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], col: pi === 0 ? COL.hair : pt.col },
        { v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], col: pt.col }
      ];

      faces.forEach(function (f, fi) {
        var depth = 0, poly = [], nz = 0;
        f.v.forEach(function (q) { poly.push(px(q[0], q[1], q[2])); });
        poly.forEach(function (p) { depth += p[2]; });
        depth /= 4;

        var m = f.v[0], n = f.v[1], o = f.v[3];
        var e1 = [n[0] - m[0], n[1] - m[1], n[2] - m[2]];
        var e2 = [o[0] - m[0], o[1] - m[1], o[2] - m[2]];
        var nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        var rr = rotPoint(nr, yaw, pitch);
        var len = Math.sqrt(rr[0] * rr[0] + rr[1] * rr[1] + rr[2] * rr[2]) || 1;
        nz = rr[2] / len;

        if (pi === 0 && fi === 0 && nz > 0.01) headFront = poly.slice();
        all.push({
          depth: depth, poly: poly, seed: (seed += 7) + pi * 31 + fi,
          shadeV: 0.6 + Math.max(0, nz) * 0.34 + Math.max(0, rr[1] / len) * 0.14,
          col: f.col, visible: nz > 0.01
        });
      });
    });

    /* 披风：分行飘动 */
    var rows = 10, capTop = 12.2, capH = 16, capW = 13;
    for (var i = 0; i < rows; i++) {
      var yTop = capTop - (capH / rows) * i;
      var yBot = capTop - (capH / rows) * (i + 1);
      var flutter = Math.sin(t * 2.1 + i * 0.55) * (i / rows) * 1.25;
      var flare = Math.max(0, (i - 4) / (rows - 4)) * 1.4;
      var zBase = -2.5 - flare - flutter;
      var quad = [
        [-capW / 2, yTop, zBase], [capW / 2, yTop, zBase],
        [capW / 2, yBot, zBase], [-capW / 2, yBot, zBase]
      ].map(function (q) { return project(q, yaw, pitch); });
      var depth = (quad[0][2] + quad[1][2] + quad[2][2] + quad[3][2]) / 4;
      all.push({
        depth: depth, poly: quad, seed: 900 + i,
        shadeV: 0.74 + (i === rows - 1 ? 0.12 : 0),
        col: i === rows - 1 ? COL.capeHi : COL.cape, visible: true
      });
    }

    all.sort(function (a, b) { return a.depth - b.depth; });

    ctx.clearRect(0, 0, W, H);
    var g = ctx.createRadialGradient(W / 2, H * 0.82, 4, W / 2, H * 0.82, W * 0.42);
    g.addColorStop(0, 'rgba(19,112,243,.22)');
    g.addColorStop(1, 'rgba(19,112,243,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.82, W * 0.30, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    all.forEach(function (f) { if (f.visible) drawFace(f.poly, f.col, f.shadeV, f.seed); });

    /* 脸部像素 */
    if (headFront) {
      var q = headFront;
      function hp(u, v) {
        return [
          (1 - u) * (1 - v) * q[0][0] + u * (1 - v) * q[1][0] + u * v * q[2][0] + (1 - u) * v * q[3][0],
          (1 - u) * (1 - v) * q[0][1] + u * (1 - v) * q[1][1] + u * v * q[2][1] + (1 - u) * v * q[3][1]
        ];
      }
      function pixel(u0, v0, u1, v1, fill) {
        var p1 = hp(u0, v0), p2 = hp(u1, v0), p3 = hp(u1, v1), p4 = hp(u0, v1);
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]); ctx.lineTo(p4[0], p4[1]);
        ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      }
      pixel(0.24, 0.42, 0.38, 0.56, '#f2f2f2');
      pixel(0.62, 0.42, 0.76, 0.56, '#f2f2f2');
      pixel(0.29, 0.46, 0.35, 0.54, '#365b8c');
      pixel(0.67, 0.46, 0.73, 0.54, '#365b8c');
    }
  }

  function loop(now) {
    if (!loop.last) loop.last = now;
    var dt = Math.min(0.05, (now - loop.last) / 1000);
    loop.last = now;
    t += dt;
    if (autoRotate && !dragging) rotY += dt * 0.22;
    if (W) draw();
    requestAnimationFrame(loop);
  }

  var dragging = false, lastX = 0, lastY = 0;
  cv.addEventListener('pointerdown', function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY; cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    dragY += (e.clientX - lastX) * 0.012;
    dragX = Math.max(-0.5, Math.min(0.5, dragX + (e.clientY - lastY) * 0.006));
    lastX = e.clientX; lastY = e.clientY;
  });
  cv.addEventListener('pointerup', function () { dragging = false; });

  var btnRotate = document.getElementById('btnRotate');
  if (btnRotate) {
    btnRotate.addEventListener('click', function () {
      autoRotate = !autoRotate;
      this.textContent = '自动旋转：' + (autoRotate ? '开' : '关');
    });
  }

  window.bmclModelResize = resize;
  resize();
  requestAnimationFrame(loop);
})();
