(function () {
  'use strict';
  const rail = document.getElementById('rail');
  const content = document.getElementById('content');
  const modalRoot = document.getElementById('modal-root');
  const bg = document.getElementById('bg');

  let SETTINGS = { site_name: 'WorkerBBS', site_accent: '#0f6cbd', site_bg: '', site_desc: '' };
  let ME = null;
  let BOARDS = [];

  const DEFAULT_BIO = '此人很懒，没有留下个人简介';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* 富文本：只允许的安全标签/属性白名单（渲染前必过，防 XSS） */
  const ALLOWED_TAGS = { P:1, BR:1, DIV:1, SPAN:1, B:1, STRONG:1, I:1, EM:1, U:1, S:1, STRIKE:1, UL:1, OL:1, LI:1, BLOCKQUOTE:1, A:1, IMG:1, VIDEO:1, H1:1, H2:1, H3:1, CODE:1, PRE:1 };
  function sanitizeHTML(html) {
    if (typeof html !== 'string') return '';
    const doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
    const root = doc.body.firstChild;
    function walk(node) {
      const kids = Array.from(node.childNodes);
      for (const ch of kids) {
        if (ch.nodeType !== 1) continue; // 只处理元素节点，文本原样保留
        const tag = ch.tagName;
        if (!ALLOWED_TAGS[tag]) { // 不允许的标签：拆掉外壳、保留其子孙
          walk(ch);
          while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
          node.removeChild(ch);
          continue;
        }
        for (const attr of Array.from(ch.attributes)) {
          const n = attr.name.toLowerCase();
          const v = attr.value.trim().toLowerCase();
          let ok = false;
          if (n === 'href' && (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('mailto:'))) ok = true;
          else if (n === 'src' && (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/') || v.startsWith('data:image') || v.startsWith('data:video'))) ok = true;
          else if (n === 'alt' || n === 'poster' || n === 'controls') ok = true;
          if (!ok) ch.removeAttribute(attr.name);
        }
        if (tag === 'VIDEO' && !ch.hasAttribute('controls')) ch.setAttribute('controls', '');
        walk(ch);
      }
    }
    walk(root);
    return root.innerHTML;
  }
  /* 渲染帖子正文：纯文本老帖子保留换行，HTML 帖子走白名单清洗 */
  function renderBody(body) {
    if (typeof body !== 'string') return '';
    if (!body.trim().startsWith('<')) return esc(body).replace(/\n/g, '<br>');
    return sanitizeHTML(body);
  }
  /* 取纯文本（用于卡片摘要） */
  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = (typeof html === 'string') ? html : '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }
  // clickable=false 时不挂 data-user（例如自己的主页，头像用于双击换图，不再跳转）
  function avatarHTML(u, clickable) {
    const cls = 'avatar' + (clickable === false ? '' : ' clickable');
    const attr = clickable === false ? '' : ' data-user="' + esc(u ? u.username : '') + '"';
    return u && u.avatar
      ? '<span class="' + cls + '"' + attr + '><img src="' + esc(u.avatar) + '" alt=""></span>'
      : '<span class="' + cls + '"' + attr + '>' + esc(u ? u.username : '?').slice(0, 1) + '</span>';
  }

  /* ===== 表情 / 引用 / 标签 / 群组 渲染助手 ===== */
  const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉', '💯', '🤔', '😡', '🥳'];

  function tagChip(tg) {
    return '<a class="tag-chip" data-tag="' + tg.id + '" style="--tc:' + esc(tg.color || '#0f6cbd') + '">' + esc(tg.name) + '</a>';
  }
  function groupBadgesHTML(groups) {
    if (!groups || !groups.length) return '';
    return '<span class="grp-badges">' + groups.map((g) => '<span class="grp-badge" style="--gc:' + esc(g.color || '#0f6cbd') + '">' + esc(g.name) + '</span>').join('') + '</span>';
  }
  function quotedThreadHTML(q) {
    if (!q) return '';
    return '<div class="quoted-card"><div class="quoted-head">引用了 <a href="#/thread/' + q.id + '">#' + q.id + ' ' + esc(q.title || '') + '</a></div>'
      + '<div class="quoted-sub">by ' + esc(q.author || '未知') + '</div></div>';
  }
  function quotedReplyHTML(q) {
    if (!q) return '';
    return '<div class="quoted-reply"><div class="quoted-name">' + esc(q.author || '未知') + ' 说：</div>'
      + '<div class="quoted-body">' + esc((q.body || '').slice(0, 140)) + '</div></div>';
  }
  function reactionsHTML(summary) {
    const entries = Object.keys(summary || {}).filter((e) => summary[e] && summary[e].count > 0);
    return entries.map((e) => {
      const s = summary[e];
      return '<button class="react-chip' + (s.mine ? ' mine' : '') + '" data-emoji="' + esc(e) + '">' + e + ' <span class="rcount">' + s.count + '</span></button>';
    }).join('');
  }
  function reactionBarHTML(targetType, id, summary) {
    return '<div class="react-bar" data-type="' + targetType + '" data-id="' + id + '">'
      + reactionsHTML(summary)
      + '<button class="react-add" title="表情回应">' + WI('emoji', 16) + '</button></div>';
  }
  async function doReaction(targetType, id, emoji) {
    try {
      const d = await api('/api/reactions', { method: 'POST', body: JSON.stringify({ target_type: targetType, target_id: id, emoji }) });
      updateReactionBar(targetType, id, d.summary);
    } catch (e) { /* 忽略瞬时错误 */ }
  }
  function updateReactionBar(targetType, id, summary) {
    const bar = content.querySelector('.react-bar[data-type="' + targetType + '"][data-id="' + id + '"]');
    if (!bar) return;
    bar.innerHTML = reactionsHTML(summary) + '<button class="react-add" title="表情回应">' + WI('emoji', 16) + '</button>';
  }
  let reactPicker = null;
  function closeReactionPicker() {
    if (reactPicker) { reactPicker.remove(); reactPicker = null; }
    document.removeEventListener('click', closeReactionPickerOnce);
  }
  function closeReactionPickerOnce(e) { if (reactPicker && !reactPicker.contains(e.target)) closeReactionPicker(); }
  function openReactionPicker(anchorBtn, targetType, id) {
    closeReactionPicker();
    const pop = document.createElement('div');
    pop.className = 'react-pop';
    pop.innerHTML = REACTIONS.map((e) => '<button class="react-opt" data-emoji="' + e + '">' + e + '</button>').join('');
    document.body.appendChild(pop);
    reactPicker = pop;
    const r = anchorBtn.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.min(window.innerWidth - pw - 8, r.left);
    if (left < 8) left = 8;
    let top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.querySelectorAll('.react-opt').forEach((b) => {
      b.onclick = async () => { closeReactionPicker(); await doReaction(targetType, id, b.dataset.emoji); };
    });
    setTimeout(() => document.addEventListener('click', closeReactionPickerOnce), 0);
  }

  /* ===== 全局加载指示（顶部进度条）===== */
  let __load = 0;
  let __bar = null;
  function beginLoad() {
    __load++;
    if (!__bar) __bar = document.getElementById('loading-bar');
    if (__bar) __bar.classList.add('active');
  }
  function endLoad() {
    __load = Math.max(0, __load - 1);
    if (__load === 0 && __bar) __bar.classList.remove('active');
  }
  async function api(path, opts) {
    beginLoad();
    try {
      opts = opts || {};
      opts.credentials = 'same-origin';
      opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
      const res = await fetch(path, opts);
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
      return data;
    } finally {
      endLoad();
    }
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 2592000) return Math.floor(s / 86400) + ' 天前';
    return new Date(ts).toLocaleDateString();
  }

  /* ===== 图标（WinUI / Fluent 风格，见 public/icons.js）===== */
  function buildRail() {
    const items = [
      { n: 'home', label: '首页', view: '#/home' },
      { n: 'search', label: '发现', view: '#/discover' },
      { n: 'add', label: '发帖', view: '#/compose' },
      { n: 'chat', label: '私信', view: '#/messages', badge: 'dm' },
      { n: 'person', label: '我的', view: '#/profile' },
    ];
    let html = '<button class="nav-toggle" data-label="菜单" aria-label="菜单">' + WI('navigation', 20) + '</button>';
    items.forEach((it) => {
      html += '<button class="nav-item" data-label="' + it.label + '" data-view="' + it.view + '">' + WI(it.n, 20);
      if (it.badge) html += '<span class="nav-badge" id="' + it.badge + 'Badge" hidden></span>';
      html += '</button>';
    });
    html += '<span class="spacer"></span>';
    html += '<button class="nav-item" data-label="设置" data-view="#/settings">' + WI('settings', 20) + '</button>';
    // 插件导航项（由 window.WB.plugins 注入）
    const WBP = window.WB && window.WB.plugins ? window.WB.plugins : {};
    Object.keys(WBP).forEach((pid) => {
      const p = WBP[pid];
      const icon = (typeof p.icon === 'string' && p.icon) ? p.icon : WI('sparkle', 20);
      html += '<button class="nav-item" data-label="' + esc(p.name || pid) + '" data-view="#/plugin/' + pid + '">' + icon + '</button>';
    });
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
    // 深色模式：持久化在 localStorage（个人偏好，与站点主题色无关）
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.dataset.theme = theme;
    // 站点强调色只在浅色模式下内联覆盖；深色模式让 [data-theme="dark"] 里的 --accent 生效，
    // 否则内联样式（优先级最高）会把深色强调色顶掉，导致深色下仍是浅色蓝。
    if (theme === 'dark') document.documentElement.style.removeProperty('--accent');
    else document.documentElement.style.setProperty('--accent', SETTINGS.site_accent || '#0f6cbd');
    // 注入用户自定义主题 CSS（覆盖语义变量换肤）。放 head 末尾，优先级高于默认 :root。
    let tEl = document.getElementById('user-theme');
    if (SETTINGS.theme_css) {
      if (!tEl) { tEl = document.createElement('style'); tEl.id = 'user-theme'; document.head.appendChild(tEl); }
      tEl.textContent = SETTINGS.theme_css;
    } else if (tEl) {
      tEl.remove();
    }
    if (SETTINGS.site_bg) bg.style.backgroundImage = 'url(' + SETTINGS.site_bg + ')';
    else bg.style.backgroundImage = '';
    document.title = SETTINGS.site_name || 'WorkerBBS';
    renderBrand();
  }

  // 顶栏品牌（LOGO + 站名）
  function renderBrand() {
    const logo = document.getElementById('siteLogo');
    const name = document.getElementById('siteName');
    if (logo) {
      if (SETTINGS.site_logo) { logo.src = SETTINGS.site_logo; logo.hidden = false; }
      else logo.hidden = true;
    }
    if (name) name.textContent = SETTINGS.site_name || 'WorkerBBS';
  }

  /* ===== 实时通知 toast ===== */
  let toastWrap = null;
  function toast(html) {
    if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toast-wrap'; document.body.appendChild(toastWrap); }
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    toastWrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 4200);
  }

  function loginBtn() { return '<button class="btn primary" id="loginBtn">登录</button>'; }

  /* ===== 帖子卡片 ===== */
  function threadCard(t) {
    const a = t.author || {};
    return '<article class="post-card" data-id="' + t.id + '">'
      + '<span class="post-tag">' + esc(t.board_name || '') + '</span>'
      + '<h3 class="post-title">' + esc(t.title) + '</h3>'
      + (t.quote_thread ? quotedThreadHTML(t.quote_thread) : '')
      + (t.tags && t.tags.length ? '<div class="tags">' + t.tags.map(tagChip).join('') + '</div>' : '')
      + '<p class="post-snippet">' + esc(htmlToText(t.body).slice(0, 120)) + '</p>'
      + '<div class="post-meta">'
      + avatarHTML(a)
      + '<span class="name" data-user="' + esc(a.username || '') + '">' + esc(a.username || '匿名') + '</span>'
      + groupBadgesHTML(a.groups)
      + (a.level ? '<span class="lvl">Lv.' + a.level + '</span>' : '')
      + '<span class="dot"></span><span>' + esc(timeAgo(t.created_at)) + '</span>'
      + '<span class="right"><span><span class="meta-ico">' + WI('comment', 14) + '</span>回复 ' + (t.reply_count || 0) + '</span>'
      + '<span><span class="meta-ico">' + WI('eye', 14) + '</span>浏览 ' + t.views + '</span></span>'
      + '<span class="quote-act" data-quote-thread="' + t.id + '" title="引用这篇帖子">' + WI('quote', 14) + ' 引用</span>'
      + '</div>'
      + (t.reactions ? reactionBarHTML('thread', t.id, t.reactions) : '')
      + '</article>';
  }

  // 搜索结果里的用户行
  function userRow(u) {
    const bio = (u.bio && u.bio !== DEFAULT_BIO) ? u.bio : '这个人很神秘';
    return '<div class="user-row" data-user="' + esc(u.username) + '">'
      + avatarHTML(u)
      + '<div class="u-main"><div class="u-name">' + esc(u.username) + (u.level ? ' <span class="lvl">Lv.' + u.level + '</span>' : '') + groupBadgesHTML(u.groups) + '</div>'
      + '<div class="u-bio muted">' + esc(bio) + '</div></div></div>';
  }

  // 全局委托：点击头像 → 进入该用户主页（优先于帖子卡片跳转）
  content.addEventListener('click', (e) => {
    // 表情回应：打开选择器 / 切换已有表情
    const ra = e.target.closest('.react-add');
    if (ra) { const bar = ra.closest('.react-bar'); if (bar) openReactionPicker(ra, bar.dataset.type, bar.dataset.id); return; }
    const rc = e.target.closest('.react-chip');
    if (rc) { const bar = rc.closest('.react-bar'); if (bar) doReaction(bar.dataset.type, bar.dataset.id, rc.dataset.emoji); return; }
    // 标签筛选
    const tg = e.target.closest('[data-tag]');
    if (tg) { e.preventDefault(); e.stopPropagation(); location.hash = '#/home?tag=' + tg.dataset.tag; return; }
    // 引用帖子 → 进入带引用的发帖页
    const qt = e.target.closest('[data-quote-thread]');
    if (qt) { e.preventDefault(); e.stopPropagation(); location.hash = '#/compose?quote=' + qt.dataset.quoteThread; return; }
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
    const tm = location.hash.match(/[?&]tag=(\d+)/);
    const tagId = tm ? Number(tm[1]) : 0;
    const data = await api('/api/threads' + (tagId ? '?tag=' + tagId : ''));
    let tagName = '';
    if (tagId) { try { const tg = await api('/api/tags'); const f = (tg.tags || []).find((x) => x.id === tagId); tagName = f ? f.name : ''; } catch (e) {} }
    const feed = data.threads.length ? data.threads.map(threadCard).join('') : '<div class="empty">还没有帖子，去发一帖吧</div>';
    content.innerHTML =
      '<div class="appbar"><h1>' + esc(SETTINGS.site_name || 'WorkerBBS') + '</h1><span class="spacer"></span>'
      + (ME ? '<button class="btn primary" id="newPost">+ 发布</button>' : loginBtn()) + '</div>'
      + (tagId ? '<div class="tag-filter"><span class="tf-label">标签：<b style="color:var(--accent)">' + esc(tagName || ('#' + tagId)) + '</b></span><button class="btn" id="clearTag">清除筛选</button></div>' : '')
      + '<div class="content-inner"><div class="feed">' + feed + '</div></div>';
    const b = document.getElementById('newPost'); if (b) b.onclick = () => (location.hash = '#/compose');
    const lb = document.getElementById('loginBtn'); if (lb) lb.onclick = openAuth;
    const ct = document.getElementById('clearTag'); if (ct) ct.onclick = () => (location.hash = '#/home');
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

  async function viewSearch() {
    const m = location.hash.match(/\?q=([^&]*)/);
    const q = decodeURIComponent(m ? m[1] : '');
    content.innerHTML =
      '<div class="appbar"><h1>搜索</h1><span class="spacer"></span></div>'
      + '<div class="content-inner">'
      + '<div class="search" style="margin-bottom:14px;"><input id="sfield" type="search" placeholder="搜索帖子或用户…" autocomplete="off" value="' + esc(q) + '" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit;font-size:14px;" /></div>'
      + '<div id="sresult"></div>'
      + '</div>';
    const field = document.getElementById('sfield');
    const box = document.getElementById('sresult');
    const render = async () => {
      const text = field.value.trim();
      if (!text) { box.innerHTML = '<div class="empty">输入关键词开始搜索</div>'; return; }
      try {
        const r = await api('/api/search?q=' + encodeURIComponent(text));
        let html = '';
        if (r.users && r.users.length) html += '<h3 class="sec-title">用户</h3><div class="user-list">' + r.users.map(userRow).join('') + '</div>';
        if (r.threads && r.threads.length) html += '<h3 class="sec-title">帖子</h3><div class="feed">' + r.threads.map(threadCard).join('') + '</div>';
        if (!html) html = '<div class="empty">没有找到与「' + esc(text) + '」相关的内容</div>';
        box.innerHTML = html;
      } catch (e) { box.innerHTML = '<div class="empty">搜索失败：' + esc(e.message) + '</div>'; }
    };
    field.addEventListener('input', render);
    field.focus();
    if (q) render();
    else box.innerHTML = '<div class="empty">输入关键词开始搜索</div>';
  }

  async function viewCompose() {
    if (!ME) { openAuth(); return; }
    const qm = location.hash.match(/\?quote=(\d+)/);
    const quoteThreadId = qm ? Number(qm[1]) : 0;
    let quoted = null;
    if (quoteThreadId) { try { const qd = await api('/api/threads/' + quoteThreadId); quoted = { id: qd.thread.id, title: qd.thread.title, author: qd.thread.author ? qd.thread.author.username : '' }; } catch (e) {} }
    const opts = BOARDS.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join('');
    const tb = (cmd, title) => '<button type="button" class="rte-btn" data-cmd="' + cmd + '" title="' + title + '">' + WI(cmd, 18) + '</button>';
    const sep = '<span class="rte-sep"></span>';
    content.innerHTML =
      '<div class="appbar"><button class="btn" id="backBtn">' + WI('chevronLeft', 18) + ' 返回</button><h1>发帖</h1><span class="spacer"></span></div>'
      + '<div class="content-inner"><div class="compose">'
      + (quoted ? '<div class="quoted-card" style="margin-bottom:14px;">' + quotedThreadHTML(quoted) + '</div>' : '')
      + '<label>板块</label><select id="cBoard">' + opts + '</select>'
      + '<label>标题</label><input id="cTitle" placeholder="一句话说清楚" />'
      + '<label>正文</label>'
      + '<div class="rte-wrap">'
      + '<div class="rte-toolbar" id="rteBar">'
      + tb('bold', '加粗') + tb('italic', '斜体') + tb('underline', '下划线') + tb('strike', '删除线') + sep
      + tb('heading', '标题') + tb('list', '无序列表') + tb('listOrdered', '有序列表') + tb('quote', '引用') + sep
      + tb('link', '链接') + tb('image', '图片') + '<button type="button" class="rte-btn" data-act="video" title="视频">' + WI('video', 18) + '</button>'
      + '</div>'
      + '<div class="rte" id="cBody" contenteditable="true" data-placeholder="说点什么…支持文字、图片和视频"></div>'
      + '</div>'
      + '<div class="row"><span class="muted" id="cHint">视频以 base64 内嵌，建议小于 700KB</span><span class="spacer"></span>'
      + '<button class="btn" id="cCancel">取消</button>'
      + '<button class="btn primary" id="cSubmit">发布</button></div>'
      + '<div class="err" id="cErr"></div></div></div>';

    document.getElementById('backBtn').onclick = () => (location.hash = '#/home');
    document.getElementById('cCancel').onclick = () => (location.hash = '#/home');

    const ed = document.getElementById('cBody');
    document.getElementById('rteBar').addEventListener('click', (e) => {
      const b = e.target.closest('.rte-btn'); if (!b) return;
      e.preventDefault();
      ed.focus();
      const cmd = b.dataset.cmd, act = b.dataset.act;
      if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline' || cmd === 'strike') document.execCommand(cmd);
      else if (cmd === 'list') document.execCommand('insertUnorderedList');
      else if (cmd === 'listOrdered') document.execCommand('insertOrderedList');
      else if (cmd === 'heading') document.execCommand('formatBlock', false, 'H3');
      else if (cmd === 'quote') document.execCommand('formatBlock', false, 'BLOCKQUOTE');
      else if (cmd === 'link') { const url = prompt('链接地址（以 http/https 开头）'); if (url) document.execCommand('createLink', false, url); }
      else if (cmd === 'image') insertPostImage();
      else if (act === 'video') insertPostVideo();
    });

    document.getElementById('cSubmit').onclick = async () => {
      const title = document.getElementById('cTitle').value.trim();
      const raw = ed.innerHTML;
      const html = sanitizeHTML(raw);
      const text = htmlToText(html);
      const boardId = document.getElementById('cBoard').value;
      const err = document.getElementById('cErr');
      if (!title) { err.textContent = '标题不能为空'; return; }
      if (!text.trim()) { err.textContent = '正文不能为空'; return; }
      if (new Blob([html]).size > 950000) { err.textContent = '内容过大（含媒体超过 D1 约 1MB 上限），请压缩视频或缩短正文'; return; }
      try {
        const d = await api('/api/threads', { method: 'POST', body: JSON.stringify({ board_id: boardId, title, body: html, quote_thread_id: quoteThreadId }) });
        location.hash = '#/thread/' + d.id;
      } catch (e) { err.textContent = e.message; }
    };
  }

  /* 在富文本光标处插入 HTML */
  function insertHTMLAtCursor(htmlStr) {
    const ed = document.getElementById('cBody');
    if (ed) ed.focus();
    if (document.execCommand) document.execCommand('insertHTML', false, htmlStr);
  }
  function insertPostImage() {
    pickImage(1280, 0.82, async (dataUrl) => {
      insertHTMLAtCursor('<img src="' + dataUrl + '" alt="">');
    });
  }
  function insertPostVideo() {
    pickVideo(700 * 1024, async (dataUrl) => {
      insertHTMLAtCursor('<video controls src="' + dataUrl + '"></video><p><br></p>');
    });
  }

  async function viewThread(id) {
    const data = await api('/api/threads/' + id);
    const t = data.thread;
    const a = t.author || {};
    const rawReplies = data.replies;
    let pendingQuoteReply = 0;
    const repliesHTML = rawReplies.map((r) => {
      const ra = r.author || {};
      return '<div class="reply-card" data-rid="' + r.id + '">' + avatarHTML(ra)
        + '<div class="reply-main"><div class="reply-head"><span class="name" data-user="' + esc(ra.username || '') + '">' + esc(ra.username || '匿名') + '</span>'
        + groupBadgesHTML(ra.groups)
        + (ra.level ? '<span class="lvl">Lv.' + ra.level + '</span>' : '') + '<span class="dot"></span><span>' + esc(timeAgo(r.created_at)) + '</span>'
        + '<span class="reply-quote-act" data-quote-reply="' + r.id + '" title="引用这条回复">' + WI('quote', 14) + ' 引用</span></div>'
        + (r.quote_reply ? quotedReplyHTML(r.quote_reply) : '')
        + '<div class="reply-text">' + esc(r.body) + '</div>'
        + (r.reactions ? reactionBarHTML('reply', r.id, r.reactions) : '')
        + '</div></div>';
    }).join('');
    const replyCount = rawReplies.length;
    content.innerHTML =
      '<div class="appbar"><button class="btn" id="backBtn">' + WI('chevronLeft', 18) + ' 返回</button><h1 style="font-size:15px;">' + esc(t.board_name) + '</h1><span class="spacer"></span></div>'
      + '<div class="content-inner">'
      + '<article class="post-detail"><span class="post-tag">' + esc(t.board_name) + '</span>'
      + '<h2 class="post-title">' + esc(t.title) + '</h2>'
      + (t.quote_thread ? quotedThreadHTML(t.quote_thread) : '')
      + (t.tags && t.tags.length ? '<div class="tags">' + t.tags.map(tagChip).join('') + '</div>' : '')
      + '<div class="post-meta" style="margin-bottom:14px;">' + avatarHTML(a)
      + '<a class="name" href="#/user/' + esc(a.username || '') + '">' + esc(a.username || '匿名') + '</a>'
      + groupBadgesHTML(a.groups)
      + (a.level ? '<span class="lvl">Lv.' + a.level + '</span>' : '') + '<span class="dot"></span><span>' + esc(timeAgo(t.created_at)) + '</span>'
      + '<span class="right"><span><span class="meta-ico">' + WI('comment', 14) + '</span>回复 ' + replyCount + '</span>'
      + '<span><span class="meta-ico">' + WI('eye', 14) + '</span>浏览 ' + t.views + '</span></span></div>'
      + '<div class="post-body">' + renderBody(t.body) + '</div>'
      + '<div class="like-bar"><button class="like-btn' + (t.liked ? ' liked' : '') + '" id="likeBtn">'
      + WI(t.liked ? 'heartFill' : 'heart', 18)
      + ' <span id="likeCount">' + (t.likes || 0) + '</span> 赞</button></div>'
      + (t.reactions ? reactionBarHTML('thread', t.id, t.reactions) : '')
      + '</article>'
      + '<h3 style="font-size:14px;margin:22px 0 6px;color:var(--text-2);">' + replyCount + ' 条回复</h3>'
      + '<div class="replies" id="reps">' + (repliesHTML || '<div class="empty">还没有回复，来抢沙发</div>') + '</div>'
      + (ME ? '<div class="reply-box"><div id="quotePreview" class="quote-preview" hidden></div>'
            + '<input id="replyInput" placeholder="写下你的回复…" /><button class="btn primary" id="sendReply">' + WI('send', 16) + ' 发送</button></div>'
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
        await api('/api/threads/' + id + '/replies', { method: 'POST', body: JSON.stringify({ body: txt, quote_reply_id: pendingQuoteReply }) });
        pendingQuoteReply = 0;
        viewThread(id);
      } catch (e) { alert(e.message); }
    };
    const lb = document.getElementById('likeBtn');
    if (lb) lb.onclick = async () => {
      if (!ME) { openAuth(); return; }
      try {
        const d = await api('/api/threads/' + id + '/like', { method: 'POST' });
        lb.classList.toggle('liked', d.liked);
        lb.innerHTML = WI(d.liked ? 'heartFill' : 'heart', 18) + ' <span id="likeCount">' + d.likes + '</span> 赞';
      } catch (e) { alert(e.message); }
    };
    content.querySelectorAll('[data-quote-reply]').forEach((btn) => {
      btn.onclick = () => {
        const rid = Number(btn.dataset.quoteReply);
        pendingQuoteReply = rid;
        const r = rawReplies.find((x) => x.id === rid);
        const qp = document.getElementById('quotePreview');
        if (!qp || !r) return;
        qp.hidden = false;
        qp.innerHTML = '引用 ' + esc(r.author ? r.author.username : '') + '：' + esc((r.body || '').slice(0, 80))
          + ' <button class="btn" id="qClear" style="padding:2px 8px;font-size:12px;">取消</button>';
        const qc = document.getElementById('qClear');
        if (qc) qc.onclick = () => { pendingQuoteReply = 0; qp.hidden = true; qp.innerHTML = ''; };
        const inp = document.getElementById('replyInput'); if (inp) inp.focus();
      };
    });
  }

  async function viewUser(username) {
    const data = await api('/api/users/' + encodeURIComponent(username));
    const u = data.user;
    const isSelf = ME && ME.username === u.username;
    const feed = (data.threads || []).map(threadCard).join('') || '<div class="empty">该用户还没发帖</div>';
    const cover = u.bg_image ? ' style="background-image:url(' + esc(u.bg_image) + ')"' : '';
    content.innerHTML =
      '<div class="appbar"><button class="btn" id="backBtn">' + WI('chevronLeft', 18) + '</button><h1 style="font-size:15px;">' + esc(u.username) + ' 的主页</h1><span class="spacer"></span>' + (isSelf ? '<button class="btn" id="toMe">' + WI('edit', 16) + ' 编辑资料</button>' : '') + '</div>'
      + '<div class="content-inner"><div class="profile">'
      + '<div class="profile-cover"' + cover + '></div>'
      + '<div class="profile-main">'
      + '<div class="profile-top">'
      + avatarHTML({ username: u.username, avatar: u.avatar })
      + '<div class="profile-id"><div class="pn">' + esc(u.username) + ' <span class="lvl">Lv.' + u.level + '</span></div>'
      + '<div class="pm">' + esc(u.bio || DEFAULT_BIO) + '</div>'
      + (u.groups && u.groups.length ? '<div class="grp-badges">' + u.groups.map((g) => '<span class="grp-badge" style="--gc:' + esc(g.color || '#0f6cbd') + '">' + esc(g.name) + '</span>').join('') + '</div>' : '')
      + '</div>'
      + (isSelf ? '' : '<button class="btn follow-btn' + (u.is_following ? ' following' : '') + '" id="followBtn">' + WI('userAdd', 16) + ' ' + (u.is_following ? '已关注' : '关注') + '</button>'
        + '<button class="btn" id="dmBtn">' + WI('chat', 16) + ' 发私信</button>')
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
    const dmb = document.getElementById('dmBtn');
    if (dmb) dmb.onclick = () => (location.hash = '#/messages/' + encodeURIComponent(u.username));
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
      + '<div class="profile-actions"><button class="btn" id="logout">' + WI('logout', 16) + ' 退出登录</button></div>'
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
      await api('/api/auth/logout', { method: 'POST' }); ME = null; if (wsSock) wsSock.close(); updateUnreadBadge(); location.hash = '#/home'; router();
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
      await api('/api/auth/logout', { method: 'POST' }); ME = null; if (wsSock) wsSock.close(); updateUnreadBadge(); location.hash = '#/home'; router();
    };
    const ta = document.getElementById('toAdmin');
    if (ta) ta.onclick = () => (location.href = '/admin');
  }

  /* ===== 图片上传（转 base64 直接存 D1，无需 R2） ===== */
  // maxDim: 最长边像素上限；quality: JPEG 压缩质量（越小越省空间）
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('读取文件失败'));
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
  }

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

  // 视频：浏览器无法就地压缩，直接读成 base64 内嵌；D1 单值约 1MB 上限，故限制源文件大小。
  function pickVideo(maxBytes, cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'video/*';
    inp.onclick = (e) => { e.stopPropagation(); };
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      if (f.size > maxBytes) { alert('视频太大（需 < ' + Math.round(maxBytes / 1024) + 'KB）。D1 存储上限约 1MB，请压缩或截短后重试。'); return; }
      try {
        const dataUrl = await readFileAsDataURL(f);
        await cb(dataUrl, f.type);
      } catch (e) { alert(e.message || '视频处理失败'); }
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
      + (SETTINGS.site_logo ? '<img class="brand-logo" src="' + esc(SETTINGS.site_logo) + '" alt="LOGO">' : '')
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
        + (isReg && SETTINGS.invite_required ? '<label>邀请码</label><input id="fInvite" placeholder="必填，向管理员索取">' : '')
        + '<label>密码</label><input id="fPwd" type="password" placeholder="至少 6 位">'
        + '<div class="row"><button class="btn primary" id="fSubmit" style="flex:1;">' + (isReg ? '注册' : '登录') + '</button></div>';
      document.getElementById('fSubmit').onclick = submit;
    };
    const submit = async () => {
      const err = document.getElementById('authErr'); err.textContent = '';
      try {
        if (mode === 'register') {
          const body = {
            username: document.getElementById('fUser').value.trim(),
            email: document.getElementById('fEmail').value.trim(),
            password: document.getElementById('fPwd').value,
          };
          if (SETTINGS.invite_required) {
            const inv = document.getElementById('fInvite');
            body.invite_code = inv ? inv.value.trim() : '';
          }
          const r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
          if (r.needsVerification) {
            closeAuth();
            alert('注册成功！验证邮件已发送至 ' + r.email + '，请查收并完成邮箱验证后再登录。');
            return;
          }
        } else {
          await api('/api/auth/login', { method: 'POST', body: JSON.stringify({
            identifier: document.getElementById('fId').value.trim(),
            password: document.getElementById('fPwd').value }) });
        }
        await refreshMe();
        closeAuth(); router(); connectRealtime();
      } catch (e) { err.textContent = e.message; }
    };
    renderForm();
    document.getElementById('tabLogin').onclick = () => { mode = 'login'; document.getElementById('tabLogin').classList.add('active'); document.getElementById('tabReg').classList.remove('active'); renderForm(); };
    document.getElementById('tabReg').onclick = () => { mode = 'register'; document.getElementById('tabReg').classList.add('active'); document.getElementById('tabLogin').classList.remove('active'); renderForm(); };
    document.getElementById('mask').onclick = (e) => { if (e.target.id === 'mask') closeAuth(); };
  }
  function closeAuth() { modalRoot.innerHTML = ''; }

  /* ===== 实时同步（WebSocket 中继节点） ===== */
  let wsSock = null, wsRetry = 0;
  function connectRealtime() {
    if (!SETTINGS.ws_endpoint || !ME) return;
    if (wsSock && (wsSock.readyState === WebSocket.CONNECTING || wsSock.readyState === WebSocket.OPEN)) return;
    try {
      const s = new WebSocket(SETTINGS.ws_endpoint.replace(/\/$/, '') + '/ws');
      wsSock = s;
      s.onopen = () => {
        wsRetry = 0;
        // 注册本会话归属的用户，用于 WebSocket 节点定向投递私信
        try { s.send(JSON.stringify({ type: 'auth', userId: ME.id })); } catch {}
      };
      s.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        handleRealtime(m);
      };
      s.onclose = () => { wsSock = null; if (ME) setTimeout(connectRealtime, Math.min(8000, 1000 * (++wsRetry))); };
      s.onerror = () => { try { s.close(); } catch {} };
    } catch { wsSock = null; }
  }
  function handleRealtime(m) {
    const p = m.payload || {};
    if (m.type === 'thread:new') {
      toast('<b>新帖子</b> · ' + esc(p.title || ''));
      if ((location.hash || '').startsWith('#/home')) setTimeout(() => { try { viewHome(); } catch {} }, 700);
    } else if (m.type === 'reply:new') {
      toast('<b>新回复</b> · ' + esc(p.author || '') + ' 回复了帖子');
    } else if (m.type === 'like:new') {
      if (p.threadId && (location.hash || '') === '#/thread/' + p.threadId) {
        const lc = document.getElementById('likeCount'); if (lc) lc.textContent = p.likes;
      }
    } else if (m.type === 'follow:new') {
      toast('<b>' + esc(p.follower || '') + '</b> ' + (p.is_following ? '关注了你' : '取消了关注'));
    } else if (m.type === 'dm:new') {
      // dm:new 经节点定向投递，只有收件人本机收到，必然是发给自己的
      toast('💬 <b>' + esc(p.fromUsername || '有人') + '</b>：' + esc(p.body || ''));
      updateUnreadBadge();
      // 若正在看与对方的对话，自动刷新
      if ((location.hash || '').startsWith('#/messages/')) {
        const cur = decodeURIComponent((location.hash.split('/')[2] || ''));
        if (cur === p.fromUsername) setTimeout(() => { try { viewConversation(p.fromUsername); } catch {} }, 500);
      }
    } else if (m.type === 'reaction:new') {
      const p = m.payload || {};
      if (p.targetType && p.targetId) updateReactionBar(p.targetType, p.targetId, p.summary || {});
    }
  }

  /* 拉取并刷新导航栏私信未读角标（轻量请求，不触发全局加载条） */
  async function updateUnreadBadge() {
    const b = document.getElementById('dmBadge');
    if (!b) return;
    if (!ME) { b.hidden = true; return; }
    try {
      const res = await fetch('/api/messages/unread', { credentials: 'same-origin' });
      if (!res.ok) return;
      const r = await res.json();
      const n = (r.unread | 0);
      if (n > 0) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = false; }
      else b.hidden = true;
    } catch {}
  }

  /* ===== 私信（WebSocket 实时推送，REST 拉取历史） ===== */
  function convRow(c) {
    const lastTxt = c.last ? (c.last.from === ME.id ? '你：' : '') + c.last.body : '（暂无消息）';
    return '<div class="conv-row" data-user="' + esc(c.peer_username) + '">'
      + avatarHTML({ username: c.peer_username, avatar: c.peer_avatar })
      + '<div class="conv-main"><div class="conv-top"><span class="conv-name">' + esc(c.peer_username) + '</span>'
      + (c.last ? '<span class="conv-time">' + esc(timeAgo(c.last.created_at)) + '</span>' : '') + '</div>'
      + '<div class="conv-bottom"><span class="conv-last">' + esc(htmlToText(lastTxt).slice(0, 60)) + '</span>'
      + (c.unread ? '<span class="conv-unread">' + c.unread + '</span>' : '') + '</div></div></div>';
  }
  async function viewMessages() {
    if (!ME) { openAuth(); return; }
    content.innerHTML =
      '<div class="appbar"><h1>私信</h1><span class="spacer"></span></div>'
      + '<div class="content-inner"><div class="feed" id="convList"></div></div>';
    const list = document.getElementById('convList');
    try {
      const r = await api('/api/messages');
      if (!r.conversations.length) list.innerHTML = '<div class="empty">还没有私信，去用户主页点「发私信」开始聊天吧</div>';
      else {
        list.innerHTML = r.conversations.map(convRow).join('');
        list.querySelectorAll('.conv-row').forEach((el) => {
          el.onclick = () => (location.hash = '#/messages/' + encodeURIComponent(el.dataset.user));
        });
      }
      updateUnreadBadge();
    } catch (e) { list.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; }
  }
  function dmRow(m) {
    const mine = m.from === (ME && ME.id);
    const body = esc(m.body).replace(/\n/g, '<br>');
    return '<div class="dm-row' + (mine ? ' mine' : '') + '"><div class="dm-bubble">' + body
      + '</div><div class="dm-time">' + esc(timeAgo(m.created_at)) + '</div></div>';
  }
  async function viewConversation(username) {
    if (!ME) { openAuth(); return; }
    try {
      const r = await api('/api/messages/' + encodeURIComponent(username));
      const u = r.peer;
      content.innerHTML =
        '<div class="appbar"><button class="btn" id="backBtn">' + WI('chevronLeft', 18) + ' 私信</button>'
        + '<h1 style="font-size:15px;">' + esc(u.username) + '</h1><span class="spacer"></span></div>'
        + '<div class="content-inner">'
        + '<div class="dm-thread" id="dmThread">' + (r.messages.map(dmRow).join('') || '<div class="empty">还没有消息，发一条打个招呼吧</div>') + '</div>'
        + '<div class="dm-box"><input id="dmInput" placeholder="发私信给 ' + esc(u.username) + '…" maxlength="2000" autocomplete="off" />'
        + '<button class="btn primary" id="dmSend">' + WI('send', 16) + ' 发送</button></div>'
        + '<div class="err" id="dmErr"></div></div>';
      const thread = document.getElementById('dmThread');
      thread.scrollTop = thread.scrollHeight;
      document.getElementById('backBtn').onclick = () => (location.hash = '#/messages');
      const send = async () => {
        const inp = document.getElementById('dmInput');
        const txt = inp.value.trim();
        if (!txt) return;
        try {
          await api('/api/messages', { method: 'POST', body: JSON.stringify({ to: username, text: txt }) });
          inp.value = '';
          viewConversation(username);
        } catch (e) { document.getElementById('dmErr').textContent = e.message; }
      };
      document.getElementById('dmSend').onclick = send;
      const inp = document.getElementById('dmInput');
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
      inp.focus();
      updateUnreadBadge();
    } catch (e) { content.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; }
  }

  /* ===== 路由 ===== */
  const routes = { '#/home': viewHome, '#/discover': viewDiscover, '#/compose': viewCompose, '#/profile': viewProfile, '#/settings': viewSettings, '#/messages': viewMessages };
  async function router() {
    let hash = location.hash || '#/home';
    setActive(hash.split('/').slice(0, 2).join('/'));
    beginLoad();
    try {
      if (hash.startsWith('#/thread/')) return viewThread(hash.split('/')[2]);
      if (hash.startsWith('#/messages/')) return viewConversation(decodeURIComponent(hash.split('/')[2]));
      if (hash.startsWith('#/user/')) return viewUser(hash.split('/')[2]);
      if (hash.startsWith('#/verify/')) return viewVerify(hash.split('/')[2]);
      if (hash.startsWith('#/search')) return viewSearch();
      if (hash.startsWith('#/plugin/')) {
        const parts = hash.split('/');
        return viewPlugin(parts[2] || '', parts.slice(3).join('/'));
      }
      const fn = routes[hash] || viewHome;
      try { await fn(); } catch (e) { content.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; }
    } finally {
      endLoad();
    }
  }

  // 邮箱验证结果页
  async function viewVerify(token) {
    let okv = false, msg = '';
    try {
      const r = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) });
      okv = r.ok; msg = '邮箱验证成功，现在可以登录了。';
    } catch (e) { msg = e.message || '验证失败'; }
    content.innerHTML =
      '<div class="content-inner" style="padding-top:40px;text-align:center;">'
      + '<div style="font-size:40px;margin-bottom:10px;">' + (okv ? WI('check', 40) : WI('more', 40)) + '</div>'
      + '<h2 style="margin:0 0 8px;">' + (okv ? '验证成功' : '验证失败') + '</h2>'
      + '<p class="muted">' + esc(msg) + '</p>'
      + '<div style="margin-top:18px;"><button class="btn primary" id="goLogin">去登录</button></div>'
      + '</div>';
    document.getElementById('goLogin').onclick = () => { location.hash = '#/home'; openAuth(); };
  }
  window.addEventListener('hashchange', router);

  /* ===== 插件页面分发 ===== */
  async function viewPlugin(id, sub) {
    const p = (window.WB && window.WB.plugins) ? window.WB.plugins[id] : null;
    if (!p) {
      content.innerHTML = '<div class="empty">未安装或已禁用的插件：' + esc(id) + '</div>';
      return;
    }
    content.innerHTML = '<div class="content-inner" id="plugin-root"></div>';
    try {
      const root = document.getElementById('plugin-root');
      await p.render(root, { sub: sub, api: api, WI: WI, esc: esc, SETTINGS: SETTINGS, ME: ME });
    } catch (e) {
      content.innerHTML = '<div class="empty">插件加载失败：' + esc(e.message) + '</div>';
    }
  }

  /* ===== 全局搜索：常驻搜索框 + 快捷键（/ 或 Ctrl/Cmd+K）===== */
  function isEditableEl(el) {
    if (!el) return false;
    const t = (el.tagName || '').toLowerCase();
    return t === 'input' || t === 'textarea' || t === 'select' || el.isContentEditable;
  }
  function focusSearch() {
    const inp = document.getElementById('searchInput');
    if (inp) { inp.focus(); inp.select(); }
  }
  function doSearchFromBar() {
    const inp = document.getElementById('searchInput');
    const v = (inp && inp.value || '').trim();
    if (v) location.hash = '#/search?q=' + encodeURIComponent(v);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !isEditableEl(document.activeElement)) { e.preventDefault(); focusSearch(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); focusSearch(); }
  });
  const gsForm = document.getElementById('globalSearch');
  if (gsForm) gsForm.addEventListener('submit', (e) => { e.preventDefault(); doSearchFromBar(); });
  const gsInput = document.getElementById('searchInput');
  if (gsInput) gsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearchFromBar(); } });

  /* ===== 启动 ===== */
  (async function init() {
    buildRail();
    try { SETTINGS = await api('/api/settings'); } catch (e) {}
    applyTheme();
    try { BOARDS = (await api('/api/boards')).boards; } catch (e) {}
    try { const d = await api('/api/me'); ME = d.user; } catch (e) { ME = null; }
    if (ME) { connectRealtime(); updateUnreadBadge(); }
    router();
  })();
})();
