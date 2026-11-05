(function () {
  var API = 'https://api.github.com';
  var REPO = 'fft1145/BMCL';
  var PATH = 'notices.json';
  var BRANCH = 'gh-pages';
  var verified = false;
  var currentSha = null;

  var $ = function (id) { return document.getElementById(id); };
  function setStatus(text, kind) {
    var el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function b64encode(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(text) {
    var bin = atob(text.replace(/\s+/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function token() { return $('token').value.trim(); }

  async function api(path, options) {
    var opt = options || {};
    opt.headers = Object.assign({
      Authorization: 'Bearer ' + token(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, opt.headers || {});
    var res = await fetch(API + path, opt);
    var data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      var msg = data && data.message ? data.message : ('HTTP ' + res.status);
      throw new Error(msg + (res.status === 401 ? '（令牌无效或已过期）' : res.status === 403 ? '（无权限或触发频率限制）' : ''));
    }
    return data;
  }

  function render(list) {
    var box = $('list');
    box.textContent = '';
    if (!list || !list.length) { box.textContent = '当前没有公告'; return; }
    list.forEach(function (n) {
      var row = document.createElement('div');
      var t = document.createElement('b');
      t.textContent = n.title || '(无标题)';
      row.appendChild(t);
      var m = document.createElement('span');
      m.className = 'm';
      m.textContent = '  ' + (n.date || '') + (n.level === 'warning' ? ' · 重要' : '');
      row.appendChild(m);
      var b = document.createElement('div');
      b.className = 'm';
      b.textContent = String(n.body || '').replace(/\n/g, ' / ');
      row.appendChild(b);
      box.appendChild(row);
    });
  }

  async function loadNotices() {
    var data = await api('/repos/' + REPO + '/contents/' + PATH + '?ref=' + BRANCH + '&t=' + Date.now());
    currentSha = data.sha;
    var parsed = JSON.parse(b64decode(data.content) || '{"notices":[]}');
    var notices = Array.isArray(parsed) ? parsed : (parsed.notices || []);
    render(notices);
    return notices;
  }

  $('btnVerify').addEventListener('click', async function () {
    if ($('gender').value.trim() !== '男生') {
      setStatus('验证答案不正确。', 'err');
      return;
    }
    if (!token()) { setStatus('请填写 GitHub 令牌。', 'err'); return; }
    setStatus('正在验证 GitHub 身份…');
    try {
      var user = await api('/user');
      if (!user || user.login !== 'fft1145') {
        setStatus('该令牌不属于仓库管理员 fft1145。', 'err');
        return;
      }
      var repo = await api('/repos/' + REPO);
      if (!repo.permissions || !repo.permissions.push) {
        setStatus('该令牌没有向仓库写入内容的权限。', 'err');
        return;
      }
      sessionStorage.setItem('bmcl_admin_token', token());
      verified = true;
      $('btnPublish').disabled = false;
      setStatus('身份验证通过：' + user.login + '，可发布公告。', 'ok');
      await loadNotices();
    } catch (err) {
      setStatus('验证失败：' + err.message, 'err');
    }
  });

  $('btnPublish').addEventListener('click', async function () {
    if (!verified) { setStatus('请先完成管理员验证。', 'err'); return; }
    var title = $('title').value.trim();
    if (!title) { setStatus('请填写公告标题。', 'err'); return; }
    var item = {
      id: String(Date.now()),
      title: title,
      body: $('body').value,
      date: $('date').value.trim(),
      level: $('level').value,
      url: $('url').value.trim()
    };
    setStatus('正在发布…');
    try {
      var notices = await loadNotices();
      notices.unshift(item);
      notices = notices.slice(0, 20);
      var payload = JSON.stringify({ notices: notices }, null, 2);
      await api('/repos/' + REPO + '/contents/' + PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'admin: 下发公告「' + title + '」',
          content: b64encode(payload),
          sha: currentSha,
          branch: BRANCH
        })
      });
      setStatus('发布成功，启动器下次启动即可收到。', 'ok');
      $('title').value = '';
      $('body').value = '';
      $('url').value = '';
      await loadNotices();
    } catch (err) {
      setStatus('发布失败：' + err.message, 'err');
    }
  });

  // 恢复本标签页内的令牌，便于连续发布
  var saved = sessionStorage.getItem('bmcl_admin_token');
  if (saved) $('token').value = saved;
  var d = new Date();
  $('date').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
})();
