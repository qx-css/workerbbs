-- WorkerBBS 数据库结构（Cloudflare D1 / SQLite）
-- 板块、用户、帖子、回复

CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE,
  email      TEXT    NOT NULL UNIQUE,
  pass_hash  TEXT    NOT NULL,                 -- 格式: <saltHex>:<hashHex>
  role       TEXT    NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
  exp        INTEGER NOT NULL DEFAULT 0,       -- 经验值，用于等级系统
  avatar     TEXT    NOT NULL DEFAULT '',      -- R2 对象 key 或空
  bio        TEXT    NOT NULL DEFAULT '',
  bg_image   TEXT    NOT NULL DEFAULT '',      -- 个人主页背景图 (R2 key)
  banned     INTEGER NOT NULL DEFAULT 0,       -- 0 正常 / 1 封禁
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  views      INTEGER NOT NULL DEFAULT 0,
  pinned     INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT    NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_board ON threads(board_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies(thread_id, id ASC);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
