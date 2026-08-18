-- 插件系统：插件开关/配置 + 插件 KV 存储
CREATE TABLE IF NOT EXISTS plugins (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config  TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS plugin_kv (
  plugin TEXT NOT NULL,
  k      TEXT NOT NULL,
  v      TEXT NOT NULL,
  PRIMARY KEY (plugin, k)
);
