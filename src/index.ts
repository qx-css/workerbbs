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
function setCookie(c: any, name: string, value: string, maxAge?: number) {
  let s = name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax';
  if (maxAge !== undefined) s += '; Max-Age=' + maxAge;
  c.header('Set-Cookie', s);
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
  });
});

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
  const sid = await db.createSession(c.env.DB, id, db.SESSION_TTL);
  const u = await db.getUserById(c.env.DB, id);
  setCookie(c, SID, sid, db.SESSION_TTL);
  return ok({ user: db.toPublicUser(u!) }, 201);
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
  const okPwd = await verifyPassword(password, u.pass_hash);
  if (!okPwd) return fail('账号或密码错误', 401);
  const sid = await db.createSession(c.env.DB, u.id, db.SESSION_TTL);
  setCookie(c, SID, sid, db.SESSION_TTL);
  return ok({ user: db.toPublicUser(u) });
});

// 登出
app.post('/api/auth/logout', async (c) => {
  const sid = getCookie(c, SID);
  await db.deleteSession(c.env.DB, sid);
  setCookie(c, SID, '', 0);
  return ok({ ok: true });
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
  const author = await db.getUserById(c.env.DB, t.user_id);
  const replies = await db.listReplies(c.env.DB, id);
  const replyUsers = await Promise.all(
    replies.map(async (r) => {
      const u = await db.getUserById(c.env.DB, r.user_id);
      return { ...r, author: u ? { username: u.username, avatar: u.avatar, level: db.levelFromExp(u.exp) } : null };
    })
  );
  const b = (await c.env.DB.prepare('SELECT name FROM boards WHERE id = ?').bind(t.board_id).first<{ name: string }>());
  return ok({
    thread: publicThread(t, {
      author: author ? { username: author.username, avatar: author.avatar, level: db.levelFromExp(author.exp), bio: author.bio } : null,
      board_name: b ? b.name : '',
    }),
    replies: replyUsers,
  });
});

// 发帖
app.post('/api/threads', async (c) => {
  const u = user(c);
  if (!u) return fail('请先登录', 401);
  if (u.banned) return fail('账号已被封禁', 403);
  const b = await readJson(c);
  const boardId = Number(b.board_id);
  const title = String(b.title || '').trim();
  const body = String(b.body || '').trim();
  if (!boardId) return fail('请选择板块');
  if (title.length < 2) return fail('标题至少 2 个字符');
  if (body.length < 1) return fail('正文不能为空');
  const board = await c.env.DB.prepare('SELECT id FROM boards WHERE id = ?').bind(boardId).first();
  if (!board) return fail('板块不存在');
  const id = await db.createThread(c.env.DB, { boardId, userId: u.id, title, body });
  await db.addExp(c.env.DB, u.id, 10); // 发帖 +10 经验
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
  return ok({
    user: db.toPublicUser(u),
    threads: mine.map((t) => publicThread(t, { board_name: '' })),
  });
});

// 修改个人资料 / 头像 / 背景
app.patch('/api/me', async (c) => {
  const u = user(c);
  if (!u) return fail('请先登录', 401);
  const b = await readJson(c);
  const fields: Record<string, unknown> = {};
  if (typeof b.bio === 'string') fields.bio = b.bio.slice(0, 500);
  if (typeof b.avatar === 'string') fields.avatar = b.avatar;
  if (typeof b.bg_image === 'string') fields.bg_image = b.bg_image;
  if (Object.keys(fields).length) await db.updateUser(c.env.DB, u.id, fields);
  const updated = await db.getUserById(c.env.DB, u.id);
  return ok({ user: db.toPublicUser(updated!) });
});

// 上传文件到 R2（头像 / 背景图），返回 key
app.post('/api/upload', async (c) => {
  const u = user(c);
  if (!u) return fail('请先登录', 401);
  const form = await c.req.parseBody({ all: true });
  const file = form['file'];
  const folder = String(form['folder'] || 'misc');
  if (!(file instanceof File)) return fail('未收到文件');
  const buf = new Uint8Array(await file.arrayBuffer());
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  const key = `${folder}/${u.id}-${crypto.randomUUID()}.${ext}`;
  await c.env.BUCKET.put(key, buf, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  return ok({ key, url: `/api/file/${key}` });
});

// 从 R2 读取文件（头像 / 背景）
app.get('/api/file/:key', async (c) => {
  const key = c.req.param('key');
  if (!key || key.includes('..') || key.startsWith('/')) return fail('非法路径', 400);
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return fail('文件不存在', 404);
  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

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

// 修改站点设置
app.post('/api/admin/settings', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  if (typeof b.site_name === 'string') await db.setSetting(c.env.DB, 'site_name', b.site_name);
  if (typeof b.site_accent === 'string') await db.setSetting(c.env.DB, 'site_accent', b.site_accent);
  if (typeof b.site_bg === 'string') await db.setSetting(c.env.DB, 'site_bg', b.site_bg);
  if (typeof b.site_desc === 'string') await db.setSetting(c.env.DB, 'site_desc', b.site_desc);
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
 *  SPA 静态资源（非 /api 请求回退到 index.html）
 * ============================================================ */
app.all('*', async (c) => {
  const path = c.req.path;
  if (path.startsWith('/api/')) return fail('接口不存在', 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;

