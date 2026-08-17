import { Hono } from 'hono';
import { getOrCreateUser } from './db';

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

/* ----------------------------- helpers ----------------------------- */
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default:  return '&#39;';
    }
  });
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · WorkerBBS</title>
<style>
  :root { --bg:#0f1115; --card:#1a1d24; --fg:#e6e6e6; --muted:#9aa0aa; --accent:#4f8cff; --border:#2a2e37; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif; line-height:1.6; }
  a { color:var(--accent); text-decoration:none; }
  header { padding:14px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; background:var(--bg); z-index:10; }
  header h1 { margin:0; font-size:20px; }
  main { max-width:860px; margin:0 auto; padding:24px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:14px; }
  .muted { color:var(--muted); font-size:13px; }
  .btn { display:inline-block; background:var(--accent); color:#fff; padding:8px 14px; border-radius:8px; border:none; cursor:pointer; font-size:14px; }
  input,textarea,select { width:100%; background:#11141a; color:var(--fg); border:1px solid var(--border); border-radius:8px; padding:10px; font-size:14px; margin:6px 0 14px; font-family:inherit; }
  textarea { min-height:120px; resize:vertical; }
  label { font-size:13px; color:var(--muted); }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:space-between; }
  .tag { background:#222732; border:1px solid var(--border); border-radius:999px; padding:2px 10px; font-size:12px; color:var(--muted); }
  h2 { margin-top:8px; }
</style>
</head>
<body>
<header><h1><a href="/">WorkerBBS</a></h1><a class="btn" href="/new">发帖</a></header>
<main>${body}</main>
</body></html>`;
}

async function getFields(c: any): Promise<Record<string, string>> {
  const ct = c.req.header('content-type') || '';
  if (ct.includes('application/json')) {
    const j = await c.req.json().catch(() => ({}));
    return j as Record<string, string>;
  }
  const b = await c.req.parseBody();
  return b as Record<string, string>;
}

const isJson = (c: any) => (c.req.header('content-type') || '').includes('application/json');

/* ----------------------------- pages ------------------------------ */
app.get('/', async (c) => {
  const db = c.env.DB;
  const boards = await db
    .prepare('SELECT id, name, slug, description FROM boards ORDER BY sort_order')
    .all<{ id: number; name: string; slug: string; description: string | null }>();

  const threads = await db
    .prepare(`SELECT t.id, t.title, t.created_at, t.replies_count, b.name AS board, b.slug AS board_slug, u.username
              FROM threads t
              JOIN boards b ON b.id = t.board_id
              JOIN users u ON u.id = t.user_id
              ORDER BY t.last_post_at DESC LIMIT 20`)
    .all<{ id: number; title: string; created_at: number; replies_count: number; board: string; board_slug: string; username: string }>();

  const boardCards = boards.results
    .map(
      (b) => `<div class="card">
        <div class="row"><a href="/board/${esc(b.slug)}"><strong>${esc(b.name)}</strong></a><span class="tag">${esc(b.slug)}</span></div>
        <div class="muted">${esc(b.description ?? '')}</div>
      </div>`
    )
    .join('');

  const threadRows = threads.results.length
    ? threads.results
        .map(
          (t) => `<div class="card">
          <div class="row"><a href="/thread/${t.id}"><strong>${esc(t.title)}</strong></a><span class="tag">${esc(t.board)}</span></div>
          <div class="muted">by ${esc(t.username)} · ${new Date(t.created_at).toLocaleString('zh-CN')} · ${t.replies_count} 回复</div>
        </div>`
        )
        .join('')
    : '<div class="muted">还没有帖子，来 <a href="/new">发第一帖</a> 吧。</div>';

  return c.html(layout('首页', `<h2>板块</h2>${boardCards}<h2>最新帖子</h2>${threadRows}`));
});

app.get('/board/:slug', async (c) => {
  const db = c.env.DB;
  const slug = c.req.param('slug');
  const board = await db
    .prepare('SELECT id, name, description FROM boards WHERE slug = ?')
    .bind(slug)
    .first<{ id: number; name: string; description: string | null }>();
  if (!board) return c.notFound();

  const threads = await db
    .prepare(`SELECT t.id, t.title, t.created_at, t.replies_count, u.username
              FROM threads t JOIN users u ON u.id = t.user_id
              WHERE t.board_id = ? ORDER BY t.last_post_at DESC LIMIT 50`)
    .bind(board.id)
    .all<{ id: number; title: string; created_at: number; replies_count: number; username: string }>();

  const rows = threads.results.length
    ? threads.results
        .map(
          (t) => `<div class="card">
          <div class="row"><a href="/thread/${t.id}"><strong>${esc(t.title)}</strong></a></div>
          <div class="muted">by ${esc(t.username)} · ${new Date(t.created_at).toLocaleString('zh-CN')} · ${t.replies_count} 回复</div>
        </div>`
        )
        .join('')
    : '<div class="muted">该板块还没有帖子。</div>';

  const body = `<a href="/">← 返回</a><h2>${esc(board.name)}</h2>
    <div class="muted">${esc(board.description ?? '')}</div>
    <p><a class="btn" href="/new?board=${esc(slug)}">在本版发帖</a></p>${rows}`;
  return c.html(layout(board.name, body));
});

app.get('/thread/:id', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const thread = await db
    .prepare(`SELECT t.id, t.title, t.body, t.created_at, t.replies_count, b.name AS board, b.slug AS board_slug, u.username
              FROM threads t
              JOIN boards b ON b.id = t.board_id
              JOIN users u ON u.id = t.user_id
              WHERE t.id = ?`)
    .bind(id)
    .first<{ id: number; title: string; body: string; created_at: number; replies_count: number; board: string; board_slug: string; username: string }>();
  if (!thread) return c.notFound();

  const replies = await db
    .prepare(`SELECT r.content, r.created_at, u.username
              FROM replies r JOIN users u ON u.id = r.user_id
              WHERE r.thread_id = ? ORDER BY r.created_at ASC`)
    .bind(id)
    .all<{ content: string; created_at: number; username: string }>();

  const replyHtml = replies.results.length
    ? replies.results
        .map(
          (r) => `<div class="card">
          <div>${esc(r.content).replace(/\n/g, '<br>')}</div>
          <div class="muted">${esc(r.username)} · ${new Date(r.created_at).toLocaleString('zh-CN')}</div>
        </div>`
        )
        .join('')
    : '<div class="muted">还没有回复，来抢沙发。</div>';

  const body = `<a href="/board/${esc(thread.board_slug)}">← ${esc(thread.board)}</a>
    <h2>${esc(thread.title)}</h2>
    <div class="card">
      <div>${esc(thread.body).replace(/\n/g, '<br>')}</div>
      <div class="muted">楼主 ${esc(thread.username)} · ${new Date(thread.created_at).toLocaleString('zh-CN')}</div>
    </div>
    <h3>回复 (${thread.replies_count})</h3>
    ${replyHtml}
    <h3>添加回复</h3>
    <form method="POST" action="/api/threads/${thread.id}/replies">
      <input name="username" placeholder="你的昵称" />
      <textarea name="content" placeholder="说点什么..."></textarea>
      <button class="btn" type="submit">回复</button>
    </form>`;
  return c.html(layout(thread.title, body));
});

app.get('/new', async (c) => {
  const db = c.env.DB;
  const boards = await db
    .prepare('SELECT name, slug FROM boards ORDER BY sort_order')
    .all<{ name: string; slug: string }>();
  const pre = c.req.query('board') || '';
  const options = boards.results
    .map((b) => `<option value="${esc(b.slug)}" ${b.slug === pre ? 'selected' : ''}>${esc(b.name)}</option>`)
    .join('');

  const body = `<a href="/">← 返回</a><h2>发新帖</h2>
    <form method="POST" action="/api/threads">
      <label>板块</label>
      <select name="board">${options}</select>
      <label>昵称</label>
      <input name="username" placeholder="你的昵称" />
      <label>标题</label>
      <input name="title" placeholder="标题" />
      <label>内容</label>
      <textarea name="body" placeholder="正文内容..."></textarea>
      <button class="btn" type="submit">发布</button>
    </form>`;
  return c.html(layout('发新帖', body));
});

/* ----------------------------- JSON API --------------------------- */
app.get('/api/boards', async (c) => {
  const r = await c.env.DB
    .prepare('SELECT id, name, slug, description, sort_order FROM boards ORDER BY sort_order')
    .all();
  return c.json(r.results);
});

app.get('/api/threads', async (c) => {
  const slug = c.req.query('board');
  let sql = `SELECT t.id, t.title, t.created_at, t.replies_count, b.slug AS board_slug, u.username
             FROM threads t JOIN boards b ON b.id = t.board_id JOIN users u ON u.id = t.user_id`;
  const args: any[] = [];
  if (slug) {
    sql += ' WHERE b.slug = ?';
    args.push(slug);
  }
  sql += ' ORDER BY t.last_post_at DESC LIMIT 50';
  const r = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json(r.results);
});

app.get('/api/threads/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const thread = await c.env.DB
    .prepare(`SELECT t.id, t.title, t.body, t.created_at, t.replies_count, b.name AS board, b.slug AS board_slug, u.username
              FROM threads t JOIN boards b ON b.id = t.board_id JOIN users u ON u.id = t.user_id
              WHERE t.id = ?`)
    .bind(id)
    .first();
  if (!thread) return c.json({ error: 'not found' }, 404);
  const replies = await c.env.DB
    .prepare('SELECT r.content, r.created_at, u.username FROM replies r JOIN users u ON u.id = r.user_id WHERE r.thread_id = ? ORDER BY r.created_at ASC')
    .bind(id)
    .all();
  return c.json({ thread, replies: replies.results });
});

app.post('/api/threads', async (c) => {
  const db = c.env.DB;
  const f = await getFields(c);
  const boardSlug = String(f.board || '').trim();
  const username = String(f.username || '').trim();
  const title = String(f.title || '').trim();
  const body = String(f.body || '').trim();
  if (!boardSlug || !username || !title || !body)
    return c.json({ error: '板块 / 昵称 / 标题 / 内容均必填' }, 400);

  const board = await db.prepare('SELECT id FROM boards WHERE slug = ?').bind(boardSlug).first<{ id: number }>();
  if (!board) return c.json({ error: '板块不存在' }, 400);

  const userId = await getOrCreateUser(db, username);
  const now = Date.now();
  const res = await db
    .prepare('INSERT INTO threads (board_id, user_id, title, body, created_at, last_post_at, replies_count) VALUES (?, ?, ?, ?, ?, ?, 0)')
    .bind(board.id, userId, title, body, now, now)
    .run();
  const threadId = Number(res.meta.last_row_id);

  return isJson(c)
    ? c.json({ ok: true, id: threadId })
    : c.redirect(`/thread/${threadId}`);
});

app.post('/api/threads/:id/replies', async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param('id'));
  const f = await getFields(c);
  const username = String(f.username || '').trim();
  const content = String(f.content || '').trim();
  if (!username || !content) return c.json({ error: '昵称和内容必填' }, 400);

  const thread = await db.prepare('SELECT id FROM threads WHERE id = ?').bind(id).first<{ id: number }>();
  if (!thread) return c.json({ error: '帖子不存在' }, 404);

  const userId = await getOrCreateUser(db, username);
  const now = Date.now();
  await db
    .prepare('INSERT INTO replies (thread_id, user_id, content, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, userId, content, now)
    .run();
  await db
    .prepare('UPDATE threads SET replies_count = replies_count + 1, last_post_at = ? WHERE id = ?')
    .bind(now, id)
    .run();

  return isJson(c) ? c.json({ ok: true }) : c.redirect(`/thread/${id}`);
});

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

export default app;
