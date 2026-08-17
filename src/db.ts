// 用户相关的小工具：昵称不存在时自动创建
export async function getOrCreateUser(
  db: D1Database,
  username: string
): Promise<number> {
  const trimmed = (username || '').trim();
  if (!trimmed) throw new Error('username is required');

  const existing = await db
    .prepare('SELECT id FROM users WHERE username = ?')
    .bind(trimmed)
    .first<{ id: number }>();
  if (existing) return existing.id;

  const res = await db
    .prepare('INSERT INTO users (username, created_at) VALUES (?, ?)')
    .bind(trimmed, Date.now())
    .run();
  return Number(res.meta.last_row_id);
}
