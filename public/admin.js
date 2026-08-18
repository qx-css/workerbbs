/* 管理后台（/admin）——独立横屏页面，只有 role=admin 能用。
   服务端在 GET /admin 已经做过一次拦截，这里再做一次前端兜底。 */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

  let SETTINGS = { site_name: 'WorkerBBS', site_accent: '#0f6cbd', site_bg: '', site_desc: '', site_logo: '' };
  let PENDING_BG = '';
  let PENDING_LOGO = '';

  /* ===== 主题（与前台共用 localStorage.theme） ===== */
  function applyTheme() {
    const t = localStorage.getItem('theme') || 'light';
    document.documentElement.dataset.theme = t;
    document.getElementById('themeToggle').checked = t === 'dark';
    document.documentElement.style.setProperty('--accent', SETTINGS.site_accent || '#0f6cbd');
  }

  /* ===== 面板切换 ===== */
  const TITLES = { overview: '概览', site: '站点设置', users: '用户管理', threads: '帖子管理', mail: '邮件设置', realtime: '实时同步' };
  function showPanel(name) {
    document.querySelectorAll('.snav').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('show', p.id === 'p-' + name));
    document.getElementById('panelTitle').textContent = TITLES[name] || '概览';
    location.hash = name;
  }

  /* ===== 概览 ===== */
  async function renderStats() {
    const s = await api('/api/admin/stats');
    const map = [['person', '用户', s.users], ['comment', '帖子', s.threads], ['send', '回复', s.replies], ['logout', '已封禁', s.banned]];
    document.getElementById('stats').innerHTML =
      map.map((x) => '<div class="stat"><div class="stat-ico">' + WI(x[0], 22) + '</div><b>' + x[2] + '</b><span>' + x[1] + '</span></div>').join('');
  }

  /* ===== 站点设置 ===== */
  function renderSite() {
    document.getElementById('sName').value = SETTINGS.site_name || '';
    document.getElementById('sDesc').value = SETTINGS.site_desc || '';
    document.getElementById('sAccent').value = SETTINGS.site_accent || '#0f6cbd';
    const prev = document.getElementById('bgPreview');
    const img = PENDING_BG || SETTINGS.site_bg;
    prev.style.backgroundImage = img ? 'url(' + img + ')' : '';
    const lp = document.getElementById('logoPreview');
    const logo = PENDING_LOGO || SETTINGS.site_logo;
    lp.style.backgroundImage = logo ? 'url(' + logo + ')' : '';
    document.getElementById('sw').innerHTML =
      ['#0f6cbd', '#0e700e', '#107c10', '#b8135b', '#c23500', '#8a6d00']
        .map((c) => '<span class="swatch" data-c="' + c + '" style="background:' + c + '"></span>').join('');
    document.querySelectorAll('#sw .swatch').forEach((s) => {
      s.onclick = () => { document.getElementById('sAccent').value = s.dataset.c; document.documentElement.style.setProperty('--accent', s.dataset.c); };
    });
  }

  /* ===== 邮件设置（Resend） ===== */
  function renderMail() {
    document.getElementById('mKey').value = ''; // API 密钥属敏感信息，不回显，需重新输入才能「查看可用域」
    const sel = document.getElementById('mDomain');
    const saved = SETTINGS.resend_domain || '';
    if (saved && !Array.from(sel.options).some((o) => o.value === saved)) {
      const opt = document.createElement('option');
      opt.value = saved; opt.textContent = saved + '（已保存）';
      sel.appendChild(opt);
    }
    sel.value = saved;
    const from = SETTINGS.resend_from || '';
    document.getElementById('mPrefix').value = from.includes('@') ? from.split('@')[0] : '';
    document.getElementById('mVerify').checked = SETTINGS.email_verify_enabled === true || SETTINGS.email_verify_enabled === '1';
    updateFromPreview();
  }
  function updateFromPreview() {
    const d = document.getElementById('mDomain').value || '域名';
    const p = document.getElementById('mPrefix').value.trim() || '前缀';
    document.getElementById('mFromPreview').textContent = p + '@' + d;
  }

  /* ===== 实时同步（WebSocket） ===== */
  function renderRealtime() {
    document.getElementById('rtEndpoint').value = SETTINGS.ws_endpoint || '';
    document.getElementById('rtKey').value = SETTINGS.ws_api_key || '';
  }

  /* ===== 用户管理 ===== */
  async function renderUsers() {
    const data = await api('/api/admin/users');
    document.getElementById('userAdmin').innerHTML =
      '<table class="admin"><thead><tr><th>用户</th><th>等级</th><th>角色</th><th>状态</th><th style="width:230px;">操作</th></tr></thead><tbody>'
      + data.users.map((u) =>
        '<tr><td>' + esc(u.username) + '</td><td>Lv.' + u.level + '</td>'
        + '<td><span class="tag' + (u.role === 'admin' ? ' admin' : '') + '">' + esc(u.role) + '</span></td>'
        + '<td>' + (u.banned ? '<span class="tag banned">已封禁</span>' : '<span class="tag">正常</span>') + '</td>'
        + '<td><button class="btn" data-ban="' + u.id + '">' + (u.banned ? '解封' : '封禁') + '</button> '
        + '<button class="btn" data-role="' + u.id + '">' + (u.role === 'admin' ? '降为会员' : '设为管理员') + '</button></td></tr>'
      ).join('') + '</tbody></table>';
    document.querySelectorAll('[data-ban]').forEach((b) => b.onclick = async () => {
      const u = data.users.find((x) => String(x.id) === b.dataset.ban);
      await api('/api/admin/users/' + b.dataset.ban, { method: 'PATCH', body: JSON.stringify({ banned: u.banned ? 0 : 1 }) });
      renderUsers(); renderStats();
    });
    document.querySelectorAll('[data-role]').forEach((b) => b.onclick = async () => {
      const u = data.users.find((x) => String(x.id) === b.dataset.role);
      await api('/api/admin/users/' + b.dataset.role, { method: 'PATCH', body: JSON.stringify({ role: u.role === 'admin' ? 'user' : 'admin' }) });
      renderUsers();
    });
  }

  /* ===== 帖子管理 ===== */
  async function renderThreads() {
    const data = await api('/api/admin/threads');
    document.getElementById('threadAdmin').innerHTML =
      '<table class="admin"><thead><tr><th>ID</th><th>标题</th><th>板块</th><th>置顶</th><th>状态</th><th style="width:200px;">操作</th></tr></thead><tbody>'
      + (data.threads.length ? data.threads.map((t) =>
        '<tr><td>' + t.id + '</td><td>' + esc(String(t.title).slice(0, 60)) + '</td><td>' + t.board_id + '</td>'
        + '<td>' + (t.pinned ? '是' : '否') + '</td>'
        + '<td>' + (t.deleted ? '<span class="tag banned">已删除</span>' : '<span class="tag">正常</span>') + '</td>'
        + '<td><button class="btn" data-pin="' + t.id + '">' + (t.pinned ? '取消置顶' : '置顶') + '</button> '
        + (t.deleted
          ? '<button class="btn" data-restore="' + t.id + '">恢复</button>'
          : '<button class="btn danger" data-del="' + t.id + '">删除</button>')
        + '</td></tr>').join('')
        : '<tr><td colspan="6" class="muted" style="padding:20px;">还没有帖子</td></tr>')
      + '</tbody></table>';
    document.querySelectorAll('[data-pin]').forEach((b) => b.onclick = async () => {
      const t = data.threads.find((x) => String(x.id) === b.dataset.pin);
      await api('/api/admin/threads/' + b.dataset.pin, { method: 'PATCH', body: JSON.stringify({ pinned: t.pinned ? 0 : 1 }) });
      renderThreads();
    });
    document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('确认删除该帖子？')) return;
      await api('/api/admin/threads/' + b.dataset.del, { method: 'PATCH', body: JSON.stringify({ deleted: 1 }) });
      renderThreads(); renderStats();
    });
    document.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
      await api('/api/admin/threads/' + b.dataset.restore, { method: 'PATCH', body: JSON.stringify({ deleted: 0 }) });
      renderThreads(); renderStats();
    });
  }

  /* ===== 图片选择（压缩成 base64，存 D1） ===== */
  function pickImage(maxDim, quality, cb) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          cb(cv.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => alert('无法解析该图片');
        img.src = reader.result;
      };
      reader.onerror = () => alert('读取文件失败');
      reader.readAsDataURL(f);
    };
    inp.click();
  }

  /* ===== WinUI 图标：侧栏 / 返回 / 旋转提示 ===== */
  function enhanceIcons() {
    const navIcons = { overview: 'home', site: 'settings', users: 'person', threads: 'comment', mail: 'send', realtime: 'share' };
    document.querySelectorAll('.snav').forEach((b) => {
      const ic = navIcons[b.dataset.panel] || 'sparkle';
      const label = b.textContent.trim();
      b.innerHTML = WI(ic, 18) + ' <span>' + esc(label) + '</span>';
    });
    const back = document.querySelector('.foot a.btn');
    if (back) back.innerHTML = WI('chevronLeft', 16) + ' 返回论坛';
    const rot = document.querySelector('#rotate .ico');
    if (rot) rot.innerHTML = WI('rotate', 40);
  }

  /* ===== 启动 ===== */
  (async function init() {
    let me = null;
    try { me = (await api('/api/me')).user; } catch (e) { me = null; }
    if (!me || me.role !== 'admin') { location.replace('/'); return; }
    enhanceIcons();

    try { SETTINGS = await api('/api/settings'); } catch (e) {}
    document.getElementById('brandName').textContent = SETTINGS.site_name || 'WorkerBBS';
    document.getElementById('who').textContent = me.username + ' · 管理员';
    applyTheme();
    renderSite();

    document.querySelectorAll('.snav').forEach((b) => b.onclick = () => showPanel(b.dataset.panel));
    const first = (location.hash || '#overview').slice(1);
    showPanel(TITLES[first] ? first : 'overview');

    document.getElementById('themeToggle').onchange = (e) => {
      const t = e.target.checked ? 'dark' : 'light';
      localStorage.setItem('theme', t);
      document.documentElement.dataset.theme = t;
    };

    document.getElementById('sBg').onclick = () => pickImage(1920, 0.72, (dataUrl) => {
      PENDING_BG = dataUrl;
      document.getElementById('bgPreview').style.backgroundImage = 'url(' + dataUrl + ')';
      document.getElementById('siteMsg').textContent = '已选新背景，点保存后生效';
    });
    document.getElementById('sLogo').onclick = () => pickImage(256, 0.92, (dataUrl) => {
      PENDING_LOGO = dataUrl;
      document.getElementById('logoPreview').style.backgroundImage = 'url(' + dataUrl + ')';
      document.getElementById('siteMsg').textContent = '已选新 LOGO，点保存后生效';
    });

    document.getElementById('saveSite').onclick = async () => {
      const msg = document.getElementById('siteMsg');
      const payload = {
        site_name: document.getElementById('sName').value,
        site_desc: document.getElementById('sDesc').value,
        site_accent: document.getElementById('sAccent').value,
      };
      if (PENDING_BG) payload.site_bg = PENDING_BG;
      if (PENDING_LOGO) payload.site_logo = PENDING_LOGO;
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
        SETTINGS = await api('/api/settings');
        PENDING_BG = ''; PENDING_LOGO = '';
        renderSite(); applyTheme();
        document.getElementById('brandName').textContent = SETTINGS.site_name || 'WorkerBBS';
        msg.textContent = '已保存';
      } catch (e) { msg.textContent = e.message; }
    };

    /* 邮件设置 */
    document.getElementById('mDomain').onchange = updateFromPreview;
    document.getElementById('mPrefix').oninput = updateFromPreview;
    document.getElementById('mListDomains').onclick = async () => {
      const key = document.getElementById('mKey').value.trim();
      const msg = document.getElementById('mDomainMsg');
      if (!key) { msg.textContent = '请先填写 API 密钥'; return; }
      msg.textContent = '请求中…';
      try {
        const r = await api('/api/admin/resend-domains', { method: 'POST', body: JSON.stringify({ api_key: key }) });
        const sel = document.getElementById('mDomain');
        sel.innerHTML = '<option value="">— 请选择域名 —</option>'
          + r.domains.map((d) => '<option value="' + esc(d.name) + '">' + esc(d.name) + '（' + esc(d.status) + '）</option>').join('');
        msg.textContent = '已列出 ' + r.domains.length + ' 个域名';
      } catch (e) { msg.textContent = e.message; }
    };
    document.getElementById('saveMail').onclick = async () => {
      const msg = document.getElementById('mailMsg');
      const domain = document.getElementById('mDomain').value;
      const prefix = document.getElementById('mPrefix').value.trim();
      if (!domain || !prefix) { msg.textContent = '请先选择域名并填写前缀'; return; }
      const payload = {
        resend_domain: domain,
        resend_from: prefix + '@' + domain,
        email_verify_enabled: document.getElementById('mVerify').checked,
      };
      const key = document.getElementById('mKey').value.trim();
      if (key) payload.resend_api_key = key; // 仅非空才更新，避免清空已保存的密钥
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
        SETTINGS = await api('/api/settings');
        renderMail();
        msg.textContent = '已保存';
      } catch (e) { msg.textContent = e.message; }
    };

    /* 实时同步 */
    document.getElementById('saveRealtime').onclick = async () => {
      const msg = document.getElementById('rtMsg');
      const payload = {
        ws_endpoint: document.getElementById('rtEndpoint').value.trim(),
      };
      const key = document.getElementById('rtKey').value.trim();
      if (key) payload.ws_api_key = key; // 仅非空才更新，避免清空已保存的密钥
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
        SETTINGS = await api('/api/settings');
        renderRealtime();
        msg.textContent = '已保存';
      } catch (e) { msg.textContent = e.message; }
    };

    await Promise.all([renderStats(), renderUsers(), renderThreads(), Promise.resolve(renderMail()), Promise.resolve(renderRealtime())]);
  })();
})();
