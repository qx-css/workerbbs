import { Hono } from 'hono';
import type { Bindings, User } from './types';
import * as db from './db';
import { hashPassword, verifyPassword } from './auth';

type AppEnv = { Bindings: Bindings; Variables: { user: User | null } };
const app = new Hono<AppEnv>();

const SID = 'sid';

/* ---------- Cookie 读写（不依赖额外中间件） ---------- */
function getCookie(c: any, name: string): string | undefined {
  const h = c.req.header('Cookie') || '';
  const m = h.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : undefined;
}
// 生成 Set-Cookie 头字符串。
// 重要：必须手动挂到最终返回的 Response 上——本项目的 ok()/fail() 直接 new Response(...)
// 返回，不会携带 c.header() 设置的头，否则登录/注册响应里就没有 Set-Cookie，导致前端收不到会话。
function cookieHeader(name: string, value: string, maxAge?: number): string {
  let s = name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax';
  if (maxAge !== undefined) s += '; Max-Age=' + maxAge;
  return s;
}

/* ---------- 中间件：加载当前登录用户 ---------- */
app.use('*', async (c, next) => {
  const sid = getCookie(c, SID);
  const user = await db.getUserBySession(c.env.DB, sid);
  c.set('user', user);
  await next();
});

/* ---------- 小工具 ---------- */
function user(c: any): User | null {
  return c.get('user') ?? null;
}
function isAdmin(c: any): boolean {
  const u = user(c);
  return !!u && u.role === 'admin';
}
function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
function fail(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
async function readJson(c: any): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}
function publicThread(t: any, extra: any = {}) {
  return { ...t, ...extra };
}
// 纵深防御：发帖正文允许携带 HTML（富文本），但先粗暴剥离脚本/事件属性等危险内容。
// 真正的安全保障在前端渲染时（sanitizeHTML 白名单），这里只是降低存储风险。
function stripDanger(s: string): string {
  return s
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form)[\s\S]*?(\/|>)/gi, '')
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

/* ============================================================
 *  公开 / 鉴权接口
 * ============================================================ */

// 站点设置（前台主题用）
app.get('/api/settings', async (c) => {
  const s = await db.getSettings(c.env.DB);
  return ok({
    site_name: s.site_name || c.env.SITE_NAME || 'WorkerBBS',
    site_accent: s.site_accent || '#0f6cbd',
    site_bg: s.site_bg || '',
    site_desc: s.site_desc || '',
    site_logo: s.site_logo || '',
    email_verify_enabled: s.email_verify_enabled === '1',
    ws_endpoint: s.ws_endpoint || '',
    resend_domain: s.resend_domain || '',
    resend_from: s.resend_from || '',
  });
});

/* ---------- Resend 发信 ---------- */
// 通过 resend.com 发送邮件。api key / from 都存于 settings 表（不进代码库）。
async function resendSend(c: any, to: string, subject: string, html: string): Promise<boolean> {
  const key = await db.getSetting(c.env.DB, 'resend_api_key');
  const from = await db.getSetting(c.env.DB, 'resend_from');
  if (!key || !from) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function verifyLink(c: any, token: string): string {
  return new URL(c.req.url).origin + '/#/verify/' + token;
}

async function sendVerificationEmail(c: any, email: string, token: string) {
  const link = verifyLink(c, token);
  const site = (await db.getSettings(c.env.DB)).site_name || 'WorkerBBS';
  const html =
    '<div style="font-family:Segoe UI,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">'
    + '<h2 style="margin:0 0 12px;">验证你的 ' + site + ' 邮箱</h2>'
    + '<p style="color:#444;line-height:1.6;">感谢注册！请点击下面的按钮完成邮箱验证，验证后即可正常登录。</p>'
    + '<p style="margin:20px 0;"><a href="' + link + '" style="background:#0f6cbd;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;display:inline-block;font-weight:600;">验证邮箱</a></p>'
    + '<p style="color:#888;font-size:13px;">如果按钮无法点击，请复制以下链接到浏览器打开：<br>' + link + '</p>'
    + '</div>';
  return resendSend(c, email, '验证你的 ' + site + ' 邮箱', html);
}

/* ---------- 实时同步（WebSocket 中继节点） ---------- */
// 主仓库配置 ws_endpoint（节点地址）与 ws_api_key（用于鉴权广播）。
// 事件经节点的 /broadcast 接口推送给所有在线客户端。未配置则静默跳过。
async function broadcastWS(c: any, type: string, payload: unknown): Promise<void> {
  const endpoint = await db.getSetting(c.env.DB, 'ws_endpoint');
  const key = await db.getSetting(c.env.DB, 'ws_api_key');
  if (!endpoint) return;
  try {
    const url = endpoint.replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '') + '/broadcast';
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    });
  } catch {
    /* 实时同步失败不影响主流程 */
  }
}

// 当前用户
app.get('/api/me', async (c) => {
  const u = user(c);
  if (!u) return fail('未登录', 401);
  return ok({ user: db.toPublicUser(u) });
});

// 注册
app.post('/api/auth/register', async (c) => {
  const b = await readJson(c);
  const username = String(b.username || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (username.length < 2) return fail('用户名至少 2 个字符');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('邮箱格式不正确');
  if (password.length < 6) return fail('密码至少 6 位');

  const existU = await db.getUserByUsername(c.env.DB, username);
  const existE = await db.getUserByEmail(c.env.DB, email);
  if (existU) return fail('用户名已被占用');
  if (existE) return fail('邮箱已被注册');

  const passHash = await hashPassword(password);
  const id = await db.createUser(c.env.DB, { username, email, passHash });

  const verifyEnabled = (await db.getSetting(c.env.DB, 'email_verify_enabled')) === '1';
  const resendReady = !!(await db.getSetting(c.env.DB, 'resend_api_key')) && !!(await db.getSetting(c.env.DB, 'resend_from'));
  if (verifyEnabled && resendReady) {
    // 启用邮箱验证：创建未验证账号，发验证邮件，不自动登录
    const token = crypto.randomUUID();
    await db.updateUser(c.env.DB, id, { verified: 0, verify_token: token });
    await sendVerificationEmail(c, email, token);
    return ok({ needsVerification: true, email }, 201);
  }

  // 未启用验证：直接登录
  await db.updateUser(c.env.DB, id, { verified: 1, verify_token: '' });
  const sid = await db.createSession(c.env.DB, id, db.SESSION_TTL);
  const u = await db.getUserById(c.env.DB, id);
  const res = ok({ user: db.toPublicUser(u!) }, 201);
  res.headers.set('Set-Cookie', cookieHeader(SID, sid, db.SESSION_TTL));
  return res;
});

// 登录
app.post('/api/auth/login', async (c) => {
  const b = await readJson(c);
  const identifier = String(b.identifier || '').trim();
  const password = String(b.password || '');
  const u = identifier.includes('@')
    ? await db.getUserByEmail(c.env.DB, identifier.toLowerCase())
    : await db.getUserByUsername(c.env.DB, identifier);
  if (!u) return fail('账号或密码错误', 401);
  if (u.banned) return fail('该账号已被封禁', 403);
  const verifyEnabled = (await db.getSetting(c.env.DB, 'email_verify_enabled')) === '1';
  if (verifyEnabled && u.verified === 0) return fail('请先验证邮箱后再登录（验证邮件已发送）', 403);
  const okPwd = await verifyPassword(password, u.pass_hash);
  if (!okPwd) return fail('账号或密码错误', 401);
  const sid = await db.createSession(c.env.DB, u.id, db.SESSION_TTL);
  const res = ok({ user: db.toPublicUser(u) });
  res.headers.set('Set-Cookie', cookieHeader(SID, sid, db.SESSION_TTL));
  return res;
});

// 登出
app.post('/api/auth/logout', async (c) => {
  const sid = getCookie(c, SID);
  await db.deleteSession(c.env.DB, sid);
  const res = ok({ ok: true });
  res.headers.set('Set-Cookie', cookieHeader(SID, '', 0));
  return res;
});

// 邮箱验证（SPA 内调用）
app.post('/api/auth/verify', async (c) => {
  const b = await readJson(c);
  const token = String(b.token || '').trim();
  if (!token) return fail('缺少验证令牌');
  const u = await db.getUserByVerifyToken(c.env.DB, token);
  if (!u) return fail('验证链接无效或已过期', 400);
  await db.updateUser(c.env.DB, u.id, { verified: 1, verify_token: '' });
  return ok({ ok: true });
});

// GET 兼容：邮件里直接点击链接（非 SPA 环境）时回跳到前端验证路由
app.get('/api/auth/verify', async (c) => {
  const token = c.req.query('token') || '';
  const html =
    '<!doctype html><meta charset="utf-8"><title>邮箱验证</title>'
    + '<script>location.href="/#/verify/' + encodeURIComponent(token) + '"</script>'
    + '<p style="font-family:system-ui;padding:24px;">正在跳转到验证页面…</p>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
});

/* ============================================================
 *  板块 / 帖子 / 回复
 * ============================================================ */

app.get('/api/boards', async (c) => {
  return ok({ boards: await db.listBoards(c.env.DB) });
});

// 帖子列表（支持 board / 搜索 / 分页）
app.get('/api/threads', async (c) => {
  const boardId = c.req.query('board') ? Number(c.req.query('board')) : undefined;
  const q = c.req.query('q') || undefined;
  const page = c.req.query('page') ? Number(c.req.query('page')) : 1;
  const threads = await db.listThreads(c.env.DB, { boardId, q, page });
  const withMeta = await Promise.all(
    threads.map(async (t) => {
      const author = await db.getUserById(c.env.DB, t.user_id);
      const replies = await db.countReplies(c.env.DB, t.id);
      const b = (await c.env.DB.prepare('SELECT name FROM boards WHERE id = ?').bind(t.board_id).first<{ name: string }>());
      return publicThread(t, {
        author: author ? { username: author.username, avatar: author.avatar, level: db.levelFromExp(author.exp) } : null,
        reply_count: replies,
        board_name: b ? b.name : '',
      });
    })
  );
  return ok({ threads: withMeta });
});

// 帖子详情 + 回复
app.get('/api/threads/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await db.getThread(c.env.DB, id);
  if (!t || t.deleted) return fail('帖子不存在', 404);
  await db.incrViews(c.env.DB, id);
  const me = user(c);
  const author = await db.getUserById(c.env.DB, t.user_id);
  const replies = await db.listReplies(c.env.DB, id);
  const replyUsers = await Promise.all(
    replies.map(async (r) => {
      const u = await db.getUserById(c.env.DB, r.user_id);
      return { ...r, author: u ? { username: u.username, avatar: u.avatar, level: db.levelFromExp(u.exp) } : null };
    })
  );
  const b = (await c.env.DB.prepare('SELECT name FROM boards WHERE id = ?').bind(t.board_id).first<{ name: string }>());
  const liked = me ? await db.isLiked(c.env.DB, me.id, 'thread', t.id) : false;
  const likes = await db.countLikes(c.env.DB, 'thread', t.id);
  return ok({
    thread: publicThread(t, {
      author: author ? { username: author.username, avatar: author.avatar, level: db.levelFromExp(author.exp), bio: author.bio } : null,
      board_name: b ? b.name : '',
      likes,
      liked,
    }),
    replies: replyUsers,
  });
});

// 帖子点赞 / 取消点赞（切换）
app.post('/api/threads/:id/like', async (c) => {
  const me = user(c);
  if (!me) return fail('请先登录', 401);
  const id = Number(c.req.param('id'));
  const t = await db.getThread(c.env.DB, id);
  if (!t || t.deleted) return fail('帖子不存在', 404);
  const now = await db.isLiked(c.env.DB, me.id, 'thread', id);
  if (now) {
    await db.unlike(c.env.DB, me.id, 'thread', id);
  } else {
    await db.like(c.env.DB, me.id, 'thread', id);
    if (t.user_id !== me.id) await db.addExp(c.env.DB, t.user_id, 2); // 收到赞 +2 经验
    await db.addExp(c.env.DB, me.id, 1); // 点赞者 +1 经验
  }
  const likes = await db.countLikes(c.env.DB, 'thread', id);
  await broadcastWS(c, 'like:new', { threadId: id, likes, liked: !now });
  return ok({ liked: !now, likes });
});
app.post('/api/threads', async (c) => {
  const u = user(c);
  if (!u) return fail('请先登录', 401);
  if (u.banned) return fail('账号已被封禁', 403);
  const b = await readJson(c);
  const boardId = Number(b.board_id);
  const title = String(b.title || '').trim();
  const body = stripDanger(String(b.body || '')).trim();
  if (!boardId) return fail('请选择板块');
  if (title.length < 2) return fail('标题至少 2 个字符');
  if (body.length < 1) return fail('正文不能为空');
  if (body.length > 950000) return fail('内容过大（含媒体超过 D1 约 1MB 上限），请压缩视频或缩短正文', 413);
  const board = await c.env.DB.prepare('SELECT id FROM boards WHERE id = ?').bind(boardId).first();
  if (!board) return fail('板块不存在');
  const id = await db.createThread(c.env.DB, { boardId, userId: u.id, title, body });
  await db.addExp(c.env.DB, u.id, 10); // 发帖 +10 经验
  await broadcastWS(c, 'thread:new', { id, title, boardId, author: u.username });
  return ok({ id }, 201);
});

// 删帖（作者或管理员）
app.delete('/api/threads/:id', async (c) => {
  const u = user(c);
  if (!u) return fail('请先登录', 401);
  const id = Number(c.req.param('id'));
  const t = await db.getThread(c.env.DB, id);
  if (!t) return fail('帖子不存在', 404);
  if (t.user_id !== u.id && u.role !== 'admin') return fail('无权操作', 403);
  await db.updateThread(c.env.DB, id, { deleted: 1 });
  return ok({ ok: true });
});

// 回复
app.post('/api/threads/:id/replies', async (c) => {
  const u = user(c);
  if (!u) return fail('请先登录', 401);
  if (u.banned) return fail('账号已被封禁', 403);
  const id = Number(c.req.param('id'));
  const t = await db.getThread(c.env.DB, id);
  if (!t || t.deleted) return fail('帖子不存在', 404);
  const b = await readJson(c);
  const body = String(b.body || '').trim();
  if (body.length < 1) return fail('回复内容不能为空');
  await db.createReply(c.env.DB, { threadId: id, userId: u.id, body });
  await db.addExp(c.env.DB, u.id, 5); // 回复 +5 经验
  await broadcastWS(c, 'reply:new', { threadId: id, author: u.username });
  return ok({ ok: true }, 201);
});

/* ============================================================
 *  用户资料 / 上传
 * ============================================================ */

app.get('/api/users/:username', async (c) => {
  const username = c.req.param('username');
  const u = await db.getUserByUsername(c.env.DB, username);
  if (!u) return fail('用户不存在', 404);
  const threads = await db.listThreads(c.env.DB, {});
  const mine = threads.filter((t) => t.user_id === u.id);
  const me = user(c);
  const isFollowing = me ? await db.isFollowing(c.env.DB, me.id, u.id) : false;
  return ok({
    user: {
      ...db.toPublicUser(u),
      followers: await db.countFollowers(c.env.DB, u.id),
      following: await db.countFollowing(c.env.DB, u.id),
      likes: await db.countLikesReceived(c.env.DB, u.id),
      is_following: isFollowing,
    },
    threads: mine.map((t) => publicThread(t, { board_name: '' })),
  });
});

// 关注 / 取消关注（切换）
app.post('/api/users/:username/follow', async (c) => {
  const me = user(c);
  if (!me) return fail('请先登录', 401);
  const target = await db.getUserByUsername(c.env.DB, c.req.param('username'));
  if (!target) return fail('用户不存在', 404);
  if (target.id === me.id) return fail('不能关注自己', 400);
  const now = await db.isFollowing(c.env.DB, me.id, target.id);
  if (now) await db.unfollow(c.env.DB, me.id, target.id);
  else await db.follow(c.env.DB, me.id, target.id);
  await broadcastWS(c, 'follow:new', { follower: me.username, target: target.username, is_following: !now });
  return ok({ is_following: !now, followers: await db.countFollowers(c.env.DB, target.id) });
});

// 修改个人资料 / 头像 / 背景
app.patch('/api/me', async (c) => {
  const u = user(c);
  if (!u) return fail('请先登录', 401);
  const b = await readJson(c);
  const fields: Record<string, unknown> = {};
  if (typeof b.bio === 'string') fields.bio = b.bio.slice(0, 500);
  if (typeof b.avatar === 'string') {
    if (b.avatar.length > 1_000_000) return fail('头像图片太大，请压缩后再上传', 413);
    fields.avatar = b.avatar;
  }
  if (typeof b.bg_image === 'string') {
    if (b.bg_image.length > 1_000_000) return fail('背景图太大，请压缩后再上传', 413);
    fields.bg_image = b.bg_image;
  }
  if (Object.keys(fields).length) await db.updateUser(c.env.DB, u.id, fields);
  const updated = await db.getUserById(c.env.DB, u.id);
  return ok({ user: db.toPublicUser(updated!) });
});

// 图片（头像 / 背景图）以 base64 data URL 直接存进 D1，不依赖 R2。
// 上传由前端把图片转成 data URL 后通过 PATCH /api/me 或 POST /api/admin/settings 写入，
// toPublicUser 会把该 data URL 原样返回，前端直接作为 <img src> 渲染。

/* ============================================================
 *  后台管理（仅管理员）
 * ============================================================ */

function requireAdmin(c: any) {
  if (!isAdmin(c)) return fail('需要管理员权限', 403);
  return null;
}

app.get('/api/admin/stats', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const users = (await c.env.DB.prepare('SELECT COUNT(*) c FROM users').first<{ c: number }>())?.c ?? 0;
  const threads = (await c.env.DB.prepare('SELECT COUNT(*) c FROM threads WHERE deleted=0').first<{ c: number }>())?.c ?? 0;
  const replies = (await c.env.DB.prepare('SELECT COUNT(*) c FROM replies WHERE deleted=0').first<{ c: number }>())?.c ?? 0;
  const banned = (await c.env.DB.prepare('SELECT COUNT(*) c FROM users WHERE banned=1').first<{ c: number }>())?.c ?? 0;
  return ok({ users, threads, replies, banned });
});

// 列出 Resend 可用域名（后台填了 API 密钥后调用，用于选择发信域名）
app.post('/api/admin/resend-domains', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  const key = String(b.api_key || '').trim();
  if (!key) return fail('请先填写 API 密钥');
  try {
    const r = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: 'Bearer ' + key },
    });
    if (!r.ok) return fail('Resend 返回 ' + r.status + '，请检查密钥', r.status);
    const data = await r.json() as { data?: { name: string; status: string }[] };
    const domains = (data.data || []).map((d) => ({ name: d.name, status: d.status }));
    return ok({ domains });
  } catch (err) {
    return fail('请求 Resend 失败：' + (err as Error).message);
  }
});

// 测试 WebSocket 中继节点是否正常（后台「测试连接」按钮调用）
// 后端拿端点 + 密钥真去节点 /broadcast 推一条事件，验证可达性与密钥一致性。
app.post('/api/admin/ws-test', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  const endpoint = String(b.endpoint || (await db.getSetting(c.env.DB, 'ws_endpoint')) || '').trim();
  const key = String(b.key || (await db.getSetting(c.env.DB, 'ws_api_key')) || '').trim();
  if (!endpoint) return fail('请先填写 WebSocket 端点');
  const url = endpoint.replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '') + '/broadcast';
  const ctrl: any = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ping', payload: { ts: Date.now(), source: 'workerbbs-test' } }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    if (r.status === 401) return fail('API 密钥不匹配（节点返回 401），请确认两端密钥完全一致', 401);
    if (!r.ok) return fail('节点返回 HTTP ' + r.status + '，请确认节点已部署', r.status);
    return ok({ ok: true, message: '广播链路正常：后端可连接节点且密钥正确' });
  } catch (err) {
    if (timer) clearTimeout(timer);
    return fail('无法连接节点：' + (err as Error).message + '，请确认端点可达', 502);
  }
});

// 修改站点设置
app.post('/api/admin/settings', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  if (typeof b.site_name === 'string') await db.setSetting(c.env.DB, 'site_name', b.site_name);
  if (typeof b.site_accent === 'string') await db.setSetting(c.env.DB, 'site_accent', b.site_accent);
  if (typeof b.site_desc === 'string') await db.setSetting(c.env.DB, 'site_desc', b.site_desc);
  if (typeof b.site_bg === 'string') {
    if (b.site_bg.length > 1_000_000) return fail('背景图太大，请压缩后再上传', 413);
    await db.setSetting(c.env.DB, 'site_bg', b.site_bg);
  }
  if (typeof b.site_logo === 'string') {
    if (b.site_logo.length > 1_000_000) return fail('LOGO 图片太大，请压缩后再上传', 413);
    await db.setSetting(c.env.DB, 'site_logo', b.site_logo);
  }
  if (typeof b.resend_api_key === 'string') await db.setSetting(c.env.DB, 'resend_api_key', b.resend_api_key.trim());
  if (typeof b.resend_domain === 'string') await db.setSetting(c.env.DB, 'resend_domain', b.resend_domain.trim());
  if (typeof b.resend_from === 'string') await db.setSetting(c.env.DB, 'resend_from', b.resend_from.trim());
  if (typeof b.email_verify_enabled === 'boolean') await db.setSetting(c.env.DB, 'email_verify_enabled', b.email_verify_enabled ? '1' : '0');
  if (typeof b.ws_endpoint === 'string') await db.setSetting(c.env.DB, 'ws_endpoint', b.ws_endpoint.trim());
  if (typeof b.ws_api_key === 'string') await db.setSetting(c.env.DB, 'ws_api_key', b.ws_api_key.trim());
  return ok({ ok: true });
});

// 用户列表
app.get('/api/admin/users', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const users = await db.listUsers(c.env.DB);
  return ok({ users: users.map(db.toPublicUser) });
});

// 封禁 / 解封 / 改角色
app.patch('/api/admin/users/:id', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const id = Number(c.req.param('id'));
  const b = await readJson(c);
  const fields: Record<string, unknown> = {};
  if (typeof b.banned === 'number') fields.banned = b.banned ? 1 : 0;
  if (b.role === 'user' || b.role === 'admin') fields.role = b.role;
  await db.updateUser(c.env.DB, id, fields);
  return ok({ ok: true });
});

// 帖子管理（列表 + 置顶 / 删除）
app.get('/api/admin/threads', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const threads = (await c.env.DB.prepare('SELECT * FROM threads ORDER BY id DESC LIMIT 200').all()).results;
  return ok({ threads });
});

app.patch('/api/admin/threads/:id', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const id = Number(c.req.param('id'));
  const b = await readJson(c);
  const fields: Record<string, unknown> = {};
  if (typeof b.pinned === 'number') fields.pinned = b.pinned ? 1 : 0;
  if (typeof b.deleted === 'number') fields.deleted = b.deleted ? 1 : 0;
  await db.updateThread(c.env.DB, id, fields);
  return ok({ ok: true });
});

/* ============================================================
 *  管理后台页面 /admin（独立横屏页面，仅管理员可访问）
 *  前台的 #/settings 只放个人偏好，不再内嵌任何站点管理。
 * ============================================================ */
async function serveAdminShell(c: any) {
  if (!isAdmin(c)) {
    // 未登录或普通会员：直接跳回首页，不返回后台页面
    return new Response(null, { status: 302, headers: { Location: '/' } });
  }
  const url = new URL(c.req.url);
  url.pathname = '/admin.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), { method: 'GET', headers: c.req.raw.headers }));
}
app.get('/admin', serveAdminShell);
app.get('/admin/', serveAdminShell);
app.get('/admin.html', serveAdminShell); // 直接敲文件名也要过鉴权

/* ============================================================
 *  SPA 静态资源（非 /api 请求回退到 index.html）
 * ============================================================ */
app.all('*', async (c) => {
  const path = c.req.path;
  if (path.startsWith('/api/')) return fail('接口不存在', 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;

