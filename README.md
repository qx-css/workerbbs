# WorkerBBS

一个跑在 **Cloudflare Workers + D1（Serverless SQLite）** 上的论坛 / 社区项目（即「CloudWorker」架构）。后端用 [Hono](https://hono.dev) 框架，前端由 Worker 直接渲染服务端 HTML，无需额外静态托管。

> 说明：你最初说的项目名是 `WordkerBBS`，但工作区目录为 `WorkerBBS`，这里按工作区名统一为 **WorkerBBS**。如需改名告诉我即可。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行环境 | Cloudflare Workers |
| Web 框架 | Hono (`c.html` 直接输出 HTML) |
| 数据库 | Cloudflare D1 (SQLite) |
| 部署工具 | Wrangler |
| 语言 | TypeScript |

## 目录结构

```
WorkerBBS/
├─ migrations/
│  └─ 0001_init.sql     # D1 表结构与预置板块
├─ src/
│  ├─ db.ts             # 用户自动创建等小工具
│  └─ index.ts          # Hono 应用：页面 + JSON API
├─ wrangler.toml        # Workers + D1 绑定配置
├─ tsconfig.json
├─ package.json
└─ .gitignore
```

## 功能

- 板块列表、板块内帖子列表、帖子详情 + 回复
- 发帖 / 回帖（昵称不存在会自动注册，方便演示）
- 同时提供页面（HTML）与 JSON API：
  - `GET  /api/boards`
  - `GET  /api/threads?board=<slug>`
  - `GET  /api/threads/:id`
  - `POST /api/threads`（form 或 JSON）
  - `POST /api/threads/:id/replies`

## 快速开始（本地）

```bash
npm install

# 1) 本地创建 D1 数据库（仅首次）
wrangler d1 create workerbbs          # 记下返回的 database_id，填进 wrangler.toml

# 2) 应用表结构到本地库
npm run db:apply:local

# 3) 启动本地开发服务器
npm run dev
# 打开 http://localhost:8787
```

## 部署到 Cloudflare

```bash
# 把数据库结构推到远端 D1
npm run db:apply:remote

# 部署 Worker
npm run deploy
```

> 部署前请在 `wrangler.toml` 填入真实的 `database_id`（由 `wrangler d1 create` 生成）。

## 后续可扩展

- [ ] 用户注册 / 登录（JWT / Cloudflare Access）
- [ ] 发帖频率限制、内容审核
- [ ] 富文本 / Markdown 渲染
- [ ] 点赞、关注、通知
- [ ] 图片上传（R2）
