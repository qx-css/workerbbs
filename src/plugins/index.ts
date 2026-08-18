/**
 * 插件框架核心
 * -----------------------------------------------------------
 * - registerForumPlugin(): 内置插件在模块加载时自注册
 * - registerPlugins(app): 在 index.ts 启动时调用，执行每个插件 setup()
 * - runHook(env, event, c, data): 在论坛生命周期点触发钩子（仅对启用插件）
 * - captureEnv(env): 在中间件里缓存 Bindings，供 ctx 的 DB 助手使用
 */
import * as db from '../db';
import type { ForumHookEvent, ForumPlugin, PluginContext } from './types';
import { checkinPlugin } from './builtin/checkin';
import { broadcastWS } from '../realtime';

/** 所有内置插件在此登记 */
const registry: ForumPlugin[] = [checkinPlugin];

/** 钩子处理器表：event -> [{ pluginId, handler }] */
const hookHandlers: Record<string, { pluginId: string; handler: (c: any, data: any) => void | Promise<void> }[]> = {};

/** 运行时 Bindings（Worker 内稳定，首请求捕获即可） */
let RUNTIME_ENV: any = null;
export function captureEnv(env: any): void {
  if (!RUNTIME_ENV) RUNTIME_ENV = env;
}

/** 启用态缓存（避免每次请求查库） */
const enabledCache: Record<string, { v: boolean; ts: number }> = {};
const CACHE_TTL = 60_000;

async function isEnabled(pluginId: string): Promise<boolean> {
  const now = Date.now();
  const cached = enabledCache[pluginId];
  if (cached && now - cached.ts < CACHE_TTL) return cached.v;
  const db0 = RUNTIME_ENV && RUNTIME_ENV.DB;
  let v = false;
  if (db0) {
    const row = await db0.prepare('SELECT enabled FROM plugins WHERE id = ?').bind(pluginId).first();
    v = !!row && (row as any).enabled === 1;
  }
  enabledCache[pluginId] = { v, ts: now };
  return v;
}

let registered = false;

/** 在 index.ts 启动时调用一次，执行所有插件 setup() */
export function registerPlugins(app: any): void {
  if (registered) return;
  registered = true;
  for (const p of registry) {
    const ctx: PluginContext = {
      app,
      on(event: ForumHookEvent, handler) {
        (hookHandlers[event] ||= []).push({ pluginId: p.id, handler });
      },
      isEnabled: () => isEnabled(p.id),
      getConfig: (key, fallback = '') => db.getPluginConfig(RUNTIME_ENV.DB, p.id, key, fallback),
      setConfig: (key, value) => db.setPluginConfig(RUNTIME_ENV.DB, p.id, key, value),
      kvGet: (key, fallback = '') => db.getPluginKv(RUNTIME_ENV.DB, p.id, key, fallback),
      kvSet: (key, value) => db.setPluginKv(RUNTIME_ENV.DB, p.id, key, value),
      addExp: (userId, amount) => db.addExp(RUNTIME_ENV.DB, userId, amount),
      broadcast: (type, payload) => broadcastWS(RUNTIME_ENV, type, payload),
      json: (data, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
    };
    try {
      p.setup(ctx);
    } catch (e) {
      console.error('[plugin] setup failed:', p.id, e);
    }
  }
}

/** 触发生命周期钩子（仅已启用插件会被调用） */
export async function runHook(event: ForumHookEvent, c: any, data: any): Promise<void> {
  const handlers = hookHandlers[event] || [];
  for (const h of handlers) {
    if (!(await isEnabled(h.pluginId))) continue;
    try {
      await h.handler(c, data);
    } catch (e) {
      console.error('[plugin] hook error:', h.pluginId, event, e);
    }
  }
}

/** 让管理端始终能看到所有内置插件（首次访问时补齐行） */
export async function syncPluginsToDb(env: any): Promise<void> {
  if (!env || !env.DB) return;
  for (const p of registry) {
    await db.ensurePlugin(env.DB, p.id, p.name);
  }
}

/** 后台开关插件后，立即刷新（或清空）启用态缓存 */
export function flushPluginCache(id?: string): void {
  if (id) delete enabledCache[id];
  else for (const k of Object.keys(enabledCache)) delete enabledCache[k];
}
