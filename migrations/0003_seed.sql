-- 站点设置表（后台可改：站点名 / 强调色 / 背景图 等）
-- 用 key/value 存储，避免改表结构

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- 预置板块
INSERT OR IGNORE INTO boards (id, name, description, sort, created_at) VALUES
  (1, '公告',     '站点公告与规则',   0, strftime('%s','now')),
  (2, '技术分享', '折腾 CloudWorker / 前端 / 后端', 1, strftime('%s','now')),
  (3, '问答',     '有问题，来提问',   2, strftime('%s','now')),
  (4, '资源',     '好用的工具与资料', 3, strftime('%s','now')),
  (5, '闲聊',     '灌水去哪儿都行',   4, strftime('%s','now'));

-- 默认站点设置（可被后台覆盖）
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_name',    'WorkerBBS'),
  ('site_accent',  '#0f6cbd'),
  ('site_bg',      ''),
  ('site_desc',    '一个运行在 CloudWorker 上的社区');
