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

  const DEFAULT_BIO = '此人很懒，没有留下个人简介';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // clickable=false 时不挂 data-user（例如自己的主页，头像用于双击换图，不再跳转）
  function avatarHTML(u, clickable) {
    const cls = 'avatar' + (clickable === false ? '' : ' clickable');
    const attr = clickable === false ? '' : ' data-user="' + esc(u ? u.username : '') + '"';
    return u && u.avatar
      ? '<span class="' + cls + '"' + attr + '><img src="' + esc(u.avatar) + '" alt=""></span>'
      : '<span class="' + cls + '"' + attr + '>' + esc(u ? u.username : '?').slice(0, 1) + '</span>';
  }

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
    if (SETTINGS.site_bg) bg.style.backgroundImage = 'url(' + SETTINGS.site_bg + ')';
    else bg.style.backgroundImage = '';
    document.title = SETTINGS.site_name || 'WorkerBBS';
    // 深色模式：持久化在 localStorage（个人偏好，与站点主题色无关）
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.dataset.theme = theme;
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
      + '<span class="name" data-user="' + esc(a.username || '') + '">' + esc(a.username || '匿名') + '</span>'
      + (a.level ? '<span class="lvl">Lv.' + a.level + '</span>' : '')
      + '<span class="dot"></span><span>' + esc(timeAgo(t.created_at)) + '</span>'
      + '<span class="right"><span>回复 ' + (t.reply_count || 0) + '</span><span>浏览 ' + t.views + '</span></span>'
      + '</div></article>';
  }

  // 全局委托：点击头像 → 进入该用户主页（优先于帖子卡片跳转）
  content.addEventListener('click', (e) => {
    const av = e.target.closest('.avatar.clickable');
    if (av && av.dataset.user) {
      e.preventDefault(); e.stopPropagation();
      location.hash = '#/user/' + encodeURIComponent(av.dataset.user);
      return;
    }
    const nm = e.target.closest('[data-user]');
    if (nm && nm.dataset.user && !nm.classList.contains('avatar')) {
      e.preventDefault(); e.stopPropagation();
      location.hash = '#/user/' + encodeURIComponent(nm.dataset.user);
      return;
    }
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
        + '<div class="reply-main"><div class="reply-head"><span class="name" data-user="' + esc(ra.username || '') + '">' + esc(ra.username || '匿名') + '</span>'
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
      + '<div class="post-body">' + esc(t.body) + '</div>'
      + '<div class="like-bar"><button class="like-btn' + (t.liked ? ' liked' : '') + '" id="likeBtn">'
      + '<span class="heart">' + (t.liked ? '♥' : '♡') + '</span> <span id="likeCount">' + (t.likes || 0) + '</span> 赞</button></div>'
      + '</article>'
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
    const lb = document.getElementById('likeBtn');
    if (lb) lb.onclick = async () => {
      if (!ME) { openAuth(); return; }
      try {
        const d = await api('/api/threads/' + id + '/like', { method: 'POST' });
        lb.classList.toggle('liked', d.liked);
        lb.querySelector('.heart').textContent = d.liked ? '♥' : '♡';
        document.getElementById('likeCount').textContent = d.likes;
      } catch (e) { alert(e.message); }
    };
  }

  async function viewUser(username) {
    const data = await api('/api/users/' + encodeURIComponent(username));
    const u = data.user;
    const isSelf = ME && ME.username === u.username;
    const feed = (data.threads || []).map(threadCard).join('') || '<div class="empty">该用户还没发帖</div>';
    const cover = u.bg_image ? ' style="background-image:url(' + esc(u.bg_image) + ')"' : '';
    content.innerHTML =
      '<div class="appbar"><button class="btn" id="backBtn">←</button><h1 style="font-size:15px;">' + esc(u.username) + ' 的主页</h1><span class="spacer"></span>' + (isSelf ? '<button class="btn" id="toMe">编辑资料</button>' : '') + '</div>'
      + '<div class="content-inner"><div class="profile">'
      + '<div class="profile-cover"' + cover + '></div>'
      + '<div class="profile-main">'
      + '<div class="profile-top">'
      + avatarHTML({ username: u.username, avatar: u.avatar })
      + '<div class="profile-id"><div class="pn">' + esc(u.username) + ' <span class="lvl">Lv.' + u.level + '</span></div>'
      + '<div class="pm">' + esc(u.bio || DEFAULT_BIO) + '</div></div>'
      + (isSelf ? '' : '<button class="btn follow-btn' + (u.is_following ? ' following' : '') + '" id="followBtn">' + (u.is_following ? '已关注' : '+ 关注') + '</button>')
      + '</div>'
      + '<div class="profile-stats">'
      + '<div class="pstat"><b>' + (data.threads ? data.threads.length : 0) + '</b><span>帖子</span></div>'
      + '<div class="pstat"><b>' + (u.followers || 0) + '</b><span>粉丝</span></div>'
      + '<div class="pstat"><b>' + (u.following || 0) + '</b><span>关注</span></div>'
      + '<div class="pstat"><b>' + (u.likes || 0) + '</b><span>获赞</span></div>'
      + '</div>'
      + '<h3 class="sec-title">帖子</h3>'
      + '<div class="feed">' + feed + '</div>'
      + '</div></div>';
    const bb = document.getElementById('backBtn'); if (bb) bb.onclick = () => history.length > 1 ? history.back() : (location.hash = '#/home');
    const tm = document.getElementById('toMe'); if (tm) tm.onclick = () => (location.hash = '#/profile');
    const fb = document.getElementById('followBtn');
    if (fb) fb.onclick = async () => {
      try {
        const d = await api('/api/users/' + encodeURIComponent(username) + '/follow', { method: 'POST' });
        fb.classList.toggle('following', d.is_following);
        fb.textContent = d.is_following ? '已关注' : '+ 关注';
        const stats = fb.closest('.profile').querySelectorAll('.profile-stats .pstat b');
        if (stats[1]) stats[1].textContent = d.followers;
      } catch (e) { alert(e.message); }
    };
  }

  async function viewProfile() {
    if (!ME) { openAuth(); return; }
    const u = ME;
    const my = await api('/api/users/' + encodeURIComponent(u.username));
    const mu = my.user;
    const feed = (my.threads || []).map(threadCard).join('') || '<div class="empty">还没有发帖</div>';
    // 没设封面时留空 → 走 CSS 里的默认森林封面
    const coverStyle = u.bg_image ? ' style="background-image:url(' + esc(u.bg_image) + ')"' : '';
    content.innerHTML =
      '<div class="appbar"><h1>我的</h1><span class="spacer"></span><span class="muted">双击头像 / 封面 / 简介即可修改</span></div>'
      + '<div class="content-inner"><div class="profile">'
      + '<div class="profile-cover" id="coverBox" title="双击更换封面"' + coverStyle + '>'
      + '<div class="cover-actions"><button class="btn" id="upBg">换封面</button></div></div>'
      + '<div class="profile-main">'
      + '<div class="profile-top">'
      + avatarHTML({ username: u.username, avatar: u.avatar }, false)
      + '<div class="profile-id"><div class="pn">' + esc(u.username) + ' <span class="lvl">Lv.' + u.level + '</span></div>'
      + '<div class="pm">经验 ' + u.exp + ' · ' + esc(u.role === 'admin' ? '管理员' : '会员') + '</div></div>'
      + '<button class="btn" id="upAvatar">换头像</button>'
      + '</div>'
      + '<div class="profile-stats">'
      + '<div class="pstat"><b>' + (my.threads ? my.threads.length : 0) + '</b><span>帖子</span></div>'
      + '<div class="pstat"><b>' + (mu.followers || 0) + '</b><span>粉丝</span></div>'
      + '<div class="pstat"><b>' + (mu.following || 0) + '</b><span>关注</span></div>'
      + '<div class="pstat"><b>' + (mu.likes || 0) + '</b><span>获赞</span></div>'
      + '</div>'
      + '<h3 class="sec-title">个人简介 <span class="bio-hint">双击文字修改</span></h3>'
      + '<div class="bio-block" id="bioBlock"></div>'
      + '<h3 class="sec-title">我发的帖子</h3>'
      + '<div class="feed">' + feed + '</div>'
      + '<div class="profile-actions"><button class="btn" id="logout">退出登录</button></div>'
      + '</div></div>';

    /* --- 个人简介：默认只读展示，双击进入编辑 --- */
    const bioBlock = document.getElementById('bioBlock');
    function renderBioView() {
      const text = (ME.bio || '').trim();
      bioBlock.innerHTML = '<div class="bio-view' + (text ? '' : ' placeholder') + '" title="双击修改">'
        + esc(text || DEFAULT_BIO) + '</div>';
    }
    function startBioEdit() {
      bioBlock.innerHTML = '<textarea id="bioInput" maxlength="500" placeholder="' + esc(DEFAULT_BIO) + '"></textarea>'
        + '<div class="bio-actions"><button class="btn primary" id="bioSave">保存</button>'
        + '<button class="btn" id="bioCancel">取消</button>'
        + '<span class="muted" id="bioMsg">Ctrl+Enter 保存 · Esc 取消</span></div>';
      const ta = document.getElementById('bioInput');
      ta.value = ME.bio || '';
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      const save = async () => {
        try {
          await api('/api/me', { method: 'PATCH', body: JSON.stringify({ bio: ta.value.trim() }) });
          await refreshMe();
          renderBioView();
        } catch (e) { document.getElementById('bioMsg').textContent = e.message; }
      };
      document.getElementById('bioSave').onclick = save;
      document.getElementById('bioCancel').onclick = renderBioView;
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); renderBioView(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
      });
    }
    bioBlock.addEventListener('dblclick', (e) => { if (e.target.closest('.bio-view')) startBioEdit(); });
    renderBioView();

    /* --- 头像 / 封面：按钮点一下，或直接双击 --- */
    const changeAvatar = () => pickImage(256, 0.85, async (dataUrl) => {
      await api('/api/me', { method: 'PATCH', body: JSON.stringify({ avatar: dataUrl }) }); await refreshMe(); viewProfile();
    });
    const changeCover = () => pickImage(1280, 0.75, async (dataUrl) => {
      await api('/api/me', { method: 'PATCH', body: JSON.stringify({ bg_image: dataUrl }) }); await refreshMe(); viewProfile();
    });
    document.getElementById('upAvatar').onclick = changeAvatar;
    document.getElementById('upBg').onclick = changeCover;
    const avEl = content.querySelector('.profile-top .avatar');
    if (avEl) { avEl.style.cursor = 'pointer'; avEl.title = '双击更换头像'; avEl.addEventListener('dblclick', changeAvatar); }
    document.getElementById('coverBox').addEventListener('dblclick', (e) => {
      if (e.target.closest('.cover-actions')) return;
      changeCover();
    });

    document.getElementById('logout').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST' }); ME = null; location.hash = '#/home'; router();
    };
  }

  // 设置页 = 纯个人偏好。站点管理不在这里，独立在 /admin（仅管理员可进）。
  async function viewSettings() {
    if (!ME) { openAuth(); return; }
    const isAdmin = ME.role === 'admin';
    content.innerHTML =
      '<div class="appbar"><h1>设置</h1></div><div class="content-inner">'
      + '<h3 class="sec-title">个人偏好</h3>'
      + '<div class="settings-row"><div><div style="font-weight:600;">深色模式</div><div class="muted">切换浅色 / 深色界面（仅对本机生效）</div></div>'
      + '<label class="switch"><input type="checkbox" id="themeToggle"' + (localStorage.getItem('theme') === 'dark' ? ' checked' : '') + '><span class="slider"></span></label></div>'
      + '<div class="settings-row"><div><div style="font-weight:600;">账号</div><div class="muted">' + esc(ME.username) + '</div></div>'
      + '<button class="btn" id="toProfile">我的资料</button></div>'
      + '<div class="settings-row"><div><div style="font-weight:600;">退出登录</div><div class="muted">在这台设备上退出当前账号</div></div>'
      + '<button class="btn" id="sLogout">退出</button></div>'
      + (isAdmin
        ? '<h3 class="sec-title" style="margin-top:26px;">管理员</h3>'
          + '<div class="settings-row"><div><div style="font-weight:600;">管理后台</div>'
          + '<div class="muted">站点设置、用户与帖子管理都在 /admin（横屏页面）</div></div>'
          + '<button class="btn primary" id="toAdmin">打开 /admin</button></div>'
        : '')
      + '</div>';
    document.getElementById('themeToggle').onchange = (e) => {
      const t = e.target.checked ? 'dark' : 'light';
      localStorage.setItem('theme', t);
      document.documentElement.dataset.theme = t;
    };
    document.getElementById('toProfile').onclick = () => (location.hash = '#/profile');
    document.getElementById('sLogout').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST' }); ME = null; location.hash = '#/home'; router();
    };
    const ta = document.getElementById('toAdmin');
    if (ta) ta.onclick = () => (location.href = '/admin');
  }

  /* ===== 图片上传（转 base64 直接存 D1，无需 R2） ===== */
  // maxDim: 最长边像素上限；quality: JPEG 压缩质量（越小越省空间）
  function pickImage(maxDim, quality, cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const dataUrl = await fileToDataURL(f, maxDim, quality);
        await cb(dataUrl);
      } catch (e) { alert(e.message || '图片处理失败'); }
    };
    inp.click();
  }

  // 读取图片 -> 等比缩放到 maxDim 以内 -> 输出 JPEG data URL（控制体积，适配 D1 单字段 1MB 上限）
  function fileToDataURL(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('无法解析图片'));
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, maxDim / Math.max(width, height));
          width = Math.round(width * scale); height = Math.round(height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
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
