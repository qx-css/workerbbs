import type { D1Database } from '@cloudflare/workers-types';
import type { User, PublicUser, Board, Thread, Reply } from './types';

export const SESSION_TTL = 60 * 60 * 24 * 30; // 30 天（秒）

/** 经验值 → 等级（每 100 经验升一级） */
export function levelFromExp(exp: number): number {
  return Math.floor(exp / 100) + 1;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    level: levelFromExp(u.exp),
    exp: u.exp,
    avatar: u.avatar,
    bio: u.bio,
    bg_image: u.bg_image,
    banned: u.banned,
    created_at: u.created_at,
  };
}

/* ============ 站点设置 ============ */

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = (await db.prepare('SELECT key, value FROM settings').all()) as unknown as {
    results: { key: string; value: string }[];
  };
  const map: Record<string, string> = {};
  for (const r of rows.results) map[r.key] = r.value;
  return map;
}

export async function getSetting(db: D1Database, key: string, fallback = ''): Promise<string> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row ? row.value : fallback;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

/* ============ 板块 ============ */

export async function listBoards(db: D1Database): Promise<Board[]> {
  return (await db.prepare('SELECT * FROM boards ORDER BY sort ASC, id ASC').all()).results as unknown as Board[];
}

/* ============ 用户 ============ */

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
}

export async function getUserByVerifyToken(db: D1Database, token: string): Promise<User | null> {
  if (!token) return null;
  return db.prepare('SELECT * FROM users WHERE verify_token = ?').bind(token).first<User>();
}

export async function createUser(
  db: D1Database,
  data: { username: string; email: string; passHash: string; role?: 'user' | 'admin' }
): Promise<number> {
  const info = await db
    .prepare(
      'INSERT INTO users (username, email, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(data.username, data.email, data.passHash, data.role ?? 'user', Date.now())
    .run();
  return Number(info.meta.last_row_id);
}

export async function updateUser(db: D1Database, id: number, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => fields[k]);
  await db.prepare(`UPDATE users SET ${set} WHERE id = ?`).bind(...vals, id).run();
}

export async function listUsers(db: D1Database): Promise<User[]> {
  return (await db
    .prepare('SELECT * FROM users ORDER BY created_at DESC')
    .all()).results as unknown as User[];
}

export async function addExp(db: D1Database, userId: number, amount: number): Promise<void> {
  await db.prepare('UPDATE users SET exp = exp + ? WHERE id = ?').bind(amount, userId).run();
}

/* ============ 帖子 ============ */

export async function listThreads(
  db: D1Database,
  opts: { boardId?: number; q?: string; page?: number; pageSize?: number } = {}
): Promise<Thread[]> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  let sql = 'SELECT * FROM threads WHERE deleted = 0';
  const binds: unknown[] = [];
  if (opts.boardId) {
    sql += ' AND board_id = ?';
    binds.push(opts.boardId);
  }
  if (opts.q) {
    sql += ' AND (title LIKE ? OR body LIKE ?)';
    const like = `%${opts.q}%`;
    binds.push(like, like);
  }
  sql += ' ORDER BY pinned DESC, id DESC LIMIT ? OFFSET ?';
  binds.push(pageSize, offset);
  return (await db.prepare(sql).bind(...binds).all()).results as unknown as Thread[];
}

/** 某用户发布的帖子（用于个人主页，避免全表扫描后内存过滤） */
export async function listThreadsByUser(db: D1Database, userId: number, limit = 50): Promise<Thread[]> {
  return (await db
    .prepare('SELECT * FROM threads WHERE user_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?')
    .bind(userId, limit)
    .all()).results as unknown as Thread[];
}

/* ============ 批量查询（消除 N+1，降低 D1 往返） ============ */

/** 按 id 批量取用户，返回 id → User 映射 */
export async function getUsersByIds(db: D1Database, ids: number[]): Promise<Record<number, User>> {
  const uniq = Array.from(new Set(ids));
  if (!uniq.length) return {};
  const sql = 'SELECT * FROM users WHERE id IN (' + uniq.map(() => '?').join(',') + ')';
  const rows = (await db.prepare(sql).bind(...uniq).all()).results as unknown as User[];
  const map: Record<number, User> = {};
  for (const r of rows) map[r.id] = r;
  return map;
}

/** 批量统计多个帖子的回复数，返回 threadId → count 映射 */
export async function getReplyCountsByThreads(db: D1Database, threadIds: number[]): Promise<Record<number, number>> {
  const uniq = Array.from(new Set(threadIds));
  if (!uniq.length) return {};
  const sql = 'SELECT thread_id, COUNT(*) c FROM replies WHERE thread_id IN (' + uniq.map(() => '?').join(',') + ') AND deleted = 0 GROUP BY thread_id';
  const rows = (await db.prepare(sql).bind(...uniq).all()).results as unknown as { thread_id: number; c: number }[];
  const map: Record<number, number> = {};
  for (const r of rows) map[r.thread_id] = r.c;
  return map;
}

/** 批量取板块名，返回 boardId → name 映射 */
export async function getBoardNamesByIds(db: D1Database, ids: number[]): Promise<Record<number, string>> {
  const uniq = Array.from(new Set(ids));
  if (!uniq.length) return {};
  const sql = 'SELECT id, name FROM boards WHERE id IN (' + uniq.map(() => '?').join(',') + ')';
  const rows = (await db.prepare(sql).bind(...uniq).all()).results as unknown as { id: number; name: string }[];
  const map: Record<number, string> = {};
  for (const r of rows) map[r.id] = r.name;
  return map;
}

/** 全文搜索用户（用户名 / 简介） */
export async function searchUsers(db: D1Database, q: string, limit = 10): Promise<User[]> {
  const like = `%${q}%`;
  return (await db
    .prepare('SELECT id, username, avatar, bio, exp, role, created_at FROM users WHERE username LIKE ? OR bio LIKE ? ORDER BY id DESC LIMIT ?')
    .bind(like, like, limit)
    .all()).results as unknown as User[];
}

export async function getThread(db: D1Database, id: number): Promise<Thread | null> {
  return db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first<Thread>();
}

export async function createThread(
  db: D1Database,
  data: { boardId: number; userId: number; title: string; body: string; quoteThreadId?: number }
): Promise<number> {
  const info = await db
    .prepare('INSERT INTO threads (board_id, user_id, title, body, quote_thread_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(data.boardId, data.userId, data.title, data.body, data.quoteThreadId || 0, Date.now())
    .run();
  return Number(info.meta.last_row_id);
}

export async function updateThread(db: D1Database, id: number, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  const set = keys.map((k) => `${k} = ?`).join(', ');
  await db.prepare(`UPDATE threads SET ${set} WHERE id = ?`).bind(...keys.map((k) => fields[k]), id).run();
}

export async function incrViews(db: D1Database, id: number): Promise<void> {
  await db.prepare('UPDATE threads SET views = views + 1 WHERE id = ?').bind(id).run();
}

export async function countReplies(db: D1Database, threadId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM replies WHERE thread_id = ? AND deleted = 0')
    .bind(threadId)
    .first<{ c: number }>();
  return row ? row.c : 0;
}

/* ============ 回复 ============ */

export async function listReplies(db: D1Database, threadId: number): Promise<Reply[]> {
  return (await db
    .prepare('SELECT * FROM replies WHERE thread_id = ? AND deleted = 0 ORDER BY id ASC')
    .bind(threadId)
    .all()).results as unknown as Reply[];
}

export async function createReply(
  db: D1Database,
  data: { threadId: number; userId: number; body: string; quoteReplyId?: number }
): Promise<number> {
  const info = await db
    .prepare('INSERT INTO replies (thread_id, user_id, body, quote_reply_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(data.threadId, data.userId, data.body, data.quoteReplyId || 0, Date.now())
    .run();
  return Number(info.meta.last_row_id);
}

/* ============ 会话 ============ */

export async function createSession(db: D1Database, userId: number, ttl: number): Promise<string> {
  const sid = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(sid, userId, now, now + ttl)
    .run();
  return sid;
}

export async function getUserBySession(db: D1Database, sid: string | undefined): Promise<User | null> {
  if (!sid) return null;
  const now = Math.floor(Date.now() / 1000);
  const s = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(sid).first<{ user_id: number; expires_at: number }>();
  if (!s || s.expires_at < now) return null;
  const u = await getUserById(db, s.user_id);
  if (!u || u.banned) return null;
  return u;
}

export async function deleteSession(db: D1Database, sid: string | undefined): Promise<void> {
  if (!sid) return;
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
}

/* ============ 关注 ============ */

export async function follow(db: D1Database, followerId: number, followingId: number): Promise<void> {
  if (followerId === followingId) return;
  await db
    .prepare('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)')
    .bind(followerId, followingId, Date.now())
    .run();
}

export async function unfollow(db: D1Database, followerId: number, followingId: number): Promise<void> {
  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').bind(followerId, followingId).run();
}

export async function isFollowing(db: D1Database, followerId: number, followingId: number): Promise<boolean> {
  const r = await db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').bind(followerId, followingId).first();
  return !!r;
}

export async function countFollowers(db: D1Database, userId: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id = ?').bind(userId).first<{ c: number }>();
  return r ? r.c : 0;
}

export async function countFollowing(db: D1Database, userId: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id = ?').bind(userId).first<{ c: number }>();
  return r ? r.c : 0;
}

/** 该用户收到的全部赞（其帖子 + 其回复被点赞的总和） */
export async function countLikesReceived(db: D1Database, userId: number): Promise<number> {
  const t = (await db
    .prepare('SELECT COUNT(*) c FROM likes l JOIN threads t ON l.target_id = t.id WHERE l.target_type = \'thread\' AND t.user_id = ?')
    .bind(userId)
    .first<{ c: number }>())?.c ?? 0;
  const rp = (await db
    .prepare('SELECT COUNT(*) c FROM likes l JOIN replies r ON l.target_id = r.id WHERE l.target_type = \'reply\' AND r.user_id = ?')
    .bind(userId)
    .first<{ c: number }>())?.c ?? 0;
  return t + rp;
}

/* ============ 点赞 ============ */

export async function like(db: D1Database, userId: number, targetType: 'thread' | 'reply', targetId: number): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, targetType, targetId, Date.now())
    .run();
}

export async function unlike(db: D1Database, userId: number, targetType: 'thread' | 'reply', targetId: number): Promise<void> {
  await db.prepare('DELETE FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?').bind(userId, targetType, targetId).run();
}

export async function isLiked(db: D1Database, userId: number, targetType: 'thread' | 'reply', targetId: number): Promise<boolean> {
  const r = await db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?').bind(userId, targetType, targetId).first();
  return !!r;
}

export async function countLikes(db: D1Database, targetType: 'thread' | 'reply', targetId: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) c FROM likes WHERE target_type = ? AND target_id = ?').bind(targetType, targetId).first<{ c: number }>();
  return r ? r.c : 0;
}

/* ============ 私信 ============ */

/** 会话列表：与当前用户有过私信往来的每个对方，取最后一条消息 id 与未读数 */
export async function listConversations(db: D1Database, userId: number): Promise<{ peer: number; last_id: number; unread: number }[]> {
  const rows = (await db
    .prepare(
      `SELECT
         CASE WHEN from_user = ? THEN to_user ELSE from_user END AS peer,
         MAX(id) AS last_id,
         SUM(CASE WHEN to_user = ? AND "read" = 0 THEN 1 ELSE 0 END) AS unread
       FROM messages WHERE from_user = ? OR to_user = ?
       GROUP BY peer ORDER BY last_id DESC`
    )
    .bind(userId, userId, userId, userId)
    .all()).results as unknown as { peer: number; last_id: number; unread: number }[];
  return rows;
}

export async function getMessage(db: D1Database, id: number): Promise<any> {
  return db.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first();
}

/** 两用户之间的全部私信（按时间正序） */
export async function getConversation(db: D1Database, userId: number, peerId: number): Promise<any[]> {
  return (await db
    .prepare('SELECT * FROM messages WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?) ORDER BY id ASC')
    .bind(userId, peerId, peerId, userId)
    .all()).results as unknown as any[];
}

export async function createMessage(db: D1Database, data: { from: number; to: number; body: string }): Promise<number> {
  const info = await db
    .prepare('INSERT INTO messages (from_user, to_user, body, "read", created_at) VALUES (?, ?, ?, 0, ?)')
    .bind(data.from, data.to, data.body, Date.now())
    .run();
  return Number(info.meta.last_row_id);
}

export async function markConversationRead(db: D1Database, userId: number, peerId: number): Promise<void> {
  await db
    .prepare('UPDATE messages SET "read" = 1 WHERE to_user = ? AND from_user = ? AND "read" = 0')
    .bind(userId, peerId)
    .run();
}

export async function countUnreadMessages(db: D1Database, userId: number): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) c FROM messages WHERE to_user = ? AND "read" = 0').bind(userId).first<{ c: number }>();
  return r ? r.c : 0;
}

/* ============ 插件 ============ */

export interface PluginRow {
  id: string;
  name: string;
  enabled: number;
  config: string;
}

/** 列出所有插件行（含 enabled / config） */
export async function listPlugins(db: D1Database): Promise<PluginRow[]> {
  return (await db.prepare('SELECT * FROM plugins').all()).results as unknown as PluginRow[];
}

/** 若插件行不存在则插入（默认禁用），保证管理端始终能看到所有内置插件 */
export async function ensurePlugin(db: D1Database, id: string, name: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO plugins (id, name, enabled, config) VALUES (?, ?, 0, ?)')
    .bind(id, name, '{}')
    .run();
}

export async function setPluginEnabled(db: D1Database, id: string, enabled: number): Promise<void> {
  await db.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').bind(enabled ? 1 : 0, id).run();
}

/** 读取插件配置项（config 为 JSON 对象） */
export async function getPluginConfig(db: D1Database, plugin: string, key: string, fallback = ''): Promise<string> {
  const row = await db.prepare('SELECT config FROM plugins WHERE id = ?').bind(plugin).first<{ config: string }>();
  if (!row) return fallback;
  try {
    const o = JSON.parse(row.config || '{}');
    return Object.prototype.hasOwnProperty.call(o, key) ? String(o[key]) : fallback;
  } catch {
    return fallback;
  }
}

export async function setPluginConfig(db: D1Database, plugin: string, key: string, value: string): Promise<void> {
  const row = await db.prepare('SELECT config FROM plugins WHERE id = ?').bind(plugin).first<{ config: string }>();
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse((row && row.config) || '{}');
  } catch {
    o = {};
  }
  o[key] = value;
  await db.prepare('UPDATE plugins SET config = ? WHERE id = ?').bind(JSON.stringify(o), plugin).run();
}

/** 插件 KV（命名空间隔离，plugin 前缀避免冲突） */
export async function getPluginKv(db: D1Database, plugin: string, k: string, fallback = ''): Promise<string> {
  const row = await db.prepare('SELECT v FROM plugin_kv WHERE plugin = ? AND k = ?').bind(plugin, k).first<{ v: string }>();
  return row ? row.v : fallback;
}

export async function setPluginKv(db: D1Database, plugin: string, k: string, v: string): Promise<void> {
  await db
    .prepare('INSERT INTO plugin_kv (plugin, k, v) VALUES (?, ?, ?) ON CONFLICT(plugin, k) DO UPDATE SET v = excluded.v')
    .bind(plugin, k, v)
    .run();
}

/* ============ 表情回应（QQ 式） ============ */

export type ReactionSummary = Record<string, { count: number; mine: boolean }>;

/** 切换某用户对某目标的某个表情：已点则取消，未点则添加。返回最终是否已点。 */
export async function toggleReaction(
  db: D1Database, userId: number, targetType: 'thread' | 'reply', targetId: number, emoji: string
): Promise<{ reacted: boolean }> {
  const existing = await db
    .prepare('SELECT 1 FROM reactions WHERE user_id = ? AND target_type = ? AND target_id = ? AND emoji = ?')
    .bind(userId, targetType, targetId, emoji).first();
  if (existing) {
    await db.prepare('DELETE FROM reactions WHERE user_id = ? AND target_type = ? AND target_id = ? AND emoji = ?')
      .bind(userId, targetType, targetId, emoji).run();
    return { reacted: false };
  }
  await db.prepare('INSERT OR IGNORE INTO reactions (user_id, target_type, target_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, targetType, targetId, emoji, Date.now()).run();
  return { reacted: true };
}

/** 批量聚合多个目标的表情回应，返回 targetId -> { emoji: {count, mine} } */
export async function getReactionSummaries(
  db: D1Database, targetType: 'thread' | 'reply', targetIds: number[], meId: number | null
): Promise<Record<number, ReactionSummary>> {
  const map: Record<number, ReactionSummary> = {};
  const uniq = Array.from(new Set(targetIds.filter((i) => i > 0)));
  if (!uniq.length) return map;
  const rows = (await db
    .prepare('SELECT target_id, emoji, COUNT(*) c, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) mine FROM reactions WHERE target_type = ? AND target_id IN (' + uniq.map(() => '?').join(',') + ') GROUP BY target_id, emoji')
    .bind(meId ?? -1, targetType, ...uniq)
    .all()).results as unknown as { target_id: number; emoji: string; c: number; mine: number }[];
  for (const r of rows) {
    if (!map[r.target_id]) map[r.target_id] = {};
    map[r.target_id][r.emoji] = { count: r.c, mine: r.mine > 0 };
  }
  return map;
}

/* ============ 引用快照（用于列表 / 详情内联展示） ============ */

export async function getQuotedThreads(db: D1Database, ids: number[]): Promise<Record<number, { id: number; title: string; author: string }>> {
  const uniq = Array.from(new Set(ids.filter((i) => i > 0)));
  if (!uniq.length) return {};
  const rows = (await db.prepare('SELECT t.id, t.title, u.username FROM threads t LEFT JOIN users u ON u.id = t.user_id WHERE t.id IN (' + uniq.map(() => '?').join(',') + ')').bind(...uniq).all()).results as unknown as { id: number; title: string; username: string }[];
  const map: Record<number, { id: number; title: string; author: string }> = {};
  for (const r of rows) map[r.id] = { id: r.id, title: r.title, author: r.username || '未知' };
  return map;
}

export async function getQuotedReplies(db: D1Database, ids: number[]): Promise<Record<number, { id: number; body: string; author: string }>> {
  const uniq = Array.from(new Set(ids.filter((i) => i > 0)));
  if (!uniq.length) return {};
  const rows = (await db.prepare('SELECT r.id, r.body, u.username FROM replies r LEFT JOIN users u ON u.id = r.user_id WHERE r.id IN (' + uniq.map(() => '?').join(',') + ')').bind(...uniq).all()).results as unknown as { id: number; body: string; username: string }[];
  const map: Record<number, { id: number; body: string; author: string }> = {};
  for (const r of rows) map[r.id] = { id: r.id, body: r.body, author: r.username || '未知' };
  return map;
}

/* ============ 板块管理（管理员编辑，标签即板块） ============ */

export async function createBoard(db: D1Database, name: string, description = '', sort = 0): Promise<number> {
  const info = await db.prepare('INSERT INTO boards (name, description, sort, created_at) VALUES (?, ?, ?, ?)').bind(name, description, sort, Date.now()).run();
  return Number(info.meta.last_row_id);
}
export async function updateBoard(db: D1Database, id: number, fields: { name?: string; description?: string; sort?: number }): Promise<void> {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  await db.prepare(`UPDATE boards SET ${set} WHERE id = ?`).bind(...keys.map((k) => fields[k]), id).run();
}
export async function deleteBoard(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM boards WHERE id = ?').bind(id).run();
}
export async function countThreadsByBoard(db: D1Database, id: number): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) c FROM threads WHERE board_id = ?').bind(id).first<{ c: number }>())?.c ?? 0;
}

/* ============ 邀请码注册 ============ */

export async function isInviteRequired(db: D1Database): Promise<boolean> {
  return (await getSetting(db, 'invite_required')) === '1';
}
export interface InviteRow {
  code: string; created_by: number; used_by: number | null; note: string;
  uses: number; max_uses: number; created_at: number; expires_at: number | null;
}
export async function createInviteCode(db: D1Database, row: { code: string; createdBy: number; note?: string; maxUses?: number; expiresAt?: number | null }): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO invite_codes (code, created_by, used_by, note, uses, max_uses, created_at, expires_at) VALUES (?, ?, NULL, ?, 0, ?, ?, ?)')
    .bind(row.code, row.createdBy, row.note || '', row.maxUses ?? 1, row.expiresAt ?? null, Date.now()).run();
}
export async function listInviteCodes(db: D1Database): Promise<InviteRow[]> {
  return (await db.prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all()).results as unknown as InviteRow[];
}
export async function getInviteCode(db: D1Database, code: string): Promise<InviteRow | null> {
  return db.prepare('SELECT * FROM invite_codes WHERE code = ?').bind(code).first<InviteRow>();
}
export async function validateInviteCode(db: D1Database, code: string): Promise<{ ok: boolean; reason?: string; row?: InviteRow }> {
  const row = await getInviteCode(db, code);
  if (!row) return { ok: false, reason: '邀请码不存在' };
  if (row.expires_at && row.expires_at < Date.now()) return { ok: false, reason: '邀请码已过期' };
  if (row.uses >= row.max_uses) return { ok: false, reason: '邀请码已达使用上限' };
  return { ok: true, row };
}
export async function useInviteCode(db: D1Database, code: string, userId: number): Promise<void> {
  const row = await getInviteCode(db, code);
  if (!row) return;
  const newUses = row.uses + 1;
  const usedBy = row.max_uses <= 1 ? userId : (row.used_by || userId);
  await db.prepare('UPDATE invite_codes SET uses = ?, used_by = ? WHERE code = ?').bind(newUses, usedBy, code).run();
}

/* ============ 群组（权限分组） ============ */

export interface GroupRow { id: number; name: string; description: string; color: string; }

export async function listGroups(db: D1Database): Promise<GroupRow[]> {
  return (await db.prepare('SELECT * FROM groups ORDER BY id ASC').all()).results as unknown as GroupRow[];
}
export async function createGroup(db: D1Database, name: string, description: string, color: string): Promise<number> {
  const info = await db.prepare('INSERT INTO groups (name, description, color, created_at) VALUES (?, ?, ?, ?)').bind(name, description, color, Date.now()).run();
  return Number(info.meta.last_row_id);
}
export async function updateGroup(db: D1Database, id: number, name: string, description: string, color: string): Promise<void> {
  await db.prepare('UPDATE groups SET name = ?, description = ?, color = ? WHERE id = ?').bind(name, description, color, id).run();
}
export async function deleteGroup(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
  await db.prepare('DELETE FROM user_groups WHERE group_id = ?').bind(id).run();
}
export async function getUserGroups(db: D1Database, userId: number): Promise<GroupRow[]> {
  return (await db.prepare('SELECT g.id, g.name, g.description, g.color FROM groups g JOIN user_groups ug ON ug.group_id = g.id WHERE ug.user_id = ? ORDER BY g.id ASC').bind(userId).all()).results as unknown as GroupRow[];
}
export async function getGroupsByUserIds(db: D1Database, userIds: number[]): Promise<Record<number, GroupRow[]>> {
  const uniq = Array.from(new Set(userIds.filter((i) => i > 0)));
  const map: Record<number, GroupRow[]> = {};
  if (!uniq.length) return map;
  const rows = (await db.prepare('SELECT ug.user_id, g.id, g.name, g.description, g.color FROM groups g JOIN user_groups ug ON ug.group_id = g.id WHERE ug.user_id IN (' + uniq.map(() => '?').join(',') + ')').bind(...uniq).all()).results as unknown as { user_id: number; id: number; name: string; description: string; color: string }[];
  for (const r of rows) {
    if (!map[r.user_id]) map[r.user_id] = [];
    map[r.user_id].push({ id: r.id, name: r.name, description: r.description, color: r.color });
  }
  return map;
}
export async function setUserGroups(db: D1Database, userId: number, groupIds: number[]): Promise<void> {
  await db.prepare('DELETE FROM user_groups WHERE user_id = ?').bind(userId).run();
  for (const gid of Array.from(new Set(groupIds.filter((i) => i > 0)))) {
    await db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)').bind(userId, gid).run();
  }
}
export async function getGroupMemberIds(db: D1Database, groupId: number): Promise<number[]> {
  const rows = (await db.prepare('SELECT user_id FROM user_groups WHERE group_id = ?').bind(groupId).all()).results as unknown as { user_id: number }[];
  return rows.map((r) => r.user_id);
}
