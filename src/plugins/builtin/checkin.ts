/**
 * 内置示例插件：每日签到
 * -----------------------------------------------------------
 * - GET  /api/plugins/checkin     查询今日是否已签到
 * - POST /api/plugins/checkin    执行签到（每日一次，+5 经验）
 * - 钩子 user:registered          记录加入日期（演示钩子用法）
 *
 * 这个插件完整演示了「挂载路由 + 读写 KV + 给用户加经验 + 订阅钩子」，
 * 可作为你开发新插件的模板（复制本文件改 id/name 即可）。
 */
import type { ForumPlugin } from '../types';

export const checkinPlugin: ForumPlugin = {
  id: 'checkin',
  name: '每日签到',
  description: '用户每日签到获得经验值，记录连续签到天数，防止重复签到。',
  version: '1.0.0',

  setup(ctx) {
    // 今天日期（本地，YYYY-MM-DD）
    const today = () => new Date().toISOString().slice(0, 10);

    // 查询签到状态
    ctx.app.get('/api/plugins/checkin', async (c: any) => {
      const u = c.get('user');
      if (!u) return ctx.json({ error: '请先登录' }, 401);
      if (!(await ctx.isEnabled())) return ctx.json({ error: '插件未启用' }, 403);
      const last = await ctx.kvGet('last_' + u.id, '');
      const streak = Number(await ctx.kvGet('streak_' + u.id, '0')) || 0;
      return ctx.json({ checkedIn: last === today(), lastDate: last, streak });
    });

    // 执行签到
    ctx.app.post('/api/plugins/checkin', async (c: any) => {
      const u = c.get('user');
      if (!u) return ctx.json({ error: '请先登录' }, 401);
      if (!(await ctx.isEnabled())) return ctx.json({ error: '插件未启用' }, 403);
      const t = today();
      const last = await ctx.kvGet('last_' + u.id, '');
      if (last === t) return ctx.json({ error: '今天已经签到过了' }, 400);

      // 连续天数：昨天签过则 +1，否则重置为 1
      const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const streak = last === yest ? (Number(await ctx.kvGet('streak_' + u.id, '0')) || 0) + 1 : 1;

      await ctx.kvSet('last_' + u.id, t);
      await ctx.kvSet('streak_' + u.id, String(streak));
      await ctx.addExp(u.id, 5); // 签到奖励经验

      return ctx.json({ ok: true, exp: 5, streak, checkedIn: true });
    });

    // 演示钩子：新用户注册时记录加入日期
    ctx.on('user:registered', async (_c: any, data: any) => {
      if (data && data.userId) {
        await ctx.kvSet('joined_' + data.userId, new Date().toISOString());
      }
    });
  },
};
