-- QQ 式表情回应（reactions）
-- target_type: 'thread' | 'reply'
CREATE TABLE IF NOT EXISTS reactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  target_type TEXT    NOT NULL,
  target_id   INTEGER NOT NULL,
  emoji       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE(user_id, target_type, target_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id);
