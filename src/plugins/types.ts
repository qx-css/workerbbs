/**
 * 插件开发类型定义
 * -----------------------------------------------------------
 * 论坛插件是一段「随主仓库部署」的 TypeScript 代码（不是运行时 zip 安装，
 * 那样难以做安全隔离）。插件可以：
 *   1. 通过 ctx.app 挂载自己的 REST 接口（/api/plugins/xxx）
 *   2. 通过 ctx.on(...) 订阅论坛生命周期钩子（发帖、回复、注册…）
 *   3. 通过 ctx 读写配置 / KV / 给用户加经验 / 调用论坛 API
 *
 * 详见仓库 docs/插件开发.md
 */

/** 生命周期钩子事件名 */
export type ForumHookEvent =
  | 'thread:created' // 新帖发布 { threadId, title, boardId, author, userId }
  | 'reply:created' // 新回复 { threadId, author, userId }
  | 'user:registered' // 新用户注册 { userId, username, email }
  | 'user:followed' // 关注/取关切换 { followerId, targetId, is_following }
  | 'thread:liked'; // 帖子点赞/取消 { threadId, liked, byUserId, userId }

/** 插件上下文（setup 时注入，插件用它操作论坛） */
export interface PluginContext {
  /** Hono 应用实例，插件可挂载自己的路由：app.get/post/... */
  app: any;

  /** 订阅一条生命周期钩子 */
  on(event: ForumHookEvent, handler: (c: any, data: any) => void | Promise<void>): void;

  /** 该插件当前是否启用（后台可开关） */
  isEnabled(): Promise<boolean>;

  /** 读取插件配置项（后台可改，JSON 存储） */
  getConfig(key: string, fallback?: string): Promise<string>;
  /** 写入插件配置项 */
  setConfig(key: string, value: string): Promise<void>;

  /** 读取插件 KV（轻量持久化，plugin 命名空间隔离） */
  kvGet(key: string, fallback?: string): Promise<string>;
  /** 写入插件 KV */
  kvSet(key: string, value: string): Promise<void>;

  /** 给某用户加经验值（复用主站逻辑） */
  addExp(userId: number, amount: number): Promise<void>;

  /** 通过 WebSocket 中继节点向所有在线客户端广播一条实时事件
   *  （事件会出现在客户端的 window.WB 实时回调里，需前端配合监听） */
  broadcast(type: string, payload: unknown): void | Promise<void>;

  /** 构造一个 JSON 响应（插件路由统一返回格式） */
  json(data: unknown, status?: number): Response;
}

/** 插件定义 */
export interface ForumPlugin {
  /** 唯一 ID（英文，用于数据库开关与前端路由） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 简介 */
  description?: string;
  /** 版本号 */
  version?: string;
  /** 初始化：挂载路由、订阅钩子 */
  setup(ctx: PluginContext): void | Promise<void>;
}
