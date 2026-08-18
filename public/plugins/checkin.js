/**
 * 示例插件前端：每日签到
 * -----------------------------------------------------------
 * 与后端 /api/plugins/checkin 配套。插件通过 window.WB.registerPlugin 注册，
 * 主应用会自动把它加进左侧导航，并在 #/plugin/checkin 路由下调用此 render()。
 *
 * render(root, ctx) 参数 ctx 提供：
 *   ctx.api     —— 与主站一致的 fetch 封装（同域 Cookie 自动带上）
 *   ctx.WI      —— 图标助手 WI(name, size)
 *   ctx.esc     —— HTML 转义
 *   ctx.SETTINGS / ctx.ME —— 全局状态
 */
(function () {
  'use strict';

  async function loadStatus(root, ctx) {
    const box = root.querySelector('#ci-msg');
    if (!box) return;
    try {
      const r = await ctx.api('/api/plugins/checkin');
      if (r.checkedIn) {
        box.innerHTML = '<div class="card" style="padding:14px;margin-top:12px;">今日已签到 ✅ 连续 <b>' + (r.streak || 1) + '</b> 天</div>';
      } else {
        box.innerHTML = '<div class="card" style="padding:14px;margin-top:12px;color:var(--text-2);">今天还没签到，点上面的按钮领取 +5 经验吧。</div>';
      }
    } catch (e) {
      box.textContent = '加载状态失败：' + e.message;
    }
  }

  function render(root, ctx) {
    root.innerHTML =
      '<div class="appbar"><h1>每日签到</h1></div>'
      + '<div class="content-inner">'
      + '<div class="card" style="padding:18px;">'
      + '<p style="margin:0 0 12px;color:var(--text-2);">每天签到可领取 <b>+5</b> 经验值，连续签到还有额外记录。</p>'
      + '<button class="btn primary" id="ciBtn">' + ctx.WI('sparkle', 18) + ' 立即签到</button>'
      + '<div id="ci-msg"></div>'
      + '</div></div>';

    const btn = root.querySelector('#ciBtn');
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await ctx.api('/api/plugins/checkin', { method: 'POST' });
        if (r.ok) {
          btn.textContent = ctx.WI('check', 18) + ' 已签到 +' + r.exp + ' 经验';
        }
      } catch (e) {
        alert(e.message || '签到失败');
      } finally {
        btn.disabled = false;
        loadStatus(root, ctx);
      }
    };
    loadStatus(root, ctx);
  }

  window.WB.registerPlugin({
    id: 'checkin',
    name: '每日签到',
    icon: window.WI ? window.WI('sparkle', 20) : '',
    render: render,
  });
})();
