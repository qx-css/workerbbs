/**
 * 插件宿主（前端）
 * -----------------------------------------------------------
 * 提供全局 window.WB.registerPlugin() 供插件注册自身，
 * 主应用 app.js 会读取 window.WB.plugins 生成侧栏导航并分发路由。
 *
 * 插件不是运行时安装的——它们随仓库部署，在 HTML 里用 <script> 引入。
 * 新增插件：把 JS 文件放进 /plugins/ 并在 index.html 加载即可。
 */
(function () {
  'use strict';
  window.WB = window.WB || {};
  window.WB.plugins = window.WB.plugins || {};
  window.WB.registerPlugin = function (plugin) {
    if (!plugin || !plugin.id) {
      console.warn('[WB] registerPlugin: 缺少 id，注册失败');
      return;
    }
    if (typeof plugin.render !== 'function') {
      console.warn('[WB] registerPlugin: ' + plugin.id + ' 缺少 render() 函数');
      return;
    }
    window.WB.plugins[plugin.id] = plugin;
  };
})();
