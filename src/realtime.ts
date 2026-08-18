import * as db from './db';

/**
 * 实时同步（WebSocket 中继节点）
 * -----------------------------------------------------------
 * 主仓库只需配置 ws_endpoint（节点地址）。
 *   - type / payload 会广播给节点上所有在线客户端（发帖/回复/点赞等）。
 *   - 传入 to（用户 id）则只投递给已通过 {type:'auth',userId} 注册的该用户会话，用于私信。
 * 节点未配置则静默跳过。
 */
export async function broadcastWS(env: any, type: string, payload: unknown, to?: number): Promise<void> {
  const endpoint = await db.getSetting(env.DB, 'ws_endpoint');
  if (!endpoint) return;
  try {
    const url = endpoint.replace(/^wss?:\/\//, 'https://').replace(/\/+$/, '') + '/broadcast';
    const body: any = { type, payload };
    if (typeof to === 'number') body.to = to;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* 实时同步失败不影响主流程 */
  }
}
