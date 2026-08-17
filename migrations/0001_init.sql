-- WorkerBBS D1 schema (SQLite)
CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id      INTEGER NOT NULL REFERENCES boards(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  last_post_at  INTEGER NOT NULL,
  replies_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL REFERENCES threads(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_board ON threads(board_id, last_post_at DESC);
CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies(thread_id, created_at ASC);

-- 预置板块
INSERT OR IGNORE INTO boards (id, name, slug, description, sort_order) VALUES
  (1, '公告区',   'announcements', '论坛公告与规则', 0),
  (2, '综合讨论', 'general',       '随便聊聊，分享见闻', 1),
  (3, '技术交流', 'tech',          '开发 / 运维 / 架构', 2),
  (4, '闲聊灌水', 'lounge',        '放松一下，快乐摸鱼', 3);
