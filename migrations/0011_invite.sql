-- 邀请码注册
-- code 为唯一主键；max_uses 控制可使用的次数（默认 1 即单人码）
-- used_by 仅单人码使用；uses 累计使用次数
CREATE TABLE IF NOT EXISTS invite_codes (
  code       TEXT    PRIMARY KEY,
  created_by INTEGER NOT NULL,
  used_by    INTEGER,
  note       TEXT    NOT NULL DEFAULT '',
  uses       INTEGER NOT NULL DEFAULT 0,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  expires_at INTEGER          -- NULL = 永不过期
);
CREATE INDEX IF NOT EXISTS idx_invite_used ON invite_codes(used_by);
