/* WinUI / Fluent 风格线性图标集
 * 统一用 24x24 viewBox、currentColor 描边，主题色/深色自动适配。
 * 用法：WI('home', 20) -> <svg ...>...</svg>
 * 个别实心图标（如心形填充、列表圆点）以预置 <svg> 形式给出。
 */
(function () {
  'use strict';
  // 描边型图标：内部 markup（含在外层 <svg> 中）
  var S = {
    home: '<path d="M3 10.6 12 4l9 6.6"/><path d="M5 9.6V20h5v-6h4v6h5V9.6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.6-3.6"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    person: '<circle cx="12" cy="8" r="3.6"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
    navigation: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    comment: '<path d="M4 5h16v10H9l-4 4v-4H4z"/>',
    eye: '<path d="M2 12s3.6-6.6 10-6.6S22 12 22 12s-3.6 6.6-10 6.6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    userAdd: '<circle cx="10" cy="8" r="3.2"/><path d="M4 19a6 6 0 0 1 9-5.3"/><path d="M17 11v6M14 14h6"/>',
    chevronLeft: '<path d="m14.5 6-6 6 6 6"/>',
    send: '<path d="M21 4 3 11l7 2.5L12.5 21 21 4Z"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M10 5h7M7 19h7M14 5l-4 14"/>',
    underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/>',
    strike: '<path d="M5 12h14M8 7a4 4 0 0 1 8 1M8 17a4 4 0 0 0 8-1"/>',
    heading: '<path d="M5 5v14M5 12h5M5 5h5M13 5v14M13 12h4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
    listOrdered: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1.6V9M3.8 17.6h2.4"/>',
    quote: '<path d="M7 7h4v4c0 2.2-1.6 3.2-4 4.2M14 7h4v4c0 2.2-1.6 3.2-4 4.2"/>',
    link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M8 12 6.5 13.5a3.5 3.5 0 0 0 5 5L13 17"/><path d="M16 12l1.5-1.5a3.5 3.5 0 0 0-5-5L11 7"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
    edit: '<path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3Z"/><path d="M14 7l3 3"/>',
    trash: '<path d="M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13"/>',
    pin: '<path d="M12 21c4-5 6-8 6-11a6 6 0 1 0-12 0c0 3 2 6 6 11Z"/><circle cx="12" cy="10" r="2.2"/>',
    share: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
    check: '<path d="m5 12 5 5 9-11"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    logout: '<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h11"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    rotate: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    chat: '<path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>',
    emoji: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.1" fill="currentColor"/><circle cx="15" cy="10" r="1.1" fill="currentColor"/><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" fill="none" stroke="currentColor"/>',
    tag: '<path d="M3 11.4V4h7.4L21 14.6 14.6 21 3 11.4Z"/><circle cx="7.4" cy="7.4" r="1.4" fill="currentColor" stroke="none"/>',
    key: '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M16.5 16.5l2.5-2.5M14.5 14.5l2-2"/>',
    navigation: '<path d="M12 3 21 8 12 13 3 8 12 3Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  };

  // 实心（填充）图标：整段 <svg>
  var F = {
    heartFill: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 20.5S4 15 4 8.8C4 6 6 4 8.5 4c1.7 0 3.2 1 3.5 2.4C12.3 5 13.8 4 15.5 4 18 4 20 6 20 8.8c0 6.2-8 11.7-8 11.7Z"/></svg>',
  };

  var map = Object.assign({}, S, F);

  window.WINUI_ICONS = map;
  window.WI = function (name, size, cls) {
    var e = map[name];
    if (!e) return '';
    if (e.trim().indexOf('<svg') === 0) return e; // 预置整段 svg
    size = size || 20;
    return (
      '<svg class="wic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      e + '</svg>'
    );
  };
})();
