-- 引用帖子
-- threads.quote_thread_id：本帖引用了哪条帖子（0 表示无）
-- replies.quote_reply_id：本回复引用了哪条回复（0 表示无）
ALTER TABLE threads ADD COLUMN quote_thread_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE replies ADD COLUMN quote_reply_id  INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_threads_quote ON threads(quote_thread_id) WHERE quote_thread_id <> 0;
CREATE INDEX IF NOT EXISTS idx_replies_quote ON replies(quote_reply_id)  WHERE quote_reply_id  <> 0;
