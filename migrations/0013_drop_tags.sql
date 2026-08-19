-- 合并：标签即板块。移除独立的 tags / thread_tags 多对多系统，统一使用 boards 表。
-- 用 IF EXISTS 保证幂等（无论 0010_tags 是否已应用到远端 D1，本迁移都安全）。
DROP TABLE IF EXISTS thread_tags;
DROP TABLE IF EXISTS tags;
