'use strict';

/**
 * 节日彩蛋渲染层：愚人节 / 春节。
 * 只改界面，不碰游戏数据；设置里可随时关闭。
 */
(function () {
  var state = {
    festival: null,
    timers: [],
    aprilTimer: null,
    greetingTimer: null,
    raf: 0,
    nodes: [],
    navOrder: null,
    versionTexts: null
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function rand(n) { return Math.floor(Math.random() * n); }
  function pick(list) { return list && list.length ? list[rand(list.length)] : null; }
  function later(fn, ms) { var id = setTimeout(fn, ms); state.timers.push(id); return id; }
  function every(fn, ms) { var id = setInterval(fn, ms); state.timers.push(id); return id; }

  function removeNode(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function clearFx() {
    state.timers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
    state.timers = [];
    state.aprilTimer = null;
    state.greetingTimer = null;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    document.body.classList.remove('festival-spring', 'festival-april');
    $$('.festival-node').forEach(removeNode);
    $$('.festival-jitter').forEach(function (el) { el.classList.remove('festival-jitter'); });
    $$('[data-festival-touched]').forEach(function (el) {
      el.removeAttribute('data-festival-touched');
      if (el.dataset.festivalOriginal) {
        el.style.transform = el.dataset.festivalOriginal;
        delete el.dataset.festivalOriginal;
      }
    });
    if (state.navOrder) {
      state.navOrder.forEach(function (item) { item.el.style.order = item.order; });
      state.navOrder = null;
    }
    if (state.versionTexts) {
      state.versionTexts.forEach(function (item) { item.el.textContent = item.text; });
      state.versionTexts = null;
    }
    var title = $('.tb-name');
    if (title && title.dataset.festivalOriginal) {
      title.textContent = title.dataset.festivalOriginal;
      delete title.dataset.festivalOriginal;
    }
  }

  function ownToast(text) {
    var wrap = $('#toastWrap');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast festival-node';
    el.textContent = text;
    wrap.appendChild(el);
    later(function () { removeNode(el); }, 3200);
  }

  function addBadge(label, onClose) {
    var badge = document.createElement('div');
    badge.className = 'festival-badge festival-node';
    badge.innerHTML = '<span>' + label + '</span>';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '关闭彩蛋';
    btn.addEventListener('click', onClose);
    badge.appendChild(btn);
    document.body.appendChild(badge);
    return badge;
  }

  function turnOff() {
    if (window.bmcl && window.bmcl.saveSettings) {
      window.bmcl.saveSettings({ festivalMode: 'off' }).then(load).catch(load);
    } else {
      clearFx();
    }
  }

  /* ================= 愚人节 ================= */
  function aprilJitter() {
    var targets = $$('.btn, .fx-btn, .nav-btn, .set-cat, .pa-btn').filter(function (el) {
      return el.offsetParent !== null && !el.classList.contains('festival-jitter');
    });
    var el = pick(targets);
    if (!el) return;
    el.classList.add('festival-jitter');
    later(function () { el.classList.remove('festival-jitter'); }, 2200);
  }

  function aprilNavSwap() {
    var navs = $$('.nav-btn');
    if (navs.length < 2) return;
    var a = rand(navs.length);
    var b = rand(navs.length);
    if (a === b) b = (b + 1) % navs.length;
    var first = navs[a];
    var second = navs[b];
    state.navOrder = [{ el: first, order: first.style.order }, { el: second, order: second.style.order }];
    first.style.order = String(b + 1);
    second.style.order = String(a + 1);
    later(function () {
      first.style.order = state.navOrder[0].order;
      second.style.order = state.navOrder[1].order;
      state.navOrder = null;
    }, 4200);
  }

  function aprilAvatarFlip() {
    var targets = [$('#playerAvatar'), $('#acOfflineAvatar')].filter(Boolean);
    if (!targets.length) return;
    targets.forEach(function (el) {
      el.dataset.festivalOriginal = el.style.transform || '';
      el.style.transform = 'scaleX(-1)';
    });
    later(function () {
      targets.forEach(function (el) {
        el.style.transform = el.dataset.festivalOriginal || '';
        delete el.dataset.festivalOriginal;
      });
    }, 3800);
  }

  function aprilVersionSuffix() {
    var labels = ['#sideVersion', '#updVersion', '#updVersion2', '#codeVer']
      .map(function (sel) { return $(sel); })
      .filter(Boolean);
    if (!labels.length) return;
    state.versionTexts = labels.map(function (el) { return { el: el, text: el.textContent }; });
    labels.forEach(function (el) {
      if (!/愚人节/.test(el.textContent)) el.textContent = el.textContent + ' 愚人节';
    });
    later(function () {
      if (!state.versionTexts) return;
      state.versionTexts.forEach(function (item) { item.el.textContent = item.text; });
      state.versionTexts = null;
    }, 5200);
  }

  function aprilTitleGlitch() {
    var title = $('.tb-name');
    if (!title) return;
    title.dataset.festivalOriginal = title.textContent;
    title.textContent = pick(['BMCL?', 'B M C L', 'BMCL 2.4.0', 'BMCL（真的）']) || 'BMCL?';
    later(function () {
      if (title.dataset.festivalOriginal) {
        title.textContent = title.dataset.festivalOriginal;
        delete title.dataset.festivalOriginal;
      }
    }, 1500);
  }

  function aprilGhostCursor() {
    var ghost = document.createElement('div');
    ghost.className = 'april-ghost-cursor festival-node';
    document.body.appendChild(ghost);
    var ox = 18 + rand(10);
    var oy = 14 + rand(8);
    function onMove(e) {
      ghost.style.left = (e.clientX + ox) + 'px';
      ghost.style.top = (e.clientY + oy) + 'px';
    }
    document.addEventListener('mousemove', onMove);
    later(function () {
      document.removeEventListener('mousemove', onMove);
      removeNode(ghost);
    }, 4200);
  }

  var APRIL_ACTIONS = [
    aprilJitter, aprilJitter, aprilNavSwap, aprilAvatarFlip,
    aprilVersionSuffix, aprilTitleGlitch, aprilGhostCursor
  ];

  function aprilTick() {
    if (!state.festival || state.festival.id !== 'april') return;
    if (Math.random() < 0.65) {
      var action = pick(APRIL_ACTIONS);
      if (action) action();
    }
    if (Math.random() < 0.55) {
      var toasts = (state.festival && state.festival.toasts) || [];
      var text = pick(toasts);
      if (text) ownToast(text);
    }
    state.aprilTimer = later(aprilTick, 12000 + rand(14000));
  }

  function startApril() {
    document.body.classList.add('festival-april');
    addBadge('愚人节模式', turnOff);
    ownToast('今天启动器可能有一点点奇怪，别当真。');
    state.aprilTimer = later(aprilTick, 6000);
  }

  /* ================= 春节 ================= */
  function makeLanterns() {
    var wrap = document.createElement('div');
    wrap.className = 'festival-lanterns festival-node';
    wrap.innerHTML = '<i class="festival-lantern left"></i><i class="festival-lantern right"></i>';
    document.body.appendChild(wrap);
  }

  function makeBanner(greetings) {
    var banner = document.createElement('div');
    banner.className = 'festival-banner festival-node';
    banner.innerHTML =
      '<div class="festival-banner-inner">' +
      '<div class="festival-greet" id="festivalGreet"></div>' +
      '<div class="festival-sub">新春快乐 · BMCL 陪你过年</div>' +
      '</div>';
    document.body.appendChild(banner);
    var greet = banner.querySelector('#festivalGreet');
    var index = 0;
    function show() {
      if (!greet) return;
      greet.textContent = greetings[index % greetings.length] || '新春快乐';
      greet.classList.remove('in');
      void greet.offsetWidth;
      greet.classList.add('in');
      index++;
    }
    show();
    state.greetingTimer = every(show, 9000);
  }

  function startFireworks(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var particles = [];
    var rockets = [];
    var width = 0;
    var height = 0;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      width = canvas.width = Math.max(1, Math.floor(rect.width));
      height = canvas.height = Math.max(1, Math.floor(rect.height));
    }
    resize();
    window.addEventListener('resize', resize);

    function launch() {
      rockets.push({
        x: width * (0.2 + Math.random() * 0.6),
        y: height + 4,
        vy: -(1.6 + Math.random() * 1.3),
        target: height * (0.18 + Math.random() * 0.3),
        hue: pick([42, 8, 350, 28, 50, 0])
      });
    }

    function burst(rocket) {
      var count = 26 + rand(14);
      for (var i = 0; i < count; i++) {
        var angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
        var speed = 0.7 + Math.random() * 2.1;
        particles.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          decay: 0.006 + Math.random() * 0.008,
          hue: rocket.hue,
          size: 1 + Math.random() * 1.8
        });
      }
    }

    function frame() {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(18, 6, 8, 0.28)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';

      if (Math.random() < 0.055) launch();

      for (var r = rockets.length - 1; r >= 0; r--) {
        var rocket = rockets[r];
        rocket.y += rocket.vy;
        rocket.vy += 0.012;
        ctx.beginPath();
        ctx.fillStyle = 'hsla(' + rocket.hue + ', 95%, 72%, .9)';
        ctx.arc(rocket.x, rocket.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
        if (rocket.y <= rocket.target || rocket.vy >= 0) {
          burst(rocket);
          rockets.splice(r, 1);
        }
      }

      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.012;
        p.vx *= 0.988;
        p.life -= p.decay;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.beginPath();
        ctx.fillStyle = 'hsla(' + p.hue + ', 95%, ' + (55 + p.life * 20) + '%, ' + p.life + ')';
        ctx.arc(p.x, p.y, p.size * p.life + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      state.raf = requestAnimationFrame(frame);
    }
    frame();
  }

  function makeFestivalVideo() {
    var card = document.createElement('div');
    card.className = 'festival-card festival-node';
    card.innerHTML =
      '<div class="festival-card-head"><span>春节 · 烟花</span><span class="festival-card-tip">动态贺卡</span></div>' +
      '<div class="festival-card-stage"><canvas></canvas><video muted loop autoplay playsinline></video></div>' +
      '<div class="festival-card-foot">愿方块世界也灯火通明</div>';
    document.body.appendChild(card);

    var canvas = card.querySelector('canvas');
    var video = card.querySelector('video');
    if (canvas) startFireworks(canvas);
    if (video) {
      video.addEventListener('error', function () { video.style.display = 'none'; });
      video.src = 'assets/festival/fireworks.mp4';
      var play = video.play();
      if (play && play.catch) play.catch(function () { video.style.display = 'none'; });
      video.addEventListener('playing', function () { video.classList.add('on'); });
    }
  }

  function startSpring(festival) {
    document.body.classList.add('festival-spring');
    makeLanterns();
    makeBanner(festival.greetings && festival.greetings.length ? festival.greetings : ['新春快乐']);
    makeFestivalVideo();
    addBadge('春节模式', turnOff);
  }

  /* ================= 入口 ================= */
  function apply(festival) {
    clearFx();
    state.festival = festival || { id: '', active: false };
    if (!state.festival.active) return;
    if (state.festival.id === 'april') startApril();
    else if (state.festival.id === 'spring') startSpring(state.festival);
  }

  function load() {
    if (!window.bmcl || !window.bmcl.getFestival) return Promise.resolve();
    return window.bmcl.getFestival().then(apply).catch(function () { apply(null); });
  }

  window.bmclReloadFestival = load;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
