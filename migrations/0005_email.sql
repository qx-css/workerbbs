-- 邮箱验证支持（启用 Resend 发信后，注册需验证邮箱才能登录）
ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;   -- 1 已验证 / 0 待验证
ALTER TABLE users ADD COLUMN verify_token TEXT NOT NULL DEFAULT '';  -- 验证令牌（验证后清空）
