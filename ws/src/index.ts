// WorkerBBS WebSocket 中继节点（独立 Worker）
// ---------------------------------------------------------------------------
// 变量（在 ws/wrangler.toml 的 [vars] 中配置）：
//   USER_ID     —— 频道 / 租户标识（同一节点可服务多个论坛，靠它隔离）
//   NODE_DOMAIN —— 节点域名（仅用于展示/记录）
//
// 主仓库（workerbbs）在「实时同步」设置里只需填：
//   WebSocket 端点 = wss://<本节点地址>
// （无 API 密钥，节点开放广播。）
// ---------------------------------------------------------------------------

interface Session {
  ws: WebSocket;
  channel: string;
  userId?: number; // 客户端连接后通过 {type:'auth',userId} 注册，用于私信定向投递
}

// 以普通类实现 Durable Object（只要有 fetch 方法即可被绑定调用）
export class Relay {
  private env: any;
  sessions: Map<string, Session> = new Map();

  constructor(_ctx: any, env: any) {
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const channel = (this.env.USER_ID as string) || 'global';

    // 1) 广播接口（主仓库调用，用于把事件推给在线客户端）
    //    body.to 指定用户 id 时，仅投递给该用户的会话；否则全员广播。
    if (url.pathname === '/broadcast') {
      let body: any = {};
      try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
      const to = (typeof body.to === 'number') ? body.to : undefined;
      this.broadcast(JSON.stringify({ type: body.type, payload: body.payload }), to);
      return new Response('ok');
    }

    // 2) WebSocket 升级（客户端连接）
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 400 });
    }
    const pair: any = new WebSocketPair();
    const client: WebSocket = pair[0];
    const server: WebSocket = pair[1];
    const id = (crypto as any).randomUUID ? (crypto as any).randomUUID() : String(Math.random());
    this.sessions.set(id, { ws: server, channel });
    server.accept();
    const cleanup = () => this.sessions.delete(id);
    // 客户端 -> 服务端：目前用于注册 userId（私信定向投递所需）
    server.addEventListener('message', (ev: any) => {
      try {
        const m = JSON.parse(ev.data);
        if (m && m.type === 'auth' && typeof m.userId === 'number') {
          const sess = this.sessions.get(id);
          if (sess) sess.userId = m.userId;
        }
      } catch { /* 忽略非法消息 */ }
    });
    server.addEventListener('close', cleanup);
    server.addEventListener('error', cleanup);
    return new Response(null, { status: 101, webSocket: client });
  }

  // to 未指定 → 投递全部会话；指定 → 仅投递 userId === to 的会话
  broadcast(msg: string, to?: number) {
    for (const [id, s] of this.sessions) {
      if (to !== undefined && s.userId !== to) continue;
      try { s.ws.send(msg); } catch { this.sessions.delete(id); }
    }
  }
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/broadcast' || url.pathname.startsWith('/ws')) {
      const id = env.RELAY.idFromName('relay');
      const stub = env.RELAY.get(id);
      return stub.fetch(request);
    }
    return new Response('WorkerBBS WebSocket Relay', { status: 200 });
  },
};
