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

export async function getThread(db: D1Database, id: number): Promise<Thread | null> {
  return db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first<Thread>();
}

export async function createThread(
  db: D1Database,
  data: { boardId: number; userId: number; title: string; body: string }
): Promise<number> {
  const info = await db
    .prepare('INSERT INTO threads (board_id, user_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(data.boardId, data.userId, data.title, data.body, Date.now())
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
  data: { threadId: number; userId: number; body: string }
): Promise<number> {
  const info = await db
    .prepare('INSERT INTO replies (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .bind(data.threadId, data.userId, data.body, Date.now())
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
