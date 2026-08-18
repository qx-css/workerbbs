-- 标签（管理员编辑）
CREATE TABLE IF NOT EXISTS tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  color       TEXT    NOT NULL DEFAULT '#0f6cbd',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_tags (
  thread_id INTEGER NOT NULL,
  tag_id    INTEGER NOT NULL,
  PRIMARY KEY (thread_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_tags_tag ON thread_tags(tag_id);
