import { Hono } from 'hono';
import type { Bindings, User } from './types';
import * as db from './db';
import { hashPassword, verifyPassword } from './auth';
import { unzipSync, strFromU8 } from 'fflate';
import { registerPlugins, runHook, captureEnv, syncPluginsToDb, flushPluginCache } from './plugins';
import { broadcastWS } from './realtime';

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
  captureEnv(c.env);
  const sid = getCookie(c, SID);
  const user = await db.getUserBySession(c.env.DB, sid);
  c.set('user', user);
  await next();
});

/* ---------- 插件系统：注册所有内置插件（挂载路由 + 订阅钩子） ---------- */
registerPlugins(app);

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
    theme_css: s.theme_css || '',
    theme_name: s.theme_name || '',
    invite_required: s.invite_required === '1',
    ws_note: s.ws_note || '',
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

// 实时同步的 broadcastWS 已抽到 ./realtime 模块（供主流程与插件框架共用，避免循环依赖）。
// 调用形如 broadcastWS(c.env, type, payload) 或带定向投递 broadcastWS(c.env, type, payload, toUserId)。

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

  // 邀请码注册：开启后必须提供有效邀请码
  const inviteRequired = await db.isInviteRequired(c.env.DB);
  let inviteCodeUsed: string | null = null;
  if (inviteRequired) {
    const code = String(b.invite_code || '').trim();
    if (!code) return fail('当前站点开启邀请码注册，请填写邀请码');
    const v = await db.validateInviteCode(c.env.DB, code);
    if (!v.ok) return fail(v.reason || '邀请码无效');
    inviteCodeUsed = code;
  }

  const passHash = await hashPassword(password);
  const id = await db.createUser(c.env.DB, { username, email, passHash });
  if (inviteCodeUsed) await db.useInviteCode(c.env.DB, inviteCodeUsed, id);
  await runHook('user:registered', c, { userId: id, username, email });

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

// 全局搜索：帖子（标题/正文）+ 用户（用户名/简介）
app.get('/api/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 1) return ok({ threads: [], users: [] });
  const threads = await db.listThreads(c.env.DB, { q, pageSize: 15 });
  const authorMap = await db.getUsersByIds(c.env.DB, threads.map((t) => t.user_id));
  const replyMap = await db.getReplyCountsByThreads(c.env.DB, threads.map((t) => t.id));
  const boardMap = await db.getBoardNamesByIds(c.env.DB, threads.map((t) => t.board_id));
  const threadsRes = threads.map((t) => {
    const a = authorMap[t.user_id];
    return publicThread(t, {
      author: a ? { username: a.username, avatar: a.avatar, level: db.levelFromExp(a.exp) } : null,
      reply_count: replyMap[t.id] || 0,
      board_name: boardMap[t.board_id] || '',
    });
  });
  const users = (await db.searchUsers(c.env.DB, q, 8)).map((u) => db.toPublicUser(u));
  return ok({ threads: threadsRes, users });
});

// 帖子列表（支持 board / 搜索 / 标签筛选 / 分页）
// 性能：一次性批量取作者 / 回复数 / 板块名 / 标签 / 群组 / 引用 / 表情，避免逐帖 N+1 往返 D1。
app.get('/api/threads', async (c) => {
  const boardId = c.req.query('board') ? Number(c.req.query('board')) : undefined;
  const q = c.req.query('q') || undefined;
  const tag = c.req.query('tag') ? Number(c.req.query('tag')) : undefined;
  const page = c.req.query('page') ? Number(c.req.query('page')) : 1;
  let threads;
  if (tag) threads = await db.listThreadsByTag(c.env.DB, tag, page);
  else threads = await db.listThreads(c.env.DB, { boardId, q, page });
  const ids = threads.map((t) => t.id);
  const me = user(c);
  const authorMap = await db.getUsersByIds(c.env.DB, threads.map((t) => t.user_id));
  const replyMap = await db.getReplyCountsByThreads(c.env.DB, ids);
  const boardMap = await db.getBoardNamesByIds(c.env.DB, threads.map((t) => t.board_id));
  const tagMap = await db.getTagsByThreadIds(c.env.DB, ids);
  const groupMap = await db.getGroupsByUserIds(c.env.DB, threads.map((t) => t.user_id));
  const quoteMap = await db.getQuotedThreads(c.env.DB, threads.map((t) => t.quote_thread_id));
  const reactMap = await db.getReactionSummaries(c.env.DB, 'thread', ids, me ? me.id : null);
  const withMeta = threads.map((t) => {
    const a = authorMap[t.user_id];
    return publicThread(t, {
      author: a ? { username: a.username, avatar: a.avatar, level: db.levelFromExp(a.exp), groups: groupMap[a.id] || [] } : null,
      reply_count: replyMap[t.id] || 0,
      board_name: boardMap[t.board_id] || '',
      tags: tagMap[t.id] || [],
      quote_thread: t.quote_thread_id ? (quoteMap[t.quote_thread_id] || null) : null,
      reactions: reactMap[t.id] || {},
    });
  });
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
  const replyAuthorMap = await db.getUsersByIds(c.env.DB, replies.map((r) => r.user_id));
  const b = (await c.env.DB.prepare('SELECT name FROM boards WHERE id = ?').bind(t.board_id).first<{ name: string }>());
  const liked = me ? await db.isLiked(c.env.DB, me.id, 'thread', t.id) : false;
  const likes = await db.countLikes(c.env.DB, 'thread', t.id);
  const threadTags = await db.getTagsByThreadIds(c.env.DB, [t.id]);
  const threadGroups = await db.getGroupsByUserIds(c.env.DB, [t.user_id]);
  const threadQuote = t.quote_thread_id ? (await db.getQuotedThreads(c.env.DB, [t.quote_thread_id]))[t.quote_thread_id] || null : null;
  const threadReactions = (await db.getReactionSummaries(c.env.DB, 'thread', [t.id], me ? me.id : null))[t.id] || {};
  const replyGroups = await db.getGroupsByUserIds(c.env.DB, replies.map((r) => r.user_id));
  const replyQuotes = await db.getQuotedReplies(c.env.DB, replies.map((r) => r.quote_reply_id));
  const replyReactions = await db.getReactionSummaries(c.env.DB, 'reply', replies.map((r) => r.id), me ? me.id : null);
  const replyUsers = replies.map((r) => {
    const u = replyAuthorMap[r.user_id];
    return {
      ...r,
      author: u ? { username: u.username, avatar: u.avatar, level: db.levelFromExp(u.exp), groups: (replyGroups[u.id] || []) } : null,
      quote_reply: r.quote_reply_id ? (replyQuotes[r.quote_reply_id] || null) : null,
      reactions: replyReactions[r.id] || {},
    };
  });
  return ok({
    thread: publicThread(t, {
      author: author ? { username: author.username, avatar: author.avatar, level: db.levelFromExp(author.exp), bio: author.bio, groups: threadGroups[t.user_id] || [] } : null,
      board_name: b ? b.name : '',
      likes,
      liked,
      tags: threadTags[t.id] || [],
      quote_thread: threadQuote,
      reactions: threadReactions,
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
  await broadcastWS(c.env, 'like:new', { threadId: id, likes, liked: !now });
  await runHook('thread:liked', c, { threadId: id, liked: !now, byUserId: me.id, userId: t.user_id });
  return ok({ liked: !now, likes });
});

// QQ 式表情回应：服务端固定允许列表，与前端选择器保持一致
const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉', '💯', '🤔', '😡', '🥳'];

// 表情回应（QQ 式）：对帖子 / 回复切换某个 emoji，返回该目标最新的表情聚合
app.post('/api/reactions', async (c) => {
  const me = user(c);
  if (!me) return fail('请先登录', 401);
  const b = await readJson(c);
  const targetType = b.target_type === 'reply' ? 'reply' : 'thread';
  const targetId = Number(b.target_id);
  const emoji = String(b.emoji || '').trim();
  if (!targetId) return fail('缺少目标');
  if (!ALLOWED_EMOJIS.includes(emoji)) return fail('表情不在允许列表');
  const { reacted } = await db.toggleReaction(c.env.DB, me.id, targetType, targetId, emoji);
  const summary = (await db.getReactionSummaries(c.env.DB, targetType, [targetId], me.id))[targetId] || {};
  await broadcastWS(c.env, 'reaction:new', { targetType, targetId, summary, userId: me.id, reacted, emoji });
  return ok({ reacted, summary });
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
  const quoteThreadId = Number(b.quote_thread_id) || 0;
  const id = await db.createThread(c.env.DB, { boardId, userId: u.id, title, body, quoteThreadId });
  await db.addExp(c.env.DB, u.id, 10); // 发帖 +10 经验
  await broadcastWS(c.env, 'thread:new', { id, title, boardId, author: u.username });
  await runHook('thread:created', c, { threadId: id, title, boardId, author: u.username, userId: u.id });
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
  const quoteReplyId = Number(b.quote_reply_id) || 0;
  await db.createReply(c.env.DB, { threadId: id, userId: u.id, body, quoteReplyId });
  await db.addExp(c.env.DB, u.id, 5); // 回复 +5 经验
  await broadcastWS(c.env, 'reply:new', { threadId: id, author: u.username });
  await runHook('reply:created', c, { threadId: id, author: u.username, userId: u.id });
  return ok({ ok: true }, 201);
});

/* ============================================================
 *  用户资料 / 上传
 * ============================================================ */

app.get('/api/users/:username', async (c) => {
  const username = c.req.param('username');
  const u = await db.getUserByUsername(c.env.DB, username);
  if (!u) return fail('用户不存在', 404);
  const threads = await db.listThreadsByUser(c.env.DB, u.id);
  const me = user(c);
  const isFollowing = me ? await db.isFollowing(c.env.DB, me.id, u.id) : false;
  return ok({
    user: {
      ...db.toPublicUser(u),
      followers: await db.countFollowers(c.env.DB, u.id),
      following: await db.countFollowing(c.env.DB, u.id),
      likes: await db.countLikesReceived(c.env.DB, u.id),
      is_following: isFollowing,
      groups: await db.getUserGroups(c.env.DB, u.id),
    },
    threads: threads.map((t) => publicThread(t, { board_name: '' })),
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
  await broadcastWS(c.env, 'follow:new', { follower: me.username, target: target.username, is_following: !now });
  await runHook('user:followed', c, { followerId: me.id, targetId: target.id, is_following: !now });
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
 *  私信（Direct Message）
 * ============================================================ */

// 发私信（实时推送给收件人，经 WebSocket 节点定向投递）
app.post('/api/messages', async (c) => {
  const me = user(c);
  if (!me) return fail('请先登录', 401);
  const b = await readJson(c);
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return fail('私信内容不能为空');
  if (text.length > 2000) return fail('私信内容过长（上限 2000 字）');
  const toRaw = String(b.to || '').trim();
  if (!toRaw) return fail('请指定收件人');
  const to = /^\d+$/.test(toRaw) ? await db.getUserById(c.env.DB, Number(toRaw)) : await db.getUserByUsername(c.env.DB, toRaw);
  if (!to) return fail('收件人不存在', 404);
  if (to.id === me.id) return fail('不能给自己发私信');
  const id = await db.createMessage(c.env.DB, { from: me.id, to: to.id, body: text });
  const msg = await db.getMessage(c.env.DB, id);
  await broadcastWS(c.env, 'dm:new', {
    id, from: me.id, fromUsername: me.username, to: to.id, body: text, created_at: msg.created_at,
  }, to.id);
  return ok({ ok: true, message: { id, from: me.id, to: to.id, body: text, created_at: msg.created_at } }, 201);
});

// 会话列表（每个对方取最后一条 + 未读数）
app.get('/api/messages', async (c) => {
  const me = user(c);
  if (!me) return fail('请先登录', 401);
  const convs = await db.listConversations(c.env.DB, me.id);
  const users = await db.getUsersByIds(c.env.DB, convs.map((x) => x.peer));
  const list = await Promise.all(convs.map(async (x) => {
    const u = users[x.peer] || null;
    const last = await db.getMessage(c.env.DB, x.last_id);
    return {
      peer: x.peer,
      peer_username: u ? u.username : '未知用户',
      peer_avatar: u ? u.avatar : '',
      unread: x.unread,
      last: last ? { id: last.id, body: last.body, from: last.from_user, created_at: last.created_at } : null,
    };
  }));
  return ok({ conversations: list });
});

// 未读总数（导航角标用）
app.get('/api/messages/unread', async (c) => {
  const me = user(c);
  if (!me) return fail('请先登录', 401);
  return ok({ unread: await db.countUnreadMessages(c.env.DB, me.id) });
});

// 与某用户的对话（按用户名，读取即标记已读）
app.get('/api/messages/:peer', async (c) => {
  const me = user(c);
  if (!me) return fail('请先登录', 401);
  const peer = await db.getUserByUsername(c.env.DB, c.req.param('peer'));
  if (!peer) return fail('用户不存在', 404);
  const msgs = await db.getConversation(c.env.DB, me.id, peer.id);
  await db.markConversationRead(c.env.DB, me.id, peer.id);
  return ok({
    peer: db.toPublicUser(peer),
    messages: msgs.map((m) => ({ id: m.id, from: m.from_user, to: m.to_user, body: m.body, created_at: m.created_at })),
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
  const groups = (await c.env.DB.prepare('SELECT COUNT(*) c FROM groups').first<{ c: number }>())?.c ?? 0;
  const tags = (await c.env.DB.prepare('SELECT COUNT(*) c FROM tags').first<{ c: number }>())?.c ?? 0;
  const inviteTotal = (await c.env.DB.prepare('SELECT COUNT(*) c FROM invite_codes').first<{ c: number }>())?.c ?? 0;
  const inviteUsed = (await c.env.DB.prepare('SELECT COUNT(*) c FROM invite_codes WHERE uses > 0').first<{ c: number }>())?.c ?? 0;
  const messages = (await c.env.DB.prepare('SELECT COUNT(*) c FROM messages').first<{ c: number }>())?.c ?? 0;
  return ok({ users, threads, replies, banned, groups, tags, invite_total: inviteTotal, invite_used: inviteUsed, messages });
});

// 数据全景：最近 N 天的新增趋势 + 各板块帖子分布（供后台图表面板）
app.get('/api/admin/analytics', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const days = Math.min(30, Math.max(7, Number(c.req.query('days') || 14)));
  const start = Date.now() - days * 86400000;
  const usersSeries = (await c.env.DB.prepare("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) c FROM users WHERE created_at >= ? GROUP BY d").bind(start).all()).results as unknown as { d: string; c: number }[];
  const threadsSeries = (await c.env.DB.prepare("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) c FROM threads WHERE created_at >= ? GROUP BY d").bind(start).all()).results as unknown as { d: string; c: number }[];
  const repliesSeries = (await c.env.DB.prepare("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) c FROM replies WHERE created_at >= ? GROUP BY d").bind(start).all()).results as unknown as { d: string; c: number }[];
  const byBoard = (await c.env.DB.prepare('SELECT b.name, COUNT(*) c FROM threads t JOIN boards b ON b.id = t.board_id GROUP BY b.id ORDER BY c DESC').all()).results as unknown as { name: string; c: number }[];
  // 补齐缺失日期为 0
  const fmt = (dt: number) => new Date(dt).toISOString().slice(0, 10);
  const fill = (rows: { d: string; c: number }[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.d] = r.c;
    const out: { d: string; c: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = fmt(Date.now() - i * 86400000);
      out.push({ d, c: m[d] || 0 });
    }
    return out;
  };
  return ok({
    days,
    users: fill(usersSeries),
    threads: fill(threadsSeries),
    replies: fill(repliesSeries),
    by_board: byBoard,
    invite_required: (await db.getSetting(c.env.DB, 'invite_required')) === '1',
  });
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
// 后端拿端点真去节点 /broadcast 推一条事件，验证可达性。
app.post('/api/admin/ws-test', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  const endpoint = String(b.endpoint || (await db.getSetting(c.env.DB, 'ws_endpoint')) || '').trim();
  if (!endpoint) return fail('请先填写 WebSocket 端点');
  const url = endpoint.replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '') + '/broadcast';
  const ctrl: any = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 5000) : null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ping', payload: { ts: Date.now(), source: 'workerbbs-test' } }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    if (!r.ok) return fail('节点返回 HTTP ' + r.status + '，请确认节点已部署', r.status);
    return ok({ ok: true, message: '广播链路正常：后端可连接节点' });
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
  if (typeof b.invite_required === 'boolean') await db.setSetting(c.env.DB, 'invite_required', b.invite_required ? '1' : '0');
  return ok({ ok: true });
});

// 上传并安装主题（zip 包：内含 theme.css，可选 info.json）
app.post('/api/admin/theme', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  let form: any;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return fail('无法解析上传内容，请确认选择了 .zip 文件');
  }
  const file: any = form['file'];
  if (!file || typeof file.arrayBuffer !== 'function') {
    return fail('请上传 .zip 主题包');
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf);
  } catch {
    return fail('解压失败：不是合法的 zip 文件');
  }
  const names = Object.keys(files);
  // 优先根目录 theme.css，其次任意位置的 theme.css，最后任意 .css
  const cssName =
    names.find((n) => /(^|\/)theme\.css$/i.test(n)) ||
    names.find((n) => /\.css$/i.test(n));
  if (!cssName) return fail('主题包缺少 CSS 文件（需含 theme.css）');
  const css = strFromU8(files[cssName]);
  if (css.length > 600_000) return fail('theme.css 过大（建议 < 600KB）', 413);

  let info: any = {};
  const infoName = names.find((n) => /(^|\/)info\.json$/i.test(n));
  if (infoName) {
    try { info = JSON.parse(strFromU8(files[infoName])); } catch { /* 解析失败则用默认 */ }
  }
  const name = (typeof info.name === 'string' && info.name.trim()) || '未命名主题';
  const author = (typeof info.author === 'string' && info.author.trim()) || '';
  const version = (typeof info.version === 'string' && info.version.trim()) || '';

  await db.setSetting(c.env.DB, 'theme_css', css);
  await db.setSetting(c.env.DB, 'theme_name', name);
  return ok({ ok: true, name, author, version, size: css.length });
});

// 卸载主题（恢复默认外观）
app.post('/api/admin/theme/remove', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  await db.setSetting(c.env.DB, 'theme_css', '');
  await db.setSetting(c.env.DB, 'theme_name', '');
  return ok({ ok: true });
});

/* ============================================================
 *  插件管理
 * ============================================================ */

// 列出所有内置插件及其启用状态
app.get('/api/admin/plugins', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  await syncPluginsToDb(c.env);
  const rows = await db.listPlugins(c.env.DB);
  return ok({ plugins: rows });
});

// 启用 / 禁用插件
app.post('/api/admin/plugins', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  const id = String(b.id || '').trim();
  if (!id) return fail('缺少插件 id');
  const enabled = b.enabled ? 1 : 0;
  await db.ensurePlugin(c.env.DB, id, id);
  await db.setPluginEnabled(c.env.DB, id, enabled);
  flushPluginCache(id); // 立即刷新缓存，开关即时生效
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

// 给帖子设置标签（全量替换）
app.post('/api/admin/threads/:id/tags', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const id = Number(c.req.param('id'));
  const b = await readJson(c);
  const tagIds = Array.isArray(b.tag_ids) ? b.tag_ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
  await db.setThreadTags(c.env.DB, id, tagIds);
  return ok({ ok: true });
});

/* ============================================================
 *  标签（管理员编辑；列表公开，增改删仅管理员）
 * ============================================================ */

app.get('/api/tags', async (c) => {
  return ok({ tags: await db.listTags(c.env.DB) });
});

app.post('/api/admin/tags', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  const name = String(b.name || '').trim();
  const color = String(b.color || '#0f6cbd').trim();
  if (name.length < 1) return fail('标签名不能为空');
  if (name.length > 20) return fail('标签名过长');
  try {
    const id = await db.createTag(c.env.DB, name, color);
    return ok({ id }, 201);
  } catch {
    return fail('标签名已存在', 409);
  }
});

app.patch('/api/admin/tags/:id', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const id = Number(c.req.param('id'));
  const b = await readJson(c);
  const name = String(b.name || '').trim();
  const color = String(b.color || '#0f6cbd').trim();
  if (name.length < 1) return fail('标签名不能为空');
  try {
    await db.updateTag(c.env.DB, id, name, color);
    return ok({ ok: true });
  } catch {
    return fail('标签名已存在', 409);
  }
});

app.delete('/api/admin/tags/:id', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  await db.deleteTag(c.env.DB, Number(c.req.param('id')));
  return ok({ ok: true });
});

/* ============================================================
 *  邀请码
 * ============================================================ */

function genInviteCode(): string {
  const ab = new Uint8Array(6);
  crypto.getRandomValues(ab);
  const s = Array.from(ab).map((b) => b.toString(36)).join('').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8).padEnd(8, '0');
  return 'WB-' + s;
}

// 生成邀请码（可批量）。返回生成的列表。
app.post('/api/admin/invite/generate', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const me = user(c)!;
  const b = await readJson(c);
  const count = Math.min(50, Math.max(1, Number(b.count) || 1));
  const maxUses = Math.min(100, Math.max(1, Number(b.max_uses) || 1));
  const note = String(b.note || '').slice(0, 100);
  const expiresInDays = b.expires_in_days ? Number(b.expires_in_days) : 0;
  const expiresAt = expiresInDays > 0 ? Date.now() + expiresInDays * 86400000 : null;
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = genInviteCode();
    await db.createInviteCode(c.env.DB, { code, createdBy: me.id, note, maxUses, expiresAt });
    codes.push(code);
  }
  return ok({ codes }, 201);
});

app.get('/api/admin/invite', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  return ok({ codes: await db.listInviteCodes(c.env.DB) });
});

/* ============================================================
 *  管理员群发邮件（复用 Resend）
 * ============================================================ */

app.post('/api/admin/broadcast-email', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  const subject = String(b.subject || '').trim();
  const htmlBody = String(b.body || '').trim();
  if (!subject) return fail('请填写邮件主题');
  if (!htmlBody) return fail('请填写邮件内容');
  const key = await db.getSetting(c.env.DB, 'resend_api_key');
  const from = await db.getSetting(c.env.DB, 'resend_from');
  if (!key || !from) return fail('尚未配置 Resend 发信（请在「邮件设置」中填写 API 密钥与发件域名）', 400);

  // 收件人范围：all = 全部用户；否则按群组 groupId 筛选
  let recipients: { email: string }[] = [];
  if (b.scope === 'group' && b.group_id) {
    const memberIds = await db.getGroupMemberIds(c.env.DB, Number(b.group_id));
    if (memberIds.length) {
      const us = await db.getUsersByIds(c.env.DB, memberIds);
      recipients = memberIds.map((id) => us[id]).filter((u) => u && u.email).map((u) => ({ email: u.email }));
    }
  } else {
    recipients = ((await c.env.DB.prepare('SELECT email FROM users').all()).results as unknown as { email: string }[]);
  }
  const list = recipients.filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
  if (!list.length) return fail('没有可用的收件人');

  const total = list.length;
  // 用 waitUntil 异步发送，避免阻塞请求（Cloudflare 会在响应后继续跑完）
  const sendAll = async () => {
    let sent = 0, failed = 0;
    for (const r of list) {
      try {
        const okSend = await resendSend(c, r.email, subject, htmlBody);
        if (okSend) sent++; else failed++;
      } catch { failed++; }
    }
    // 结果仅记录到服务端日志（无前端回传需求）
    console.log('[broadcast-email] 完成：成功 ' + sent + ' / 失败 ' + failed + ' / 共 ' + total);
  };
  if (typeof c.executionCtx !== 'undefined' && c.executionCtx && typeof c.executionCtx.waitUntil === 'function') {
    c.executionCtx.waitUntil(sendAll());
  } else {
    // 兜底：同步发（小站点可用）
    await sendAll();
  }
  return ok({ ok: true, queued: true, total });
});

/* ============================================================
 *  群组（权限分组）
 * ============================================================ */

app.get('/api/admin/groups', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  return ok({ groups: await db.listGroups(c.env.DB) });
});

app.post('/api/admin/groups', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const b = await readJson(c);
  const name = String(b.name || '').trim();
  const description = String(b.description || '').slice(0, 200);
  const color = String(b.color || '#0f6cbd').trim();
  if (name.length < 1) return fail('组名不能为空');
  if (name.length > 20) return fail('组名过长');
  try {
    const id = await db.createGroup(c.env.DB, name, description, color);
    return ok({ id }, 201);
  } catch {
    return fail('组名已存在', 409);
  }
});

app.patch('/api/admin/groups/:id', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const id = Number(c.req.param('id'));
  const b = await readJson(c);
  const name = String(b.name || '').trim();
  const description = String(b.description || '').slice(0, 200);
  const color = String(b.color || '#0f6cbd').trim();
  if (name.length < 1) return fail('组名不能为空');
  try {
    await db.updateGroup(c.env.DB, id, name, description, color);
    return ok({ ok: true });
  } catch {
    return fail('组名已存在', 409);
  }
});

app.delete('/api/admin/groups/:id', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  await db.deleteGroup(c.env.DB, Number(c.req.param('id')));
  return ok({ ok: true });
});

// 用户管理：支持批量设置所属群组
app.patch('/api/admin/users/:id', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const id = Number(c.req.param('id'));
  const b = await readJson(c);
  const fields: Record<string, unknown> = {};
  if (typeof b.banned === 'number') fields.banned = b.banned ? 1 : 0;
  if (b.role === 'user' || b.role === 'admin') fields.role = b.role;
  await db.updateUser(c.env.DB, id, fields);
  if (Array.isArray(b.group_ids)) {
    await db.setUserGroups(c.env.DB, id, b.group_ids.map((x: any) => Number(x)).filter((n: number) => n > 0));
  }
  return ok({ ok: true });
});

// 用户列表（附带群组）
app.get('/api/admin/users', async (c) => {
  const e = requireAdmin(c);
  if (e) return e;
  const users = await db.listUsers(c.env.DB);
  const groupMap = await db.getGroupsByUserIds(c.env.DB, users.map((u) => u.id));
  return ok({ users: users.map((u) => ({ ...db.toPublicUser(u), groups: groupMap[u.id] || [] })) });
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

