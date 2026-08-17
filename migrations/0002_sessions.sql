-- 会话表：基于 sid cookie 的登录态（服务端存储，可主动踢人）

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,             -- 随机 sid
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
