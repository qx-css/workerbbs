-- 私信（Direct Message）
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user INTEGER NOT NULL,
  to_user   INTEGER NOT NULL,
  body      TEXT NOT NULL,
  "read"    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(from_user, to_user, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_to   ON messages(to_user, "read", id DESC);
