# WorkerBBS

一个运行在 **Cloudflare Workers（CloudWorker）+ Hono + D1 + R2** 上的论坛社区。
纯前端用 WinUI / Fluent Design 风格的单页应用（SPA），由 Worker 直接托管，后端使用 D1（Serverless SQLite）与 R2（对象存储）。

## 功能

**前台**
- 板块 / 帖子列表、帖子详情、回复
- 注册 / 登录 / 登出（PBKDF2 密码哈希 + 服务端会话）
- 发帖 / 回复（带经验值，自动升级）
- 个人资料编辑、头像上传、个人主页背景图
- 用户等级系统（经验值 → 等级）
- 搜索（标题 / 正文 / 板块）

**后台（管理员）**
- 修改站点名称、强调色、背景图、简介
- 用户管理：封禁 / 解封、设为管理员
- 帖子管理：置顶 / 删除
- 数据统计（用户 / 帖子 / 回复 / 封禁数）

前台所有可见内容（站点名、配色、背景、帖子、用户）均可在后台自定义。

## 技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Cloudflare Workers |
| 框架 | Hono |
| 数据库 | Cloudflare D1 (SQLite) |
| 存储 | Cloudflare R2（头像 / 背景图） |
| 前端 | 原生 HTML/CSS/JS SPA（WinUI/Fluent 视觉，无构建步骤） |

## 目录结构

```
src/
  index.ts      # Hono 应用：全部 API 路由 + SPA 托管
  db.ts         # D1 数据访问层
  auth.ts       # PBKDF2 密码哈希 + 会话
  types.ts      # 类型定义
public/
  index.html    # SPA 外壳 + 主题化 CSS
  app.js        # 前端逻辑（调用 /api）
  icons/        # Fluent System Icons (SVG)
migrations/     # D1 迁移（表结构 + 预置板块/设置）
scripts/
  seed-admin.mjs# 用环境变量创建管理员（与 Worker 端哈希参数一致）
.github/workflows/deploy.yml  # push main 自动部署
wrangler.toml   # Workers / D1 / R2 绑定配置
```

## 本地开发

```bash
npm install
wrangler login                      # 或设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
wrangler d1 create workerbbs       # 把返回的 database_id 填进 wrangler.toml
wrangler r2 bucket create workerbbs-assets
npm run db:migrate                  # 建表
npm run dev                         # http://localhost:8787
```

本地创建管理员：
```bash
ADMIN_EMAIL=you@example.com ADMIN_USERNAME=admin ADMIN_PASSWORD=yourpass npm run seed:admin
```

## 部署到 GitHub（自动部署）

1. 把仓库推到 GitHub（fork 或自建仓库）。
2. 本地执行上面的 `wrangler d1 create` 与 `wrangler r2 bucket create`，
   把 **D1 的 `database_id`** 填进 `wrangler.toml` 的 `database_id` 字段，
   并把改动提交推送（这一步只需做一次）。
3. 在仓库 **Settings → Secrets and variables → Actions → Repository secrets** 中添加以下密钥：

   | 名称 | 说明 |
   |------|------|
   | `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需 D1 + R2 + Workers 编辑权限） |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
   | `ADMIN_EMAIL` | 管理员邮箱（首次部署创建，已存在则跳过） |
   | `ADMIN_USERNAME` | 管理员用户名（默认 `admin`） |
   | `ADMIN_PASSWORD` | 管理员密码 |
   | `CUSTOM_DOMAIN` | **（可选）** 自定义访问域名，如 `bbs.example.com`。设置后 Cloudflare 在部署时**自动为其添加 DNS 记录**，无需手动操作 |

4. 推送到 `main` 分支，GitHub Actions 会自动：创建 D1/R2 → 注入 database_id 与自定义域名 → 应用 D1 迁移 → 创建管理员 → 部署 Worker（含自动加 DNS）。

> 这些就是你说的「Action 环境变量」：Cloudflare Worker API、账户 ID、访问域名、以及管理员邮箱 / 账户 / 密码。填好后 push 即自动部署。

### 自定义访问域名（自动加 DNS）

`wrangler.toml` 默认 `workers_dev = true`，部署后默认访问 `https://workerbbs.<subdomain>.workers.dev`。

若要绑定自己的域名，**只需在 Secrets 里填 `CUSTOM_DOMAIN`**（例如 `bbs.example.com`）。CI 会自动把它注入 `wrangler.toml` 的 `custom_domains`，部署时 Cloudflare **自动创建该域名的 DNS 记录**，无需你手动去 DNS 面板加解析。

前提：
- 该域名已在 **同一个 Cloudflare 账户**（即 `CLOUDFLARE_ACCOUNT_ID`）下，且 zone 状态为 `Active`；
- API Token 需有该 zone 的 `DNS:Edit` 权限（用 "Edit Cloudflare Workers" 模板通常已包含）。

若未设置 `CUSTOM_DOMAIN`，则只部署到 `*.workers.dev`，不影响使用。

## 接口一览（前缀 `/api`）

- `GET  /settings` 站点设置（主题）
- `GET/POST /auth/login` `POST /auth/register` `POST /auth/logout` `GET /me`
- `GET  /boards` `GET /threads` `GET /threads/:id` `POST /threads` `DELETE /threads/:id`
- `POST /threads/:id/replies`
- `GET /users/:username` `PATCH /me`（资料 / 头像 / 背景）
- `POST /upload` `GET /file/:key`（R2 文件）
- `GET  /admin/*` 后台：stats / settings / users / threads（仅管理员）

## 说明

- 密码使用 PBKDF2-SHA256（10 万次）加盐哈希；会话存于 D1，可主动踢人。
- 头像 / 背景图存于 R2，通过 `/api/file/:key` 读取。
- 所有密钥都通过 GitHub Secrets / wrangler 环境变量注入，不写入代码。
