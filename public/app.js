(function () {
  'use strict';
  const rail = document.getElementById('rail');
  const content = document.getElementById('content');
  const modalRoot = document.getElementById('modal-root');
  const bg = document.getElementById('bg');

  let ICONS = {};
  let SETTINGS = { site_name: 'WorkerBBS', site_accent: '#0f6cbd', site_bg: '', site_desc: '' };
  let ME = null;
  let BOARDS = [];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const avatarHTML = (u) =>
    u && u.avatar
      ? '<span class="avatar"><img src="/api/file/' + esc(u.avatar) + '" alt=""></span>'
      : '<span class="avatar">' + esc(u ? u.username : '?').slice(0, 1) + '</span>';

  async function api(path, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
    return data;
  }
  async function apiForm(path, form) {
    const res = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
    return data;
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 2592000) return Math.floor(s / 86400) + ' 天前';
    return new Date(ts).toLocaleDateString();
  }

  /* ===== 图标 ===== */
  async function loadIcons() {
    const names = ['navigation', 'home', 'search', 'add', 'person', 'settings'];
    await Promise.all(names.map(async (n) => {
      try { ICONS[n] = await (await fetch('/icons/' + n + '.svg')).text(); } catch (e) { ICONS[n] = ''; }
    }));
  }

  function buildRail() {
    const items = [
      { n: 'home', label: '首页', view: '#/home' },
      { n: 'search', label: '发现', view: '#/discover' },
      { n: 'add', label: '发帖', view: '#/compose' },
      { n: 'person', label: '我的', view: '#/profile' },
    ];
    let html = '<button class="nav-toggle" data-label="菜单" aria-label="菜单">' + ICONS.navigation + '</button>';
    items.forEach((it) => {
      html += '<button class="nav-item" data-label="' + it.label + '" data-view="' + it.view + '">' + ICONS[it.n] + '</button>';
    });
    html += '<span class="spacer"></span>';
    html += '<button class="nav-item" data-label="设置" data-view="#/settings">' + ICONS.settings + '</button>';
    html += '<span class="selector"><span class="sel-bg"></span><span class="sel-bar"></span></span>';
    rail.innerHTML = html;
    rail.querySelectorAll('.nav-item').forEach((b) => {
      b.addEventListener('click', () => { location.hash = b.dataset.view; });
    });
  }
  function moveSelector() {
    const sel = rail.querySelector('.selector');
    const active = rail.querySelector('.nav-item.active');
    if (sel && active) sel.style.transform = 'translateY(' + active.offsetTop + 'px)';
  }
  function setActive(view) {
    rail.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    moveSelector();
  }

  function applyTheme() {
    document.documentElement.style.setProperty('--accent', SETTINGS.site_accent || '#0f6cbd');
    if (SETTINGS.site_bg) bg.style.backgroundImage = 'url(/api/file/' + SETTINGS.site_bg + ')';
    document.title = SETTINGS.site_name || 'WorkerBBS';
  }

  function loginBtn() { return '<button class="btn primary" id="loginBtn">登录</button>'; }

  /* ===== 帖子卡片 ===== */
  function threadCard(t) {
    const a = t.author || {};
    return '<article class="post-card" data-id="' + t.id + '">'
      + '<span class="post-tag">' + esc(t.board_name || '') + '</span>'
      + '<h3 class="post-title">' + esc(t.title) + '</h3>'
      + '<p class="post-snippet">' + esc(t.body) + '</p>'
      + '<div class="post-meta">'
      + avatarHTML(a)
      + '<span class="name">' + esc(a.username || '匿名') + '</span>'
      + (a.level ? '<span class="lvl">Lv.' + a.level + '</span>' : '')
      + '<span class="dot"></span><span>' + esc(timeAgo(t.created_at)) + '</span>'
      + '<span class="right"><span>回复 ' + (t.reply_count || 0) + '</span><span>浏览 ' + t.views + '</span></span>'
      + '</div></article>';
  }

  // 全局委托：点击帖子卡片 → 详情
  content.addEventListener('click', (e) => {
    const card = e.target.closest('.post-card');
    if (card) { location.hash = '#/thread/' + card.dataset.id; }
  });

  /* ===== 视图 ===== */
  async function viewHome() {
    const data = await api('/api/threads');
    const feed = data.threads.length ? data.threads.map(threadCard).join('') : '<div class="empty">还没有帖子，去发一帖吧</div>';
    content.innerHTML =
      '<div class="appbar"><h1>' + esc(SETTINGS.site_name || 'WorkerBBS') + '</h1><span class="spacer"></span>'
      + (ME ? '<button class="btn primary" id="newPost">+ 发布</button>' : loginBtn()) + '</div>'
      + '<div class="content-inner"><div class="feed">' + feed + '</div></div>';
    const b = document.getElementById('newPost'); if (b) b.onclick = () => (location.hash = '#/compose');
    const lb = document.getElementById('loginBtn'); if (lb) lb.onclick = openAuth;
  }

  async function viewDiscover() {
    content.innerHTML =
      '<div class="appbar"><h1>发现</h1><span class="search"><input id="q" placeholder="搜索帖子…" /></span></div>'
      + '<div class="content-inner"><div class="feed" id="sres"></div></div>';
    const q = document.getElementById('q');
    const render = async (text) => {
      const data = await api('/api/threads?q=' + encodeURIComponent(text));
      document.getElementById('sres').innerHTML = data.threads.length
        ? data.threads.map(threadCard).join('') : '<div class="empty">没有找到相关帖子</div>';
    };
    q.addEventListener('input', () => render(q.value.trim()));
    render('');
    q.focus();
  }

  async function viewCompose() {
    if (!ME) { openAuth(); return; }
    const opts = BOARDS.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
    content.innerHTML =
      '<div class="appbar"><h1>发帖</h1></div><div class="content-inner"><div class="compose">'
      + '<label>板块</label><select id="cBoard">' + opts + '</select>'
      + '<label>标题</label><input id="cTitle" placeholder="一句话说清楚" />'
      + '<label>正文</label><textarea id="cBody" placeholder="说点什么…"></textarea>'
      + '<div class="row"><button class="btn" id="cCancel">取消</button>'
      + '<button class="btn primary" id="cSubmit">发布</button></div>'
      + '<div class="err" id="cErr"></div></div></div>';
    document.getElementById('cCancel').onclick = () => (location.hash = '#/home');
    document.getElementById('cSubmit').onclick = async () => {
      const title = document.getElementById('cTitle').value.trim();
      const body = document.getElementById('cBody').value.trim();
      const boardId = document.getElementById('cBoard').value;
      const err = document.getElementById('cErr');
      if (!title || !body) { err.textContent = '标题和正文都要填'; return; }
      try {
        const d = await api('/api/threads', { method: 'POST', body: JSON.stringify({ board_id: boardId, title, body }) });
        location.hash = '#/thread/' + d.id;
      } catch (e) { err.textContent = e.message; }
    };
  }

  async function viewThread(id) {
    const data = await api('/api/threads/' + id);
    const t = data.thread;
    const a = t.author || {};
    const replies = data.replies.map((r) => {
      const ra = r.author || {};
      return '<div class="reply-card">' + avatarHTML(ra)
        + '<div class="reply-main"><div class="reply-head"><span class="name">' + esc(ra.username || '匿名') + '</span>'
        + (ra.level ? '<span class="lvl">Lv.' + ra.level + '</span>' : '') + '<span class="dot"></span><span>' + esc(timeAgo(r.created_at)) + '</span></div>'
        + '<div class="reply-text">' + esc(r.body) + '</div></div></div>';
    }).join('');
    content.innerHTML =
      '<div class="appbar"><button class="btn" id="backBtn">← 返回</button><h1 style="font-size:15px;">' + esc(t.board_name) + '</h1><span class="spacer"></span></div>'
      + '<div class="content-inner">'
      + '<article class="post-detail"><span class="post-tag">' + esc(t.board_name) + '</span>'
      + '<h2 class="post-title">' + esc(t.title) + '</h2>'
      + '<div class="post-meta" style="margin-bottom:14px;">' + avatarHTML(a)
      + '<a class="name" href="#/user/' + esc(a.username || '') + '">' + esc(a.username || '匿名') + '</a>'
      + (a.level ? '<span class="lvl">Lv.' + a.level + '</span>' : '') + '<span class="dot"></span><span>' + esc(timeAgo(t.created_at)) + '</span>'
      + '<span class="right"><span>回复 ' + (data.replies.length) + '</span><span>浏览 ' + t.views + '</span></span></div>'
      + '<div class="post-body">' + esc(t.body) + '</div></article>'
      + '<h3 style="font-size:14px;margin:22px 0 6px;color:#5b5b5b;">' + data.replies.length + ' 条回复</h3>'
      + '<div class="replies" id="reps">' + (replies || '<div class="empty">还没有回复，来抢沙发</div>') + '</div>'
      + (ME ? '<div class="reply-box"><input id="replyInput" placeholder="写下你的回复…" /><button class="btn primary" id="sendReply">发送</button></div>'
            : '<div class="muted" style="margin-top:14px;">登录后才能回复 · <a href="#" id="loginLink">去登录</a></div>')
      + '</div>';
    document.getElementById('backBtn').onclick = () => history.length > 1 ? history.back() : (location.hash = '#/home');
    const ll = document.getElementById('loginLink'); if (ll) ll.onclick = (e) => { e.preventDefault(); openAuth(); };
    const si = document.getElementById('sendReply');
    if (si) si.onclick = async () => {
      const inp = document.getElementById('replyInput');
      const txt = inp.value.trim();
      if (!txt) return;
      try {
        await api('/api/threads/' + id + '/replies', { method: 'POST', body: JSON.stringify({ body: txt }) });
        viewThread(id);
      } catch (e) { alert(e.message); }
    };
  }

  async function viewUser(username) {
    const data = await api('/api/users/' + encodeURIComponent(username));
    const u = data.user;
    const feed = (data.threads || []).map(threadCard).join('') || '<div class="empty">该用户还没发帖</div>';
    content.innerHTML =
      '<div class="appbar"><h1>用户</h1></div><div class="content-inner">'
      + '<div class="profile-head">' + avatarHTML(u)
      + '<div><div class="pn">' + esc(u.username) + ' <span class="lvl">Lv.' + u.level + '</span></div>'
      + '<div class="pm">' + esc(u.bio || '这个人很神秘') + '</div></div></div>'
      + '<div class="feed">' + feed + '</div></div>';
  }

  async function viewProfile() {
    if (!ME) { openAuth(); return; }
    const u = ME;
    content.innerHTML =
      '<div class="appbar"><h1>我的</h1></div><div class="content-inner">'
      + '<div class="profile-head">' + avatarHTML(u)
      + '<div><div class="pn">' + esc(u.username) + ' <span class="lvl">Lv.' + u.level + '</span></div>'
      + '<div class="pm">经验 ' + u.exp + ' · ' + esc(u.role === 'admin' ? '管理员' : '会员') + '</div></div></div>'
      + '<div class="profile-actions">'
      + '<button class="btn" id="upAvatar">上传头像</button>'
      + '<button class="btn" id="upBg">上传背景图</button>'
      + '<button class="btn" id="logout">退出登录</button></div>'
      + '<label>个人简介</label><textarea id="bio" class="compose" style="width:100%;min-height:80px;padding:9px 11px;border:1px solid var(--rail-border);border-radius:6px;font:inherit;">' + esc(u.bio) + '</textarea>'
      + '<div class="row" style="display:flex;gap:10px;margin-top:12px;"><button class="btn primary" id="saveProfile">保存资料</button><span class="muted" id="pMsg"></span></div>'
      + '<h3 style="margin-top:22px;font-size:14px;color:#5b5b5b;">我发的帖子</h3>'
      + '<div class="feed" id="myThreads"></div></div>';
    const my = await api('/api/users/' + encodeURIComponent(u.username));
    document.getElementById('myThreads').innerHTML = (my.threads || []).map(threadCard).join('') || '<div class="empty">还没有发帖</div>';

    document.getElementById('upAvatar').onclick = () => pickFile('avatars', async (key) => {
      await api('/api/me', { method: 'PATCH', body: JSON.stringify({ avatar: key }) }); await refreshMe(); viewProfile();
    });
    document.getElementById('upBg').onclick = () => pickFile('bgs', async (key) => {
      await api('/api/me', { method: 'PATCH', body: JSON.stringify({ bg_image: key }) }); await refreshMe(); viewProfile();
    });
    document.getElementById('saveProfile').onclick = async () => {
      const bio = document.getElementById('bio').value;
      await api('/api/me', { method: 'PATCH', body: JSON.stringify({ bio }) });
      await refreshMe();
      document.getElementById('pMsg').textContent = '已保存';
    };
    document.getElementById('logout').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST' }); ME = null; location.hash = '#/home'; router();
    };
  }

  async function viewSettings() {
    if (!ME) { openAuth(); return; }
    if (ME.role !== 'admin') {
      content.innerHTML =
        '<div class="appbar"><h1>设置</h1></div><div class="content-inner">'
        + '<div class="settings-row"><div><div style="font-weight:600;">账号</div><div class="muted">' + esc(ME.username) + '</div></div>'
        + '<button class="btn" id="toProfile">我的资料</button></div>'
        + '<div class="settings-row"><div>主题色由站点管理员统一设置</div><span class="tag">普通用户</span></div>'
        + '</div>';
      document.getElementById('toProfile').onclick = () => (location.hash = '#/profile');
      return;
    }
    // 管理员后台
    const stats = await api('/api/admin/stats');
    content.innerHTML =
      '<div class="appbar"><h1>后台管理</h1></div><div class="content-inner">'
      + '<div class="stats">'
      + '<div class="stat"><b>' + stats.users + '</b><span>用户</span></div>'
      + '<div class="stat"><b>' + stats.threads + '</b><span>帖子</span></div>'
      + '<div class="stat"><b>' + stats.replies + '</b><span>回复</span></div>'
      + '<div class="stat"><b>' + stats.banned + '</b><span>已封禁</span></div></div>'
      + '<h3 style="margin-top:24px;font-size:14px;color:#5b5b5b;">站点设置</h3>'
      + '<div class="settings-row"><div><label>站点名称</label><input id="sName" value="' + esc(SETTINGS.site_name) + '"></div></div>'
      + '<div class="settings-row"><div><label>站点简介</label><input id="sDesc" value="' + esc(SETTINGS.site_desc) + '"></div></div>'
      + '<div class="settings-row"><div><label>强调色 (hex)</label><input id="sAccent" value="' + esc(SETTINGS.site_accent) + '"></div>'
      + '<div class="swatches" id="sw">' + ['#0f6cbd', '#6161e6', '#0e700e', '#b8135b', '#c23500', '#5a2da4'].map((c) => '<span class="swatch" data-c="' + c + '" style="background:' + c + '"></span>').join('') + '</div></div>'
      + '<div class="settings-row"><div><label>背景图 (上传)</label><button class="btn" id="sBg">上传背景图</button></div>'
      + '<button class="btn primary" id="saveSite">保存站点设置</button></div>'
      + '<h3 style="margin-top:24px;font-size:14px;color:#5b5b5b;">用户管理</h3><div id="userAdmin"></div>'
      + '<h3 style="margin-top:24px;font-size:14px;color:#5b5b5b;">帖子管理</h3><div id="threadAdmin"></div>'
      + '</div>';
    document.querySelectorAll('#sw .swatch').forEach((s) => s.onclick = () => (document.getElementById('sAccent').value = s.dataset.c));
    document.getElementById('sBg').onclick = () => pickFile('bgs', async (key) => { document.getElementById('sBg').dataset.key = key; document.getElementById('sBg').textContent = '已选背景，保存生效'; });
    document.getElementById('saveSite').onclick = async () => {
      const payload = { site_name: document.getElementById('sName').value, site_desc: document.getElementById('sDesc').value, site_accent: document.getElementById('sAccent').value };
      const bgKey = document.getElementById('sBg').dataset.key;
      if (bgKey) payload.site_bg = bgKey;
      await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
      SETTINGS = await api('/api/settings'); applyTheme();
      alert('站点设置已保存');
    };
    renderUserAdmin();
    renderThreadAdmin();
  }

  async function renderUserAdmin() {
    const data = await api('/api/admin/users');
    document.getElementById('userAdmin').innerHTML =
      '<table class="admin"><thead><tr><th>用户</th><th>等级</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>'
      + data.users.map((u) =>
        '<tr><td>' + esc(u.username) + '</td><td>Lv.' + u.level + '</td>'
        + '<td><span class="tag ' + (u.role === 'admin' ? 'admin' : '') + '">' + esc(u.role) + '</span></td>'
        + '<td>' + (u.banned ? '<span class="tag banned">已封禁</span>' : '<span class="tag">正常</span>') + '</td>'
        + '<td><button class="btn" data-ban="' + u.id + '">' + (u.banned ? '解封' : '封禁') + '</button> '
        + '<button class="btn" data-role="' + u.id + '">' + (u.role === 'admin' ? '降为会员' : '设为管理员') + '</button></td></tr>'
      ).join('') + '</tbody></table>';
    document.querySelectorAll('[data-ban]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.ban; const u = data.users.find((x) => x.id == id);
      await api('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ banned: u.banned ? 0 : 1 }) }); renderUserAdmin();
    });
    document.querySelectorAll('[data-role]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.role; const u = data.users.find((x) => x.id == id);
      await api('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ role: u.role === 'admin' ? 'user' : 'admin' }) }); renderUserAdmin();
    });
  }

  async function renderThreadAdmin() {
    const data = await api('/api/admin/threads');
    document.getElementById('threadAdmin').innerHTML =
      '<table class="admin"><thead><tr><th>标题</th><th>板块</th><th>置顶</th><th>操作</th></tr></thead><tbody>'
      + data.threads.map((t) =>
        '<tr><td>' + esc(t.title.slice(0, 40)) + '</td><td>' + t.board_id + '</td>'
        + '<td>' + (t.pinned ? '是' : '否') + '</td>'
        + '<td><button class="btn" data-pin="' + t.id + '">' + (t.pinned ? '取消置顶' : '置顶') + '</button> '
        + '<button class="btn danger" data-del="' + t.id + '">删除</button></td></tr>'
      ).join('') + '</tbody></table>';
    document.querySelectorAll('[data-pin]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.pin; const t = data.threads.find((x) => x.id == id);
      await api('/api/admin/threads/' + id, { method: 'PATCH', body: JSON.stringify({ pinned: t.pinned ? 0 : 1 }) }); renderThreadAdmin();
    });
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('确认删除该帖子？')) return;
      await api('/api/admin/threads/' + b.dataset.del, { method: 'PATCH', body: JSON.stringify({ deleted: 1 }) }); renderThreadAdmin();
    });
  }

  /* ===== 文件上传 ===== */
  function pickFile(folder, cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('file', f); fd.append('folder', folder);
      try { const d = await apiForm('/api/upload', fd); await cb(d.key); } catch (e) { alert(e.message); }
    };
    inp.click();
  }

  async function refreshMe() { try { const d = await api('/api/me'); ME = d.user; } catch (e) { ME = null; } }

  /* ===== 登录 / 注册弹窗 ===== */
  function openAuth() {
    modalRoot.innerHTML =
      '<div class="modal-mask" id="mask"><div class="modal">'
      + '<h2>欢迎来到 ' + esc(SETTINGS.site_name || 'WorkerBBS') + '</h2>'
      + '<div class="tabs"><button id="tabLogin" class="active">登录</button><button id="tabReg">注册</button></div>'
      + '<div id="authForm"></div><div class="err" id="authErr"></div></div></div>';
    let mode = 'login';
    const renderForm = () => {
      const isReg = mode === 'register';
      document.getElementById('authForm').innerHTML =
        (isReg ? '<label>用户名</label><input id="fUser" placeholder="至少 2 个字符">' : '')
        + '<label>邮箱或用户名</label><input id="fId" placeholder="登录用">' 
        + (isReg ? '<label>邮箱</label><input id="fEmail" placeholder="you@example.com">' : '')
        + '<label>密码</label><input id="fPwd" type="password" placeholder="至少 6 位">'
        + '<div class="row"><button class="btn primary" id="fSubmit" style="flex:1;">' + (isReg ? '注册' : '登录') + '</button></div>';
      document.getElementById('fSubmit').onclick = submit;
    };
    const submit = async () => {
      const err = document.getElementById('authErr'); err.textContent = '';
      try {
        if (mode === 'register') {
          await api('/api/auth/register', { method: 'POST', body: JSON.stringify({
            username: document.getElementById('fUser').value.trim(),
            email: document.getElementById('fEmail').value.trim(),
            password: document.getElementById('fPwd').value }) });
        } else {
          await api('/api/auth/login', { method: 'POST', body: JSON.stringify({
            identifier: document.getElementById('fId').value.trim(),
            password: document.getElementById('fPwd').value }) });
        }
        await refreshMe();
        closeAuth(); router();
      } catch (e) { err.textContent = e.message; }
    };
    renderForm();
    document.getElementById('tabLogin').onclick = () => { mode = 'login'; document.getElementById('tabLogin').classList.add('active'); document.getElementById('tabReg').classList.remove('active'); renderForm(); };
    document.getElementById('tabReg').onclick = () => { mode = 'register'; document.getElementById('tabReg').classList.add('active'); document.getElementById('tabLogin').classList.remove('active'); renderForm(); };
    document.getElementById('mask').onclick = (e) => { if (e.target.id === 'mask') closeAuth(); };
  }
  function closeAuth() { modalRoot.innerHTML = ''; }

  /* ===== 路由 ===== */
  const routes = { '#/home': viewHome, '#/discover': viewDiscover, '#/compose': viewCompose, '#/profile': viewProfile, '#/settings': viewSettings };
  async function router() {
    let hash = location.hash || '#/home';
    setActive(hash.split('/').slice(0, 2).join('/'));
    if (hash.startsWith('#/thread/')) return viewThread(hash.split('/')[2]);
    if (hash.startsWith('#/user/')) return viewUser(hash.split('/')[2]);
    const fn = routes[hash] || viewHome;
    try { await fn(); } catch (e) { content.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; }
  }
  window.addEventListener('hashchange', router);

  /* ===== 启动 ===== */
  (async function init() {
    await loadIcons();
    buildRail();
    try { SETTINGS = await api('/api/settings'); } catch (e) {}
    applyTheme();
    try { BOARDS = (await api('/api/boards')).boards; } catch (e) {}
    try { const d = await api('/api/me'); ME = d.user; } catch (e) { ME = null; }
    router();
  })();
})();
