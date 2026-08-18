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
  const TITLES = { overview: '概览', site: '站点设置', users: '用户管理', threads: '帖子管理', tags: '标签', invite: '邀请码', broadcast: '群发邮件', groups: '群组', mail: '邮件设置', realtime: '实时同步', theme: '主题', plugins: '插件' };
  function showPanel(name) {
    document.querySelectorAll('.snav').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('show', p.id === 'p-' + name));
    document.getElementById('panelTitle').textContent = TITLES[name] || '概览';
    location.hash = name;
  }

  /* ===== 概览 ===== */
  async function renderStats() {
    const s = await api('/api/admin/stats');
    const map = [
      ['person', '用户', s.users],
      ['comment', '帖子', s.threads],
      ['send', '回复', s.replies],
      ['logout', '已封禁', s.banned],
      ['navigation', '群组', s.groups],
      ['tag', '标签', s.tags],
      ['key', '邀请码', s.invite_used + '/' + s.invite_total],
      ['chat', '私信', s.messages],
    ];
    document.getElementById('stats').innerHTML =
      map.map((x) => '<div class="stat"><div class="stat-ico">' + WI(x[0], 22) + '</div><b>' + x[2] + '</b><span>' + x[1] + '</span></div>').join('');
    await renderCharts();
  }

  /* ===== 数据全景图表（/api/admin/analytics） ===== */
  async function renderCharts() {
    const el = document.getElementById('charts');
    if (!el) return;
    let data;
    try { data = await api('/api/admin/analytics?days=14'); }
    catch (e) { el.innerHTML = '<div class="chart-card"><p class="muted">图表加载失败：' + esc(e.message) + '</p></div>'; return; }
    const W = 300, H = 120, pad = 8;
    const lineChart = (rows, color, label) => {
      const max = Math.max(1, ...rows.map((r) => r.c));
      const n = rows.length;
      const X = (i) => pad + (W - pad * 2) * (n <= 1 ? 0 : i / (n - 1));
      const Y = (v) => H - pad - (H - pad * 2) * (v / max);
      const pts = rows.map((r, i) => X(i).toFixed(1) + ',' + Y(r.c).toFixed(1)).join(' ');
      return '<div class="chart-card"><h3>' + label + '（近 ' + data.days + ' 天）</h3>'
        + '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
        + '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/>'
        + rows.map((r, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(r.c).toFixed(1) + '" r="2.2" fill="' + color + '"/>').join('')
        + '</svg></div>';
    };
    const series = [
      { key: 'users', label: '新增用户', color: '#0f6cbd' },
      { key: 'threads', label: '新增帖子', color: '#107c10' },
      { key: 'replies', label: '新增回复', color: '#c23900' },
    ];
    let html = series.map((s) => lineChart(data[s.key] || [], s.color, s.label)).join('');
    const boards = data.by_board || [];
    const bmax = Math.max(1, ...boards.map((b) => b.c));
    html += '<div class="chart-card" style="grid-column:1/-1;"><h3>各板块帖子分布</h3>'
      + (boards.length ? boards.map((b) =>
          '<div style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px;">'
          + '<span style="width:90px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(b.name) + '</span>'
          + '<span style="flex:1;height:10px;background:var(--surface-2);border-radius:999px;overflow:hidden;"><span style="display:block;height:100%;width:' + Math.round(b.c / bmax * 100) + '%;background:var(--accent);"></span></span>'
          + '<b style="width:34px;text-align:right;">' + b.c + '</b></div>'
        ).join('') : '<p class="muted">暂无数据</p>')
      + '</div>';
    el.innerHTML = html;
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
  }

  /* ===== 主题 ===== */
  function renderTheme() {
    document.getElementById('themeName').textContent = SETTINGS.theme_name || '默认';
  }

  /* ===== 插件管理 ===== */
  async function renderPlugins() {
    let data;
    try {
      data = await api('/api/admin/plugins');
    } catch (e) {
      document.getElementById('pluginRows').innerHTML = '<tr><td colspan="5" class="muted">加载失败：' + esc(e.message) + '</td></tr>';
      return;
    }
    const rows = data.plugins || [];
    const tbody = document.getElementById('pluginRows');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="muted">暂无插件</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((p) =>
      '<tr>'
      + '<td><b>' + esc(p.name) + '</b><br><span class="muted">' + esc(p.id) + '</span></td>'
      + '<td class="muted">' + esc(p.description || '') + '</td>'
      + '<td>' + esc(p.version || '-') + '</td>'
      + '<td>' + (p.enabled ? '<span class="tag admin">已启用</span>' : '<span class="tag">已禁用</span>') + '</td>'
      + '<td><label class="switch"><input type="checkbox" data-plugin="' + esc(p.id) + '"' + (p.enabled ? ' checked' : '') + '><span class="slider"></span></label></td>'
      + '</tr>'
    ).join('');
    tbody.querySelectorAll('[data-plugin]').forEach((sw) => {
      sw.onchange = async () => {
        const msg = document.getElementById('pluginMsg');
        try {
          await api('/api/admin/plugins', { method: 'POST', body: JSON.stringify({ id: sw.dataset.plugin, enabled: sw.checked }) });
          msg.textContent = (sw.checked ? '已启用 ' : '已禁用 ') + sw.dataset.plugin;
        } catch (e) { msg.textContent = e.message; sw.checked = !sw.checked; }
      };
    });
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
        + '<td><button class="btn" data-grp="' + u.id + '" data-un="' + esc(u.username) + '">分组</button> '
        + '<button class="btn" data-ban="' + u.id + '">' + (u.banned ? '解封' : '封禁') + '</button> '
        + '<button class="btn" data-role="' + u.id + '">' + (u.role === 'admin' ? '降为会员' : '设为管理员') + '</button></td></tr>'
      ).join('') + '</tbody></table>';
    document.querySelectorAll('[data-grp]').forEach((b) => b.onclick = () => {
      const u = data.users.find((x) => String(x.id) === b.dataset.grp);
      openUserGroupModal(Number(b.dataset.grp), b.dataset.un, u ? (u.groups || []) : []);
    });
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
        + '<td><button class="btn" data-tags="' + t.id + '" data-title="' + esc(String(t.title).slice(0, 40)) + '">标签</button> '
        + '<button class="btn" data-pin="' + t.id + '">' + (t.pinned ? '取消置顶' : '置顶') + '</button> '
        + (t.deleted
          ? '<button class="btn" data-restore="' + t.id + '">恢复</button>'
          : '<button class="btn danger" data-del="' + t.id + '">删除</button>')
        + '</td></tr>').join('')
        : '<tr><td colspan="6" class="muted" style="padding:20px;">还没有帖子</td></tr>')
      + '</tbody></table>';
    document.querySelectorAll('[data-tags]').forEach((b) => b.onclick = () => openThreadTagModal(b.dataset.tags, b.dataset.title));
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

  /* ===== 通用后台弹窗 ===== */
  function openAdminModal(title, bodyHTML, onOk) {
    const root = document.getElementById('adminModal');
    root.innerHTML = '<div class="mask"><div class="box"><h3>' + esc(title) + '</h3>' + bodyHTML
      + '<div class="row" style="margin-top:18px;"><button class="btn" data-x>取消</button><button class="btn primary" data-ok>确定</button></div>'
      + '</div></div>';
    const close = () => { root.innerHTML = ''; };
    root.querySelector('[data-x]').onclick = close;
    root.querySelector('.mask').onclick = (e) => { if (e.target === root.querySelector('.mask')) close(); };
    root.querySelector('[data-ok]').onclick = () => { if (onOk(root) !== false) close(); };
  }

  /* ===== 标签管理 ===== */
  async function renderTags() {
    const el = document.getElementById('tagList');
    let tags;
    try { tags = (await api('/api/tags')).tags || []; }
    catch (e) { el.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>'; return; }
    if (!tags.length) { el.innerHTML = '<p class="muted">还没有标签，先在上方添加。</p>'; return; }
    el.innerHTML = tags.map((t) =>
      '<div class="tagitem"><span class="dotc" style="background:' + esc(t.color) + '"></span>'
      + '<span class="nm">' + esc(t.name) + '</span><span class="meta"># ' + t.id + '</span><span class="sp"></span>'
      + '<button class="btn" data-tedit="' + t.id + '" data-name="' + esc(t.name) + '" data-color="' + esc(t.color) + '">编辑</button>'
      + '<button class="btn danger" data-tdel="' + t.id + '">删除</button></div>'
    ).join('');
    el.querySelectorAll('[data-tedit]').forEach((b) => b.onclick = () => {
      const id = b.dataset.tedit;
      openAdminModal('编辑标签',
        '<div class="row" style="gap:8px;margin-bottom:14px;">'
        + '<input id="mTagName" value="' + esc(b.dataset.name) + '" style="flex:1;font:inherit;font-size:13px;padding:8px 11px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);">'
        + '<input id="mTagColor" type="color" value="' + esc(b.dataset.color) + '" style="width:42px;height:34px;border:1px solid var(--border);border-radius:6px;background:var(--surface);"></div>',
        () => {
          const nn = document.getElementById('mTagName').value.trim();
          const nc = document.getElementById('mTagColor').value;
          if (!nn) { alert('标签名不能为空'); return false; }
          api('/api/admin/tags/' + id, { method: 'PATCH', body: JSON.stringify({ name: nn, color: nc }) })
            .then(() => renderTags()).catch((e) => alert(e.message));
        });
    });
    el.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = async () => {
      if (!confirm('删除该标签？相关帖子关联会一并解除。')) return;
      try { await api('/api/admin/tags/' + b.dataset.tdel, { method: 'DELETE' }); renderTags(); renderStats(); }
      catch (e) { alert(e.message); }
    });
  }

  /* ===== 邀请码 ===== */
  async function renderInvite() {
    const el = document.getElementById('invList');
    try {
      const st = await api('/api/settings');
      document.getElementById('inviteToggle').checked = st.invite_required === true || st.invite_required === '1';
    } catch (e) {}
    let codes;
    try { codes = (await api('/api/admin/invite')).codes || []; }
    catch (e) { el.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>'; return; }
    if (!codes.length) { el.innerHTML = '<p class="muted">还没有生成邀请码。</p>'; return; }
    el.innerHTML = codes.map((c) => {
      const expired = c.expires_at && c.expires_at < Date.now();
      const full = c.uses >= c.max_uses;
      const cls = (full || expired) ? 'no' : 'ok';
      const status = full ? '已用完' : expired ? '已过期' : '可用';
      const extra = (c.note ? ' · ' + esc(c.note) : '')
        + ' · ' + c.uses + '/' + c.max_uses
        + (c.expires_at ? ' · 至 ' + new Date(c.expires_at).toLocaleDateString() : ' · 永久');
      return '<div class="inv-row"><span class="inv-code">' + esc(c.code) + '</span> '
        + '<span class="inv-status ' + cls + '">' + status + '</span>'
        + '<div class="muted" style="margin-top:2px;">' + extra + '</div></div>';
    }).join('');
  }

  /* ===== 群发邮件 ===== */
  async function renderBroadcast() {
    let groups = [];
    try { groups = (await api('/api/admin/groups')).groups || []; }
    catch (e) { groups = []; }
    document.getElementById('bcGroup').innerHTML = groups.map((g) => '<option value="' + g.id + '">' + esc(g.name) + '</option>').join('');
  }

  /* ===== 群组（权限分组） ===== */
  async function renderGroups() {
    const el = document.getElementById('grpList');
    let groups;
    try { groups = (await api('/api/admin/groups')).groups || []; }
    catch (e) { el.innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>'; return; }
    if (!groups.length) { el.innerHTML = '<p class="muted">还没有群组，先在上方添加。</p>'; return; }
    el.innerHTML = groups.map((g) =>
      '<div class="grpitm"><span class="dotc" style="background:' + esc(g.color) + '"></span>'
      + '<span class="nm">' + esc(g.name) + '</span><span class="meta">' + esc(g.description || '') + '</span><span class="sp"></span>'
      + '<button class="btn" data-gedit="' + g.id + '" data-name="' + esc(g.name) + '" data-color="' + esc(g.color) + '" data-desc="' + esc(g.description || '') + '">编辑</button>'
      + '<button class="btn danger" data-gdel="' + g.id + '">删除</button></div>'
    ).join('');
    el.querySelectorAll('[data-gedit]').forEach((b) => b.onclick = () => {
      const id = b.dataset.gedit;
      openAdminModal('编辑群组',
        '<div class="field"><label>组名</label><input id="mGrpName" value="' + esc(b.dataset.name) + '" style="width:100%;font:inherit;font-size:13px;padding:8px 11px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);"></div>'
        + '<div class="field"><label>简介</label><input id="mGrpDesc" value="' + esc(b.dataset.desc) + '" style="width:100%;font:inherit;font-size:13px;padding:8px 11px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);"></div>'
        + '<div class="field"><label>颜色</label><input id="mGrpColor" type="color" value="' + esc(b.dataset.color) + '" style="width:42px;height:34px;border:1px solid var(--border);border-radius:6px;background:var(--surface);"></div>',
        () => {
          const nn = document.getElementById('mGrpName').value.trim();
          const nd = document.getElementById('mGrpDesc').value.trim();
          const nc = document.getElementById('mGrpColor').value;
          if (!nn) { alert('组名不能为空'); return false; }
          api('/api/admin/groups/' + id, { method: 'PATCH', body: JSON.stringify({ name: nn, description: nd, color: nc }) })
            .then(() => { renderGroups(); renderUsers(); }).catch((e) => alert(e.message));
        });
    });
    el.querySelectorAll('[data-gdel]').forEach((b) => b.onclick = async () => {
      if (!confirm('删除该群组？成员关联会一并解除。')) return;
      try { await api('/api/admin/groups/' + b.dataset.gdel, { method: 'DELETE' }); renderGroups(); renderStats(); renderUsers(); }
      catch (e) { alert(e.message); }
    });
  }

  /* ===== 帖子标签分配弹窗 ===== */
  async function openThreadTagModal(threadId, title) {
    let all;
    try { all = (await api('/api/tags')).tags || []; }
    catch (e) { alert(e.message); return; }
    if (!all.length) { alert('请先在「标签」面板创建标签'); return; }
    let cur = [];
    try { const d = await api('/api/threads/' + threadId); cur = (d.thread.tags || []).map((t) => t.id); }
    catch (e) {}
    const chips = all.map((t) =>
      '<span class="pick' + (cur.indexOf(t.id) >= 0 ? ' on' : '') + '" data-id="' + t.id + '">'
      + '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + esc(t.color) + ';margin-right:6px;"></span>' + esc(t.name) + '</span>'
    ).join('');
    openAdminModal('设置标签：' + (title || ('#' + threadId)), '<div class="chips">' + chips + '</div>', (root) => {
      const ids = Array.from(root.querySelectorAll('.pick.on')).map((p) => Number(p.dataset.id));
      api('/api/admin/threads/' + threadId + '/tags', { method: 'POST', body: JSON.stringify({ tag_ids: ids }) })
        .then(() => {}).catch((e) => alert(e.message));
    });
    document.getElementById('adminModal').querySelectorAll('.pick').forEach((p) => p.onclick = () => p.classList.toggle('on'));
  }

  /* ===== 用户群组分配弹窗 ===== */
  async function openUserGroupModal(userId, uname, current) {
    let all;
    try { all = (await api('/api/admin/groups')).groups || []; }
    catch (e) { alert(e.message); return; }
    if (!all.length) { alert('请先在「群组」面板创建群组'); return; }
    const curIds = (current || []).map((g) => g.id);
    const chips = all.map((g) =>
      '<span class="pick' + (curIds.indexOf(g.id) >= 0 ? ' on' : '') + '" data-id="' + g.id + '">'
      + '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + esc(g.color) + ';margin-right:6px;"></span>' + esc(g.name) + '</span>'
    ).join('');
    openAdminModal('设置群组：' + (uname || ('#' + userId)), '<div class="chips">' + chips + '</div>', (root) => {
      const ids = Array.from(root.querySelectorAll('.pick.on')).map((p) => Number(p.dataset.id));
      api('/api/admin/users/' + userId, { method: 'PATCH', body: JSON.stringify({ group_ids: ids }) })
        .then(() => renderUsers()).catch((e) => alert(e.message));
    });
    document.getElementById('adminModal').querySelectorAll('.pick').forEach((p) => p.onclick = () => p.classList.toggle('on'));
  }

  /* ===== WinUI 图标：侧栏 / 返回 / 旋转提示 ===== */
  function enhanceIcons() {
    const navIcons = { overview: 'home', site: 'settings', users: 'person', threads: 'comment', tags: 'tag', invite: 'key', broadcast: 'send', groups: 'navigation', mail: 'send', realtime: 'share' };
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
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
        SETTINGS = await api('/api/settings');
        renderRealtime();
        msg.textContent = '已保存';
      } catch (e) { msg.textContent = e.message; }
    };

    /* 测试 WebSocket 节点：后端广播测试 + 浏览器 WS 握手测试 */
    function showTestResult(text) {
      const el = document.getElementById('rtResult');
      el.textContent = text;
      el.style.display = 'block';
    }
    document.getElementById('testRealtime').onclick = async () => {
      const btn = document.getElementById('testRealtime');
      const msg = document.getElementById('rtMsg');
      const endpoint = document.getElementById('rtEndpoint').value.trim();
      if (!endpoint) { msg.textContent = '请先填写 WebSocket 端点'; return; }
      btn.disabled = true; btn.textContent = '测试中…'; msg.textContent = '';
      let out = '';
      // 1) 后端广播链路测试（验证端点可达）
      let backendOk = false;
      try {
        const r = await api('/api/admin/ws-test', { method: 'POST', body: JSON.stringify({ endpoint }) });
        backendOk = true;
        out += '✅ 后端广播：' + (r.message || '广播链路正常') + '\n';
      } catch (e) {
        out += '❌ 后端广播：' + e.message + '\n';
      }
      // 2) 浏览器 WebSocket 握手测试（验证客户端能连上 /ws）
      if ('WebSocket' in window) {
        const wsUrl = endpoint.replace(/\/$/, '') + '/ws';
        await new Promise((resolve) => {
          let done = false;
          const sock = new WebSocket(wsUrl);
          const to = setTimeout(() => {
            if (done) return; done = true;
            try { sock.close(); } catch {}
            out += '❌ 浏览器握手：连接超时（' + wsUrl + '）\n';
            resolve();
          }, 3500);
          sock.onopen = () => {
            if (done) return; done = true; clearTimeout(to);
            try { sock.close(); } catch {}
            out += '✅ 浏览器握手：WebSocket 连接成功（' + wsUrl + '）\n';
            resolve();
          };
          sock.onerror = () => {
            if (done) return; done = true; clearTimeout(to);
            out += '❌ 浏览器握手：连接失败（' + wsUrl + '），请确认节点已部署且支持 /ws\n';
            resolve();
          };
        });
      }
      btn.disabled = false; btn.textContent = '测试连接';
      msg.textContent = backendOk ? '连接正常' : '连接异常';
      showTestResult(out.trim());
    };

    /* 主题：上传 zip 安装 / 卸载恢复默认 */
    document.getElementById('installTheme').onclick = async () => {
      const msg = document.getElementById('themeMsg');
      const fileInput = document.getElementById('themeFile');
      const f = fileInput.files && fileInput.files[0];
      if (!f) { msg.textContent = '请先选择 .zip 主题包'; return; }
      if (!/\.zip$/i.test(f.name) && f.type !== 'application/zip') { msg.textContent = '请上传 .zip 文件'; return; }
      const fd = new FormData();
      fd.append('file', f);
      msg.textContent = '安装中…';
      try {
        const r = await fetch('/api/admin/theme', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '安装失败');
        SETTINGS = await api('/api/settings');
        renderTheme();
        msg.textContent = '已安装：' + (data.name || '');
        fileInput.value = '';
      } catch (e) { msg.textContent = e.message; }
    };
    document.getElementById('removeTheme').onclick = async () => {
      const msg = document.getElementById('themeMsg');
      try {
        await api('/api/admin/theme/remove', { method: 'POST' });
        SETTINGS = await api('/api/settings');
        renderTheme();
        msg.textContent = '已卸载，恢复默认外观';
      } catch (e) { msg.textContent = e.message; }
    };

    /* 标签：添加 */
    document.getElementById('tagAdd').onclick = async () => {
      const name = document.getElementById('tagName').value.trim();
      const color = document.getElementById('tagColor').value;
      if (!name) { alert('标签名不能为空'); return; }
      try {
        await api('/api/admin/tags', { method: 'POST', body: JSON.stringify({ name, color }) });
        document.getElementById('tagName').value = '';
        renderTags(); renderStats();
      } catch (e) { alert(e.message); }
    };

    /* 邀请码：开关 + 生成 + 列表 */
    document.getElementById('inviteToggle').onchange = async (e) => {
      const msg = document.getElementById('invMsg');
      try {
        await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ invite_required: e.target.checked }) });
        msg.textContent = e.target.checked ? '已开启邀请码注册' : '已关闭邀请码注册';
      } catch (err) { msg.textContent = err.message; e.target.checked = !e.target.checked; }
    };
    document.getElementById('invGen').onclick = async () => {
      const msg = document.getElementById('invMsg');
      const count = Math.max(1, Math.min(50, Number(document.getElementById('invCount').value) || 1));
      const maxUses = Math.max(1, Math.min(100, Number(document.getElementById('invMax').value) || 1));
      const exp = Math.max(0, Number(document.getElementById('invExp').value) || 0);
      const note = document.getElementById('invNote').value.trim();
      msg.textContent = '生成中…';
      try {
        const r = await api('/api/admin/invite/generate', { method: 'POST', body: JSON.stringify({ count, max_uses: maxUses, expires_in_days: exp, note }) });
        const box = document.getElementById('invCodes');
        box.style.display = 'block';
        box.textContent = r.codes.join('\n');
        renderInvite(); renderStats();
        msg.textContent = '已生成 ' + r.codes.length + ' 个邀请码';
      } catch (e) { msg.textContent = e.message; }
    };

    /* 群发邮件：范围切换 + 发送 */
    document.getElementById('bcScope').onchange = (e) => {
      document.getElementById('bcGroupWrap').style.display = e.target.value === 'group' ? 'block' : 'none';
    };
    document.getElementById('bcSend').onclick = async () => {
      const msg = document.getElementById('bcMsg');
      const subject = document.getElementById('bcSubject').value.trim();
      const body = document.getElementById('bcBody').value.trim();
      if (!subject || !body) { msg.textContent = '请填写主题和正文'; return; }
      const scope = document.getElementById('bcScope').value;
      const payload = { subject, body, scope };
      if (scope === 'group') {
        const gid = document.getElementById('bcGroup').value;
        if (!gid) { msg.textContent = '请选择群组'; return; }
        payload.group_id = Number(gid);
      }
      msg.textContent = '发送中…';
      try {
        const r = await api('/api/admin/broadcast-email', { method: 'POST', body: JSON.stringify(payload) });
        msg.textContent = '已加入队列，共 ' + (r.total || 0) + ' 位收件人（异步发送）';
      } catch (e) { msg.textContent = e.message; }
    };

    /* 群组：添加 */
    document.getElementById('grpAdd').onclick = async () => {
      const name = document.getElementById('grpName').value.trim();
      const color = document.getElementById('grpColor').value;
      if (!name) { alert('组名不能为空'); return; }
      try {
        await api('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name, description: '', color }) });
        document.getElementById('grpName').value = '';
        renderGroups(); renderStats();
      } catch (e) { alert(e.message); }
    };

    await Promise.all([renderStats(), renderUsers(), renderThreads(), Promise.resolve(renderTags()), Promise.resolve(renderInvite()), Promise.resolve(renderBroadcast()), Promise.resolve(renderGroups()), Promise.resolve(renderMail()), Promise.resolve(renderRealtime()), Promise.resolve(renderTheme()), Promise.resolve(renderPlugins())]);
  })();
})();
