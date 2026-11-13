'use strict';

/* ===== BMCL 2.3.0 增强功能：AI / 音乐 / 外观 / 皮肤 / Java ===== */

(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    settings: null,
    presets: [],
    tracks: [],
    trackIndex: -1,
    aiHistory: [],
    viewer: null,
    audio: null,
    skinFile: null,
    crashReport: null
  };

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(message, type) {
    const wrap = $('#toastWrap');
    if (!wrap) return;
    const node = document.createElement('div');
    node.className = 'toast' + (type ? ' ' + type : '');
    node.textContent = message;
    wrap.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function fmt(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }

  function fileUrl(p) {
    if (!p) return '';
    const normalized = String(p).replace(/\\/g, '/');
    return encodeURI('file:///' + normalized.replace(/^\/+/, ''));
  }

  async function saveSettings(patch) {
    state.settings = await bmcl.saveSettings(patch);
    return state.settings;
  }

  /* ---------------- 导航与标签 ---------------- */
  function initTabs() {
    $$('.fx-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.fx-tab').forEach((t) => t.classList.toggle('on', t === tab));
        $$('.fx-pane').forEach((p) => p.classList.toggle('on', p.dataset.fxpane === tab.dataset.fxtab));
        if (tab.dataset.fxtab === 'skin') refreshSkinPane();
        if (tab.dataset.fxtab === 'java') renderJava();
        if (tab.dataset.fxtab === 'look') renderLook();
      });
    });
  }

  /* ---------------- 外观应用 ---------------- */
  function applyAppearance() {
    const s = state.settings;
    if (!s) return;
    const html = document.documentElement;
    const preset = (state.presets || []).find((p) => p.key === s.themePreset) || { key: 'default' };
    const vars = resolveVars(s.themePreset, s.customTheme);
    if (s.themePreset && s.themePreset !== 'default') {
      html.classList.add('fx-themed');
      Object.keys(vars).forEach((key) => {
        html.style.setProperty('--fx-' + key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), vars[key]);
      });
      // 同时覆盖主样式变量
      html.style.setProperty('--bg', vars.bg);
      html.style.setProperty('--side', vars.side || vars.bg);
      html.style.setProperty('--side-2', vars.side2 || vars.card);
      html.style.setProperty('--card', vars.card);
      html.style.setProperty('--card-2', vars.card2 || vars.card);
      html.style.setProperty('--line', vars.line || vars.muted);
      html.style.setProperty('--line-soft', vars.line || vars.muted);
      html.style.setProperty('--text', vars.text);
      html.style.setProperty('--muted', vars.muted);
      html.style.setProperty('--blue', vars.accent);
      html.style.setProperty('--blue-strong', vars.accentStrong || vars.accent);
      html.style.setProperty('--blue-soft', vars.accentSoft || vars.card);
      html.classList.toggle('fx-dark', Boolean(preset.dark));
    } else {
      html.classList.remove('fx-themed');
      html.classList.remove('fx-dark');
      ['--fx-bg', '--fx-card', '--fx-text', '--fx-muted', '--fx-accent', '--fx-line',
        '--fx-bg', '--card', '--card-2', '--line', '--line-soft', '--text', '--muted',
        '--blue', '--blue-strong', '--blue-soft'].forEach((k) => html.style.removeProperty(k));
    }

    applyCustomCss(s.customCss || '');
    applyWallpaper(s.wallpaper);
  }

  function resolveVars(presetKey, custom) {
    const preset = (state.presets || []).find((p) => p.key === presetKey);
    if (presetKey === 'custom' && custom) {
      return {
        bg: custom.bg, side: custom.bg, side2: custom.card, card: custom.card, card2: custom.card,
        line: custom.muted, text: custom.text, muted: custom.muted, accent: custom.accent,
        accentStrong: custom.accent, accentSoft: custom.card,
        titleFrom: custom.titleFrom, titleTo: custom.titleTo
      };
    }
    if (preset && preset.vars) {
      return Object.assign({
        bg: '#fbfbfb', side: '#eaf2fe', side2: '#e0eafd', card: '#ffffff', card2: '#f7fafd',
        line: '#dde6f0', text: '#343d4a', muted: '#737373', accent: '#1370f3',
        accentStrong: '#0b5bcb', accentSoft: '#e0eafd', titleFrom: '#1370f3', titleTo: '#0b5bcb'
      }, preset.vars);
    }
    return {
      bg: '#fbfbfb', side: '#eaf2fe', side2: '#e0eafd', card: '#ffffff', card2: '#f7fafd',
      line: '#dde6f0', text: '#343d4a', muted: '#737373', accent: '#1370f3',
      accentStrong: '#0b5bcb', accentSoft: '#e0eafd', titleFrom: '#1370f3', titleTo: '#0b5bcb'
    };
  }

  function applyCustomCss(css) {
    let node = $('#fxCustomCss');
    if (!node) {
      node = document.createElement('style');
      node.id = 'fxCustomCss';
      document.head.appendChild(node);
    }
    node.textContent = css || '';
  }

  function applyWallpaper(wall) {
    const layer = $('#fxWall');
    if (!layer) return;
    const body = document.body;
    const valid = wall && wall.path && wall.type !== 'none';
    body.classList.toggle('fx-has-wall', Boolean(valid));
    if (!valid) {
      layer.innerHTML = '';
      return;
    }
    const url = fileUrl(wall.path);
    const dim = Number(wall.dim) || 0;
    const blur = Number(wall.blur) || 0;
    const filter = blur ? 'filter:blur(' + blur + 'px);transform:scale(1.04)' : '';
    if (wall.type === 'video') {
      layer.innerHTML = '<video src="' + url + '" autoplay muted loop playsinline style="' + filter + '"></video>' +
        '<div style="position:absolute;inset:0;background:#000;opacity:' + dim + '"></div>';
      const video = layer.querySelector('video');
      if (video) video.play().catch(() => { /* 自动播放被拒绝时忽略 */ });
    } else {
      layer.innerHTML = '<img src="' + url + '" alt="" style="' + filter + '">' +
        '<div style="position:absolute;inset:0;background:#000;opacity:' + dim + '"></div>';
    }
  }

  /* ---------------- 头像：从皮肤裁大头照 ---------------- */
  function cropHead(skinUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
        try {
          ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
        } catch (e) { /* 旧皮肤没有帽子层 */ }
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve('');
      img.src = skinUrl;
    });
  }

  let avatarBusy = false;
  async function refreshAvatar() {
    if (avatarBusy) return;
    avatarBusy = true;
    try {
      const info = await bmcl.skinCurrentFile();
      if (!info || !info.file) return;
      state.skinFile = info.file;
      const head = await cropHead(fileUrl(info.file));
      if (!head) return;
      ['#playerAvatar', '#tbAvatar', '#acAvatar', '#fxSkinHead'].forEach((sel) => {
        const img = $(sel);
        if (!img) return;
        img.onerror = null;
        img.src = head;
      });
      if (state.viewer && !state.viewer.texture) {
        loadSkinIntoViewer(info.file);
      }
    } catch (e) {
      /* 未登录或网络失败时保持默认头像 */
    } finally {
      avatarBusy = false;
    }
  }

  /* ---------------- 3D 皮肤 ---------------- */
  function ensureViewer() {
    const canvas = $('#fxSkinCanvas');
    if (!canvas || !window.SkinViewer) return null;
    if (!state.viewer) {
      state.viewer = new window.SkinViewer(canvas);
      if (!state.viewer.ok) {
        $('#fxSkinIdle').textContent = '当前环境不支持 WebGL，无法渲染 3D 模型';
        state.viewer = null;
      }
    }
    return state.viewer;
  }

  async function loadSkinIntoViewer(filePath) {
    const viewer = ensureViewer();
    if (!viewer || !filePath) return;
    try {
      await viewer.loadFromURL(fileUrl(filePath));
      const idle = $('#fxSkinIdle');
      if (idle) idle.textContent = '按住拖动可以旋转模型';
    } catch (e) {
      toast('皮肤预览加载失败：' + e.message, 'error');
    }
  }

  /* ---------------- AI ---------------- */
  function appendMsg(role, text, extraClass) {
    const log = $('#fxAiLog');
    if (!log) return;
    const node = document.createElement('div');
    node.className = 'fx-msg ' + (role === 'user' ? 'user' : 'bot') + (extraClass ? ' ' + extraClass : '');
    node.innerHTML = '<div class="fx-msg-role">' + (role === 'user' ? '我' : 'BMCL 助手') + '</div>' +
      '<div class="fx-msg-text">' + esc(text).replace(/\n/g, '<br>') + '</div>';
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
  }

  async function sendAi(text) {
    const content = String(text || '').trim();
    if (!content) return;
    const keyInput = $('#fxAiKey');
    if (keyInput && keyInput.value.trim() && !state.settings.aiApiKey) {
      await saveSettings({ aiApiKey: keyInput.value.trim() });
    }
    if (!state.settings.aiApiKey) {
      toast('请先填写 DeepSeek API Key', 'error');
      appendMsg('bot', '还没有填写 API Key。把 DeepSeek 的 Key 粘贴到下方输入框，点「保存 Key」就能用了。', 'err');
      return;
    }
    appendMsg('user', content);
    state.aiHistory.push({ role: 'user', content });
    const btn = $('#fxAiSend');
    if (btn) btn.disabled = true;
    const thinking = document.createElement('div');
    thinking.className = 'fx-msg bot';
    thinking.innerHTML = '<div class="fx-msg-role">BMCL 助手</div><div class="fx-msg-text">正在思考…</div>';
    $('#fxAiLog').appendChild(thinking);
    $('#fxAiLog').scrollTop = $('#fxAiLog').scrollHeight;
    try {
      const res = await bmcl.aiChat({ messages: state.aiHistory.slice(-10) });
      thinking.remove();
      appendMsg('bot', res.reply);
      state.aiHistory.push({ role: 'assistant', content: res.reply });
    } catch (err) {
      thinking.remove();
      appendMsg('bot', err.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function analyzeCrashWithAi() {
    if (!state.settings.aiApiKey) {
      toast('请先填写 DeepSeek API Key', 'error');
      return;
    }
    appendMsg('user', '帮我分析这次崩溃');
    const thinking = document.createElement('div');
    thinking.className = 'fx-msg bot';
    thinking.innerHTML = '<div class="fx-msg-role">BMCL 助手</div><div class="fx-msg-text">正在读取日志并分析…</div>';
    $('#fxAiLog').appendChild(thinking);
    try {
      const res = await bmcl.aiCrash({ report: state.crashReport || undefined });
      thinking.remove();
      appendMsg('bot', res.reply);
      state.aiHistory.push({ role: 'user', content: res.question });
      state.aiHistory.push({ role: 'assistant', content: res.reply });
    } catch (err) {
      thinking.remove();
      appendMsg('bot', err.message, 'err');
    }
  }

  function showCrashCard(report) {
    state.crashReport = report || null;
    const old = $('#fxCrashCard');
    if (old) old.remove();
    if (!report) return;
    const card = document.createElement('div');
    card.id = 'fxCrashCard';
    card.style.cssText = 'position:fixed;right:18px;bottom:18px;width:360px;z-index:60;background:var(--card);' +
      'border:1px solid var(--line);border-left:4px solid #d9534f;border-radius:6px;padding:12px 14px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:12.5px;line-height:1.7';
    const causes = (report.causes || []).slice(0, 3)
      .map((c) => '<li>' + esc(c.cause || c) + (c.hint ? '<br><span style="color:var(--muted)">' + esc(c.hint) + '</span>' : '') + '</li>')
      .join('');
    card.innerHTML = '<div style="font-weight:700;margin-bottom:6px">检测到游戏异常退出</div>' +
      '<div style="color:var(--muted);margin-bottom:6px">' + esc(report.summary || '已自动完成本地诊断') + '</div>' +
      (causes ? '<ul style="margin:0 0 8px 16px;padding:0">' + causes + '</ul>' : '') +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="fx-btn fx-btn-mini" id="fxCrashClose">关闭</button>' +
      '<button class="fx-btn fx-btn-mini fx-btn-primary" id="fxCrashAi">让 AI 分析</button></div>';
    document.body.appendChild(card);
    $('#fxCrashClose').onclick = () => card.remove();
    $('#fxCrashAi').onclick = () => {
      card.remove();
      const nav = $('.nav-btn[data-page="fx"]');
      if (nav) nav.click();
      const tab = $('.fx-tab[data-fxtab="ai"]');
      if (tab) tab.click();
      analyzeCrashWithAi();
    };
  }

  /* ---------------- 音乐 ---------------- */
  function ensureAudio() {
    if (state.audio) return state.audio;
    const audio = new Audio();
    audio.preload = 'none';
    audio.volume = Number(state.settings.musicVolume) || 0.7;
    audio.addEventListener('timeupdate', () => {
      const el = $('#fxMpTime');
      if (el) el.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
    });
    audio.addEventListener('ended', () => playNext());
    audio.addEventListener('play', () => { const b = $('#fxMpPlay'); if (b) b.textContent = '⏸'; });
    audio.addEventListener('pause', () => { const b = $('#fxMpPlay'); if (b) b.textContent = '▶'; });
    audio.addEventListener('error', () => {
      const track = state.tracks[state.trackIndex];
      if (track && track.backupUrls && track.backupUrls.length) {
        const next = track.backupUrls.shift();
        audio.src = next;
        audio.play().catch(() => {});
      } else {
        toast('音频加载失败，换一首试试', 'error');
      }
    });
    state.audio = audio;
    return audio;
  }

  async function searchMusic() {
    const input = $('#fxMusicQuery');
    const keyword = input ? input.value.trim() : '';
    if (!keyword) return;
    const list = $('#fxMusicList');
    list.innerHTML = '<p class="fx-hint" style="padding:12px">正在搜索 B 站…</p>';
    try {
      const results = await bmcl.musicSearch(keyword, 1);
      if (!results.length) {
        list.innerHTML = '<p class="fx-hint" style="padding:12px">没有找到结果，换个关键词试试。</p>';
        return;
      }
      list.innerHTML = results.map((item, i) =>
        '<div class="fx-track" data-index="' + i + '">' +
        '<div class="fx-track-idx">' + (i + 1) + '</div>' +
        '<div class="fx-track-main"><div class="fx-track-title">' + esc(item.title) + '</div>' +
        '<div class="fx-track-sub">' + esc(item.author) + '</div></div>' +
        '<div class="fx-track-dur">' + fmt(item.duration) + '</div></div>'
      ).join('');
      state.tracks = results;
      $$('.fx-track', list).forEach((node) => {
        node.addEventListener('click', () => playTrack(Number(node.dataset.index)));
      });
    } catch (err) {
      list.innerHTML = '<p class="fx-hint" style="padding:12px;color:var(--danger)">' + esc(err.message) + '</p>';
    }
  }

  async function playTrack(index) {
    const track = state.tracks[index];
    if (!track) return;
    state.trackIndex = index;
    $$('.fx-track').forEach((node, i) => node.classList.toggle('on', i === index));
    const audio = ensureAudio();
    $('#fxMpTitle').textContent = track.title;
    $('#fxMpAuthor').textContent = track.author || '—';
    $('#fxMpCover').src = track.cover || '';
    const time = $('#fxMpTime');
    if (time) time.textContent = '0:00 / ' + fmt(track.duration);
    try {
      const info = await bmcl.musicResolve(track.bvid);
      track.resolved = info;
      track.backupUrls = (info.backupUrls || []).slice();
      audio.src = info.url;
      await audio.play();
    } catch (err) {
      toast('播放失败：' + err.message, 'error');
    }
  }

  function playNext() {
    if (!state.tracks.length) return;
    playTrack((state.trackIndex + 1) % state.tracks.length);
  }

  function playPrev() {
    if (!state.tracks.length) return;
    playTrack((state.trackIndex - 1 + state.tracks.length) % state.tracks.length);
  }

  /* ---------------- 外观面板 ---------------- */
  async function renderLook() {
    const box = $('#fxPresets');
    if (!box) return;
    if (!state.presets.length) {
      try { state.presets = await bmcl.themePresets(); } catch (e) { state.presets = []; }
    }
    const custom = state.settings.customTheme;
    const presets = state.presets.concat([{ key: 'custom', label: '自定义', dark: false }]);
    box.innerHTML = presets.map((p) => {
      const vars = resolveVars(p.key, custom);
      return '<div class="fx-preset' + (state.settings.themePreset === p.key ? ' on' : '') + '" data-key="' + p.key + '">' +
        '<div class="fx-preset-swatch" style="background:' + vars.bg + '">' +
        '<i style="background:' + vars.side + '"></i><i style="background:' + vars.card + '"></i>' +
        '<i style="background:' + vars.accent + '"></i></div>' +
        '<div class="fx-preset-name">' + esc(p.label) + '</div></div>';
    }).join('');
    $$('.fx-preset', box).forEach((node) => {
      node.addEventListener('click', async () => {
        await saveSettings({ themePreset: node.dataset.key });
        applyAppearance();
        renderLook();
      });
    });

    const map = {
      fxColorBg: 'bg', fxColorCard: 'card', fxColorText: 'text', fxColorMuted: 'muted',
      fxColorAccent: 'accent', fxColorTitleFrom: 'titleFrom', fxColorTitleTo: 'titleTo'
    };
    Object.keys(map).forEach((id) => {
      const input = $('#' + id);
      if (input) input.value = custom[map[id]];
    });

    const wall = state.settings.wallpaper;
    const name = $('#fxWallName');
    if (name) name.textContent = wall && wall.path ? wall.path.split(/[\\/]/).pop() : '未设置';
    const dim = $('#fxWallDim');
    const blur = $('#fxWallBlur');
    if (dim) dim.value = Math.round((wall.dim || 0) * 100);
    if (blur) blur.value = wall.blur || 0;
    $('#fxWallDimVal').textContent = Math.round((wall.dim || 0) * 100) + '%';
    $('#fxWallBlurVal').textContent = (wall.blur || 0) + 'px';
    const css = $('#fxCss');
    if (css) css.value = state.settings.customCss || '';
  }

  async function saveCustomColors() {
    const customTheme = {
      bg: $('#fxColorBg').value,
      card: $('#fxColorCard').value,
      text: $('#fxColorText').value,
      muted: $('#fxColorMuted').value,
      accent: $('#fxColorAccent').value,
      titleFrom: $('#fxColorTitleFrom').value,
      titleTo: $('#fxColorTitleTo').value
    };
    await saveSettings({ themePreset: 'custom', customTheme });
    applyAppearance();
    renderLook();
    toast('已保存自定义主题', 'ok');
  }

  /* ---------------- 皮肤面板 ---------------- */
  async function refreshSkinPane() {
    refreshAvatar();
    const info = await bmcl.skinCurrentFile();
    if (info && info.file) {
      loadSkinIntoViewer(info.file);
    } else {
      $('#fxSkinIdle').textContent = '未登录或没有皮肤，登录正版账号后会显示';
    }
    await refreshSkinHistory();
    await refreshCapes();
  }

  async function refreshSkinHistory() {
    const box = $('#fxSkinHistory');
    if (!box) return;
    try {
      const items = await bmcl.skinHistory();
      if (!items.length) {
        box.innerHTML = '<p class="fx-hint">还没有记录。</p>';
        return;
      }
      box.innerHTML = items.map((item) =>
        '<div class="fx-hist">' +
        '<img src="' + fileUrl(item.file) + '" alt="">' +
        '<div class="fx-hist-name" title="' + esc(item.name) + '">' + esc(item.name) + '</div>' +
        '<div class="fx-hist-actions">' +
        '<button data-apply="' + item.id + '">切换</button>' +
        '<button data-remove="' + item.id + '">删除</button>' +
        '</div></div>'
      ).join('');
      $$('[data-apply]', box).forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await bmcl.applySkinHistory(btn.dataset.apply, $('#fxSkinVariant').value);
            toast('已切换皮肤', 'ok');
            await refreshSkinHistory();
            await refreshAvatar();
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });
      $$('[data-remove]', box).forEach((btn) => {
        btn.addEventListener('click', async () => {
          await bmcl.removeSkinHistory(btn.dataset.remove);
          refreshSkinHistory();
        });
      });
    } catch (err) {
      box.innerHTML = '<p class="fx-hint">' + esc(err.message) + '</p>';
    }
  }

  async function refreshCapes() {
    const box = $('#fxCapeList');
    const hist = $('#fxCapeHistory');
    if (!box) return;
    try {
      const data = await bmcl.skinCapes();
      const capes = data.capes || [];
      if (!capes.length) {
        box.innerHTML = '<p class="fx-hint">这个账号还没有拥有任何披风。Mojang 只为部分活动账号发放披风，无法自定义上传。</p>';
      } else {
        box.innerHTML = capes.map((cape) =>
          '<div class="fx-cape' + (cape.active ? ' on' : '') + '" data-cape="' + esc(cape.id) + '">' +
          (cape.url ? '<img src="' + esc(cape.url) + '" alt="">' : '') +
          '<div class="fx-cape-name">' + esc(cape.alias || cape.id) + (cape.active ? ' · 使用中' : '') + '</div></div>'
        ).join('');
        $$('.fx-cape', box).forEach((node) => {
          node.addEventListener('click', async () => {
            try {
              await bmcl.setCape(node.dataset.cape);
              toast('披风已切换', 'ok');
              refreshCapes();
            } catch (err) {
              toast(err.message, 'error');
            }
          });
        });
      }
      if (hist) {
        const items = data.history || [];
        hist.innerHTML = items.length
          ? items.map((item) => '<div class="fx-hist"><div class="fx-hist-name">' +
            esc(item.alias || item.capeId || '关闭披风') + '</div>' +
            '<div class="fx-hint">' + esc(String(item.at || '').slice(0, 10)) + '</div></div>').join('')
          : '<p class="fx-hint">还没有记录。</p>';
      }
    } catch (err) {
      box.innerHTML = '<p class="fx-hint">' + esc(err.message) + '</p>';
    }
  }

  /* ---------------- Java 面板 ---------------- */
  async function renderJava() {
    const dirsBox = $('#fxJavaDirs');
    const listBox = $('#fxJavaList');
    if (!dirsBox || !listBox) return;
    const s = state.settings;
    dirsBox.innerHTML = (s.javaDirs || []).length
      ? s.javaDirs.map((dir) =>
        '<div class="fx-dir"><span title="' + esc(dir) + '">' + esc(dir) + '</span>' +
        '<button class="fx-btn fx-btn-mini" data-deldir="' + esc(dir) + '">移除</button></div>').join('')
      : '<p class="fx-hint">还没有添加目录。</p>';
    $$('[data-deldir]', dirsBox).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await bmcl.javaRemoveDir(btn.dataset.deldir);
        state.settings.javaDirs = res.javaDirs;
        state.settings.javaList = res.javaList;
        renderJava();
      });
    });

    const list = s.javaList || [];
    listBox.innerHTML = list.length
      ? list.map((item) =>
        '<div class="fx-java' + (s.javaPath === item.path ? ' on' : '') + '">' +
        '<span class="fx-java-badge' + (item.ok ? '' : ' bad') + '">' +
        (item.ok ? 'Java ' + (item.major || '?') : '无效') + '</span>' +
        '<div class="fx-java-main"><div>' + esc(item.vendor || '未知发行版') +
        (item.bits ? ' · ' + item.bits + ' 位' : '') + '</div>' +
        '<div class="fx-java-path" title="' + esc(item.path) + '">' + esc(item.path) + '</div></div>' +
        '<button class="fx-btn fx-btn-mini" data-default="' + esc(item.path) + '"' + (item.ok ? '' : ' disabled') + '>' +
        (s.javaPath === item.path ? '默认' : '设为默认') + '</button></div>').join('')
      : '<p class="fx-hint">还没有扫描过。添加目录后会自动识别所有 Java。</p>';
    $$('[data-default]', listBox).forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.settings = await bmcl.javaSetDefault(btn.dataset.default);
        toast('已设为默认 Java', 'ok');
        renderJava();
      });
    });
  }

  async function addJavaDirs() {
    const picked = await bmcl.javaPickDirs();
    if (!picked || picked.canceled) return;
    const hint = $('#fxJavaHint');
    let total = 0;
    for (const dir of picked.added) {
      if (hint) hint.textContent = '正在扫描 ' + dir + ' …';
      try {
        const res = await bmcl.javaScanDir(dir);
        total += res.found;
        state.settings.javaDirs = Array.from(new Set((state.settings.javaDirs || []).concat([dir])));
        state.settings.javaList = res.list;
      } catch (err) {
        toast('扫描失败：' + err.message, 'error');
      }
    }
    if (hint) hint.textContent = '已添加 ' + picked.added.length + ' 个目录，识别到 ' + total + ' 个 Java';
    renderJava();
  }

  /* ---------------- 初始化 ---------------- */
  function bindEvents() {
    $('#fxAiSend').addEventListener('click', () => {
      const input = $('#fxAiInput');
      sendAi(input.value);
      input.value = '';
    });
    $('#fxAiInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        $('#fxAiSend').click();
      }
    });
    $('#fxAiClear').addEventListener('click', () => {
      state.aiHistory = [];
      $('#fxAiLog').innerHTML = '';
      appendMsg('bot', '已清空对话。');
    });
    $('#fxAiCrash').addEventListener('click', analyzeCrashWithAi);
    $('#fxAiKeySave').addEventListener('click', async () => {
      const value = $('#fxAiKey').value.trim();
      if (!value) return;
      await saveSettings({ aiApiKey: value });
      $('#fxAiKey').value = '';
      toast('API Key 已保存到本机', 'ok');
    });

    $('#fxMusicSearch').addEventListener('click', searchMusic);
    $('#fxMusicQuery').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchMusic();
    });
    $('#fxMpPlay').addEventListener('click', () => {
      const audio = ensureAudio();
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });
    $('#fxMpNext').addEventListener('click', playNext);
    $('#fxMpPrev').addEventListener('click', playPrev);
    $('#fxMpVol').addEventListener('input', (e) => {
      const value = Math.max(0, Math.min(100, Number(e.target.value))) / 100;
      ensureAudio().volume = value;
      saveSettings({ musicVolume: value });
    });

    $('#fxThemeSave').addEventListener('click', saveCustomColors);
    $('#fxThemeReset').addEventListener('click', async () => {
      await saveSettings({ themePreset: 'default' });
      applyAppearance();
      renderLook();
      toast('已恢复默认主题', 'ok');
    });
    $('#fxWallPick').addEventListener('click', async () => {
      const res = await bmcl.pickWallpaper();
      if (!res || res.canceled) return;
      state.settings = await bmcl.getSettings();
      applyAppearance();
      renderLook();
      toast('背景已应用', 'ok');
    });
    $('#fxWallClear').addEventListener('click', async () => {
      state.settings = await bmcl.clearWallpaper();
      applyAppearance();
      renderLook();
    });
    const applyWallValue = async () => {
      const dim = Number($('#fxWallDim').value) / 100;
      const blur = Number($('#fxWallBlur').value);
      $('#fxWallDimVal').textContent = Math.round(dim * 100) + '%';
      $('#fxWallBlurVal').textContent = blur + 'px';
      state.settings = await bmcl.saveSettings({ wallpaper: Object.assign({}, state.settings.wallpaper, { dim, blur }) });
      applyAppearance();
    };
    $('#fxWallDim').addEventListener('change', applyWallValue);
    $('#fxWallBlur').addEventListener('change', applyWallValue);
    $('#fxCssApply').addEventListener('click', async () => {
      state.settings = await bmcl.saveSettings({ customCss: $('#fxCss').value });
      applyCustomCss(state.settings.customCss);
      toast('样式已应用', 'ok');
    });
    $('#fxCssClear').addEventListener('click', async () => {
      $('#fxCss').value = '';
      state.settings = await bmcl.saveSettings({ customCss: '' });
      applyCustomCss('');
    });

    $('#fxSkinUpload').addEventListener('click', async () => {
      try {
        const variant = $('#fxSkinVariant').value;
        const res = await bmcl.uploadSkin(variant);
        if (!res || !res.ok) return;
        toast('皮肤已上传到 Mojang', 'ok');
        if (res.record && res.record.file) await loadSkinIntoViewer(res.record.file);
        await refreshSkinPane();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    $('#fxSkinRefresh').addEventListener('click', refreshSkinPane);

    $('#fxJavaAdd').addEventListener('click', addJavaDirs);
    $('#fxJavaRescan').addEventListener('click', async () => {
      const hint = $('#fxJavaHint');
      if (hint) hint.textContent = '正在重新扫描…';
      try {
        const list = await bmcl.javaRescan();
        state.settings.javaList = list;
        if (hint) hint.textContent = '共识别到 ' + list.length + ' 个 Java';
        renderJava();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    document.querySelectorAll('.nav-btn[data-page="fx"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        refreshAvatar();
        renderLook();
      });
    });

    if (bmcl.onGameCrash) {
      bmcl.onGameCrash((report) => showCrashCard(report));
    }
  }

  async function boot() {
    try {
      state.settings = await bmcl.getSettings();
    } catch (e) {
      state.settings = { themePreset: 'default', customTheme: {}, wallpaper: {}, customCss: '', javaDirs: [], javaList: [] };
    }
    try { state.presets = await bmcl.themePresets(); } catch (e) { state.presets = []; }
    initTabs();
    bindEvents();
    applyAppearance();
    renderJava();
    const model = $('#fxAiModel');
    if (model) model.textContent = state.settings.aiModel || 'deepseek-chat';
    const keyHint = $('#fxAiHint');
    if (keyHint) {
      keyHint.textContent = state.settings.aiApiKey
        ? '已保存 API Key（' + state.settings.aiApiKey.slice(0, 6) + '…）。只存在本机。'
        : 'API Key 只保存在本机 settings.json，不会上传。';
    }
    setTimeout(refreshAvatar, 800);
    setTimeout(refreshAvatar, 4000);
    // 切换页面或登录状态变化后，重新用本地皮肤裁头像，覆盖默认网络头像
    setInterval(refreshAvatar, 15000);
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => setTimeout(refreshAvatar, 400));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.FX = { applyAppearance, refreshAvatar, showCrashCard, state };
})();
