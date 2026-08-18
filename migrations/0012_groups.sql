-- 群组（权限分组：后台给用户打标，如「版主」「VIP」）
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL DEFAULT '',
  color       TEXT    NOT NULL DEFAULT '#0f6cbd',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_groups (
  user_id  INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_user_groups_group ON user_groups(group_id);
