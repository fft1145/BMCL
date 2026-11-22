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
    musicView: 'search',
    searchResults: [],
    aiHistory: [],
    viewer: null,
    audio: null,
    skinFile: null,
    crashReport: null,
    javaRuntimes: null,
    javaDir: ''
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
  // 供其它页面调用：打开增强页的指定页签
  window.bmclOpenFxTab = function (name) {
    const tab = $('.fx-tab[data-fxtab="' + name + '"]');
    if (tab) tab.click();
  };

  function initTabs() {
    $$('.fx-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.fx-tab').forEach((t) => t.classList.toggle('on', t === tab));
        $$('.fx-pane').forEach((p) => p.classList.toggle('on', p.dataset.fxpane === tab.dataset.fxtab));
        if (tab.dataset.fxtab === 'skin') refreshSkinPane();
        if (tab.dataset.fxtab === 'java') { renderJava(); loadJavaRuntimes(); refreshJavaAutofill(); }
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

  function refreshAiStatus() {
    const model = $('#fxAiModel');
    if (model) {
      model.textContent = state.settings.aiApiKey
        ? (state.settings.aiModel || 'deepseek-chat')
        : '公共 Key · 自动获取';
    }
    const keyHint = $('#fxAiHint');
    if (keyHint) {
      keyHint.textContent = state.settings.aiApiKey
        ? '正在使用你自己的 API Key（' + state.settings.aiApiKey.slice(0, 6) + '…），只存在本机。清空输入框再点「保存 Key」可切回公共 Key。'
        : '无需填写 Key：提问时会自动从官网拉取公共 Key（可随时更换，不用更新启动器）。也可以填入自己的 Key 覆盖它（选填，只保存在本机）。';
    }
  }

  async function sendAi(text) {
    const content = String(text || '').trim();
    if (!content) return;
    const keyInput = $('#fxAiKey');
    if (keyInput && keyInput.value.trim() && !state.settings.aiApiKey) {
      await saveSettings({ aiApiKey: keyInput.value.trim() });
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

  const FAV_KEY = 'bmcl_music_favs';

  function loadFavs() {
    try {
      const arr = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter((t) => t && t.bvid) : [];
    } catch (e) {
      return [];
    }
  }

  function saveFavs(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { /* 忽略配额错误 */ }
    renderFavCount();
  }

  function renderFavCount() {
    const el = $('#fxFavCount');
    if (el) el.textContent = String(loadFavs().length);
  }

  function toggleFav(track) {
    if (!track || !track.bvid) return;
    const list = loadFavs();
    const index = list.findIndex((t) => t.bvid === track.bvid);
    if (index >= 0) {
      list.splice(index, 1);
      toast('已取消收藏', 'ok');
    } else {
      list.push({
        bvid: track.bvid,
        title: track.title,
        author: track.author,
        cover: track.cover || '',
        duration: Number(track.duration) || 0
      });
      toast('已收藏到「我的收藏」', 'ok');
    }
    saveFavs(list);
    renderMusicView();
  }

  function renderMusicView() {
    const listBox = $('#fxMusicList');
    if (!listBox) return;
    const favs = loadFavs();
    const favSet = new Set(favs.map((t) => t.bvid));
    const items = state.musicView === 'favs' ? favs : (state.searchResults || []);
    state.tracks = items;
    if (!items.length) {
      listBox.innerHTML = state.musicView === 'favs'
        ? '<p class="fx-hint" style="padding:12px">还没有收藏。在搜索结果里点 ★ 即可收藏。<br>注意：收藏只保存在本机，更新启动器版本后不会保留，请自行记录歌名。</p>'
        : '<p class="fx-hint" style="padding:12px">搜索后点击任意结果即可播放。音源直接取 B 站音频流，仅供个人收听。</p>';
      return;
    }
    listBox.innerHTML = items.map((item, i) =>
      '<div class="fx-track" data-index="' + i + '">' +
      '<div class="fx-track-idx">' + (i + 1) + '</div>' +
      '<div class="fx-track-main"><div class="fx-track-title">' + esc(item.title) + '</div>' +
      '<div class="fx-track-sub">' + esc(item.author) + '</div></div>' +
      '<div class="fx-track-dur">' + fmt(item.duration) + '</div>' +
      '<button class="fx-track-fav' + (favSet.has(item.bvid) ? ' on' : '') + '" data-fav="' + esc(item.bvid) + '" title="收藏 / 取消收藏">★</button>' +
      '</div>'
    ).join('');
    if (state.musicView === 'favs') {
      listBox.insertAdjacentHTML('beforeend',
        '<p class="fx-hint" style="padding:8px 12px">收藏只保存在本机，更新启动器版本后不会保留，请自行记录歌名。</p>');
    }
    $$('.fx-track', listBox).forEach((node) => {
      node.addEventListener('click', () => playTrack(Number(node.dataset.index)));
    });
    $$('[data-fav]', listBox).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const track = items[Number(btn.closest('.fx-track').dataset.index)];
        if (track) toggleFav(track);
      });
    });
    const playing = state.tracks[state.trackIndex];
    if (playing) {
      $$('.fx-track', listBox).forEach((node) => {
        const track = items[Number(node.dataset.index)];
        node.classList.toggle('on', Boolean(track && track.bvid === playing.bvid));
      });
    }
  }

  async function searchMusic() {
    const input = $('#fxMusicQuery');
    const keyword = input ? input.value.trim() : '';
    if (!keyword) return;
    const list = $('#fxMusicList');
    list.innerHTML = '<p class="fx-hint" style="padding:12px">正在搜索 B 站…</p>';
    try {
      const results = await bmcl.musicSearch(keyword, 1);
      state.searchResults = results || [];
      if (!state.searchResults.length) {
        list.innerHTML = '<p class="fx-hint" style="padding:12px">没有找到结果，换个关键词试试。</p>';
        return;
      }
      state.musicView = 'search';
      $$('.fx-mtab').forEach((tab) => tab.classList.toggle('on', tab.dataset.mview === 'search'));
      renderMusicView();
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
        if (capes.some((cape) => cape.active)) {
          const clear = document.createElement('div');
          clear.className = 'fx-cape';
          clear.innerHTML = '<div class="fx-cape-name">不使用披风</div>';
          clear.addEventListener('click', async () => {
            try {
              await bmcl.clearCape();
              toast('已关闭披风', 'ok');
              refreshCapes();
            } catch (err) {
              toast(err.message, 'error');
            }
          });
          box.appendChild(clear);
        }
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

  /* ---------------- 自动补全 Java ---------------- */
  const JAVA_AUTO_DIR_KEY = 'bmcl_java_auto_dir';

  function renderJavaAutoDir() {
    const label = $('#fxJavaAutoDir');
    if (!label) return;
    label.textContent = state.javaAutoDir
      ? '安装目录：' + state.javaAutoDir
      : '安装目录：未选择（点「自动补全」时会先让你选）';
    label.title = state.javaAutoDir || '';
  }

  function renderJavaAutoPlan(plan) {
    const box = $('#fxJavaAutoList');
    if (!box) return;
    if (!plan || !plan.totalVersions) {
      box.innerHTML = '<p class="fx-hint">还没有安装游戏版本，先在「下载」页安装一个。</p>';
      return;
    }
    if (!plan.needed.length) {
      box.innerHTML = '<p class="fx-hint">已安装版本需要的 Java 都已具备，无需补全。</p>';
      return;
    }
    box.innerHTML = plan.needed.map((n) => {
      const runtime = n.runtime
        ? n.runtime.label + (n.runtime.version ? ' · ' + n.runtime.version : '')
        : '没有对应的官方运行时，需要手动安装';
      return '<div class="fx-java">' +
        '<span class="fx-java-badge' + (n.runtime ? '' : ' bad') + '">Java ' + n.major + '</span>' +
        '<div class="fx-java-main"><div>需要它的版本：' + esc(n.versions.join('、')) + '</div>' +
        '<div class="fx-java-path">将安装：' + esc(runtime) + '</div></div></div>';
    }).join('');
  }

  async function refreshJavaAutofill() {
    const box = $('#fxJavaAutoList');
    if (!box) return;
    box.innerHTML = '<p class="fx-hint">正在检测…</p>';
    try {
      const plan = await bmcl.javaAutofillPlan();
      state.javaAutoPlan = plan;
      renderJavaAutoPlan(plan);
    } catch (err) {
      box.innerHTML = '<p class="fx-hint">检测失败：' + esc(err.message) + '</p>';
    }
  }

  async function pickJavaAutoDir() {
    const dir = await bmcl.pickDirectory('选择自动补全 Java 的安装目录（只解压到这里，不影响系统 Java）');
    if (!dir) return '';
    state.javaAutoDir = dir;
    try { localStorage.setItem(JAVA_AUTO_DIR_KEY, dir); } catch (e) { /* 忽略 */ }
    renderJavaAutoDir();
    return dir;
  }

  async function runJavaAutofill() {
    if (!state.javaAutoDir) {
      const dir = await pickJavaAutoDir();
      if (!dir) return;
    }
    if (!state.javaAutoPlan) await refreshJavaAutofill();
    if (!state.javaAutoPlan || !state.javaAutoPlan.needed.length) {
      toast('没有需要补全的 Java', 'ok');
      return;
    }
    const btn = $('#fxJavaAutoFill');
    const box = $('#fxJavaAutoProgress');
    const bar = $('#fxJavaAutoBar');
    const text = $('#fxJavaAutoText');
    if (btn) btn.disabled = true;
    if (box) box.classList.remove('hidden');
    if (bar) bar.style.width = '2%';
    if (text) text.textContent = '正在准备下载…';
    try {
      const res = await bmcl.javaAutofill({ dir: state.javaAutoDir });
      state.settings.javaList = res.list;
      state.settings.javaPath = res.javaPath;
      state.javaAutoPlan = res.plan || null;
      renderJavaAutoPlan(res.plan);
      renderJava();
      const failed = (res.results || []).filter((r) => !r.ok);
      if (failed.length) {
        toast('已补全 ' + (res.results.length - failed.length) + ' 个，' + failed.length + ' 个失败：' + failed[0].message, 'error');
      } else {
        toast('Java 已补全', 'ok');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (box) box.classList.add('hidden');
    }
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

  /* ---------------- Java 运行时下载 ---------------- */
  function renderJavaDirLabel() {
    const label = $('#fxJavaDlDir');
    if (!label) return;
    label.textContent = state.javaDir ? '下载目录：' + state.javaDir : '下载目录：未选择';
    label.title = state.javaDir || '';
  }

  const JAVA_DIR_KEY = 'bmcl_java_dl_dir';

  function loadJavaDir() {
    if (state.javaDir) return;
    try { state.javaDir = localStorage.getItem(JAVA_DIR_KEY) || ''; } catch (e) { /* 忽略 */ }
  }

  async function loadJavaRuntimes() {
    const select = $('#fxJavaRuntime');
    if (!select) return;
    if (state.javaRuntimes) return;
    try {
      const list = await bmcl.javaRuntimes();
      state.javaRuntimes = list || [];
      select.innerHTML = state.javaRuntimes.length
        ? state.javaRuntimes.map((item) =>
          '<option value="' + esc(item.name) + '">' + esc(item.label) +
          (item.version ? ' · ' + esc(item.version) : '') + '</option>').join('')
        : '<option value="">当前平台没有可下载的 Java</option>';
    } catch (err) {
      select.innerHTML = '<option value="">读取失败：' + esc(err.message) + '</option>';
    }
  }

  async function pickJavaDownloadDir() {
    try {
      const dir = await bmcl.pickDirectory('选择 Java 下载目录（目录里已有的 Java 会被直接复用）');
      if (!dir) return;
      state.javaDir = dir;
      try { localStorage.setItem(JAVA_DIR_KEY, dir); } catch (e) { /* 忽略 */ }
      renderJavaDirLabel();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function downloadJava() {
    const select = $('#fxJavaRuntime');
    const btn = $('#fxJavaDownload');
    const progress = $('#fxJavaProgress');
    const text = $('#fxJavaProgressText');
    const name = select ? select.value : '';
    if (!name) {
      toast('请先选择要下载的 Java 版本', 'error');
      return;
    }
    if (!state.javaDir) {
      try { state.javaDir = await bmcl.javaDefaultDir(); } catch (e) { /* 保持为空 */ }
      renderJavaDirLabel();
    }
    if (!state.javaDir) {
      toast('请先选择下载目录', 'error');
      return;
    }
    const item = (state.javaRuntimes || []).find((r) => r.name === name) || {};
    const majorMatch = String(item.label || '').match(/Java\s*(\d+)/i);
    const major = majorMatch ? Number(majorMatch[1]) : 0;
    if (btn) btn.disabled = true;
    if (progress) progress.classList.remove('hidden');
    if (text) text.textContent = '正在准备下载…';
    try {
      const res = await bmcl.javaDownload({ name, dir: state.javaDir, major });
      state.settings.javaDirs = Array.from(new Set((state.settings.javaDirs || []).concat([state.javaDir])));
      state.settings.javaList = res.list || [];
      state.settings.javaPath = res.javaPath || state.settings.javaPath;
      renderJava();
      if (res.reused) {
        toast('目录中已有 Java ' + (res.java.major || '') + '，已直接使用', 'ok');
      } else {
        toast('Java 下载完成并已设为默认', 'ok');
      }
      if (progress) progress.classList.add('hidden');
    } catch (err) {
      toast('Java 下载失败：' + err.message, 'error');
      if (text) text.textContent = '下载失败：' + err.message;
    } finally {
      if (btn) btn.disabled = false;
    }
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
      await saveSettings({ aiApiKey: value });
      $('#fxAiKey').value = '';
      toast(value ? '已切换到你的 API Key' : '已清除自定义 Key，改用内置 Key', 'ok');
      refreshAiStatus();
    });

    $('#fxMusicSearch').addEventListener('click', searchMusic);
    $$('.fx-mtab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.musicView = tab.dataset.mview === 'favs' ? 'favs' : 'search';
        $$('.fx-mtab').forEach((t) => t.classList.toggle('on', t === tab));
        renderMusicView();
      });
    });
    renderFavCount();
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
    $('#fxJavaPickDir').addEventListener('click', pickJavaDownloadDir);
    $('#fxJavaDownload').addEventListener('click', downloadJava);
    if (bmcl.onJavaProgress) {
      bmcl.onJavaProgress((prog) => {
        const bar = $('#fxJavaProgressBar');
        const text = $('#fxJavaProgressText');
        const box = $('#fxJavaProgress');
        if (box) box.classList.remove('hidden');
        if (bar) bar.style.width = Math.max(2, Number(prog.percent) || 0) + '%';
        if (text) {
          text.textContent = prog.stage === 'prepare'
            ? '正在准备下载…'
            : '正在下载 ' + (prog.done || 0) + ' / ' + (prog.total || 0) + ' 个文件（' + (prog.percent || 0) + '%）';
        }
      });
    }
    loadJavaDir();
    renderJavaDirLabel();

    try { state.javaAutoDir = localStorage.getItem(JAVA_AUTO_DIR_KEY) || ''; } catch (e) { state.javaAutoDir = ''; }
    renderJavaAutoDir();
    const autoCheck = $('#fxJavaAutoCheck');
    const autoPick = $('#fxJavaAutoDirPick');
    const autoFill = $('#fxJavaAutoFill');
    if (autoCheck) autoCheck.addEventListener('click', refreshJavaAutofill);
    if (autoPick) autoPick.addEventListener('click', () => { pickJavaAutoDir(); });
    if (autoFill) autoFill.addEventListener('click', runJavaAutofill);
    if (bmcl.onJavaAutofillProgress) {
      bmcl.onJavaAutofillProgress((prog) => {
        const box = $('#fxJavaAutoProgress');
        const bar = $('#fxJavaAutoBar');
        const text = $('#fxJavaAutoText');
        if (box) box.classList.remove('hidden');
        if (bar) bar.style.width = Math.max(2, Number(prog.percent) || 0) + '%';
        if (text) {
          text.textContent = prog.stage === 'prepare'
            ? '正在准备 Java ' + prog.major + '（' + prog.index + '/' + prog.total + '）…'
            : '正在下载 Java ' + prog.major + '（' + prog.index + '/' + prog.total + '）· ' +
              (prog.done || 0) + '/' + (prog.total || 0) + ' 个文件（' + (prog.percent || 0) + '%）';
        }
      });
    }
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
    refreshAiStatus();
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
