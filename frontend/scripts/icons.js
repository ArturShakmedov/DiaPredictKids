/* ==========================================================================
   NDST — иконки
   Локальный набор в стиле Lucide (stroke 1.7, 24x24), без внешних CDN.
   Разметка: <i data-icon="shield-check"></i>  →  инлайн <svg class="icon">
   ========================================================================== */

const ICONS = {
  'activity':        '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  'shield-check':    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'zap':             '<path d="M13 2 4.09 13.11a1 1 0 0 0 .77 1.64H11l-1 7.25L19.91 10.9a1 1 0 0 0-.77-1.64H13z"/>',
  'flask':           '<path d="M10 2v6.5L4.6 17.9A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-3.1L14 8.5V2"/><path d="M8.5 2h7"/><path d="M6.6 16h10.8"/>',
  'droplet':         '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  'droplets':        '<path d="M8.5 12.5a4.5 4.5 0 0 0 4.5 4.5 4.5 4.5 0 0 0 4.5-4.5c0-1.4-.7-2.6-2-3.7-1.3-1.1-2.2-2.6-2.5-4.3-.4 1.7-1.3 3.2-2.5 4.3-1.3 1.1-2 2.3-2 3.7z"/><path d="M3 16.8A3.8 3.8 0 0 0 6.8 20.6 3.8 3.8 0 0 0 10.6 16.8c0-1.1-.6-2.1-1.7-3-1-1-1.8-2.1-2.1-3.5-.3 1.4-1.1 2.6-2.1 3.5-1 .9-1.7 1.9-1.7 3z"/>',
  'glass-water':     '<path d="M6 3h12l-1.1 16.2a2 2 0 0 1-2 1.8H9.1a2 2 0 0 1-2-1.8z"/><path d="M6.7 12.2c1.3 0 1.3 1 2.7 1s1.3-1 2.6-1 1.3 1 2.7 1 1.3-1 2.6-1"/>',
  'bandage':         '<rect x="2" y="6" width="20" height="12" rx="6"/><path d="M8.6 6.6v10.8"/><path d="M15.4 6.6v10.8"/><path d="M10.6 10.4h.01"/><path d="M13.4 10.4h.01"/><path d="M10.6 13.6h.01"/><path d="M13.4 13.6h.01"/>',
  'utensils':        '<path d="M5 2v7a3 3 0 0 0 6 0V2"/><path d="M8 9v13"/><path d="M18 2c-1.7 0-3 2.2-3 5s1.3 4 3 4"/><path d="M18 2v20"/>',
  'moon':            '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  'trending-down':   '<path d="M22 17 13.5 8.5l-5 5L2 7"/><path d="M16 17h6v-6"/>',
  'trending-up':     '<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>',
  'eye':             '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  'battery-low':     '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/><path d="M6 11v2"/>',
  'heart-pulse':     '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/><path d="M3.2 13h6.3l.5-1 2 4.5 2-7 1.5 3.5h5.3"/>',
  'users':           '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user':            '<path d="M19 21v-2a7 7 0 0 0-14 0v2"/><circle cx="12" cy="7" r="4"/>',
  'clipboard-list':  '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  'arrow-right':     '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'arrow-left':      '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  'arrow-down':      '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'check':           '<path d="M20 6 9 17l-5-5"/>',
  'check-circle':    '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'minus-circle':    '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  'x':               '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'menu':            '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  'alert-triangle':  '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'info':            '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'lock':            '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'stethoscope':     '<path d="M4.5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-.5"/><path d="M8 15v1a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
  'cpu':             '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v2"/><path d="M15 2v2"/><path d="M9 20v2"/><path d="M15 20v2"/><path d="M2 9h2"/><path d="M2 15h2"/><path d="M20 9h2"/><path d="M20 15h2"/>',
  'layout-dashboard':'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  'chevron-down':    '<path d="m6 9 6 6 6-6"/>',
  'chevron-right':   '<path d="m9 18 6-6-6-6"/>',
  'chevron-left':    '<path d="m15 18-6-6 6-6"/>',
  'search':          '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'bell':            '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  'sliders':         '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  'book-open':       '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'calendar':        '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/>',
  'file-text':       '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'pie-chart':       '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  'bar-chart':       '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="7" rx="1"/><rect x="12.5" y="7" width="3" height="11" rx="1"/><rect x="18" y="4" width="3" height="14" rx="1"/>',
  'target':          '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'ruler':           '<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/>',
  'timer':           '<path d="M10 2h4"/><path d="M12 14v-4"/><circle cx="12" cy="14" r="8"/>',
  'refresh':         '<path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/>',
  'printer':         '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  'database':        '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  'globe':           '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'mail':            '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  'phone':           '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  'log-out':         '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  'list-checks':     '<path d="m3 6 2 2 3-3"/><path d="m3 15 2 2 3-3"/><path d="M12 6h9"/><path d="M12 12h9"/><path d="M12 18h9"/>',
  'plus':            '<path d="M12 5v14"/><path d="M5 12h14"/>',
  'upload':          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  'copy':            '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'download':        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  'filter':          '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>'
};

function renderIcons(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.getAttribute('data-icon');
    const body = ICONS[name];
    if (!body) return;
    const extra = el.className ? ' ' + el.className : '';
    const svg =
      '<svg class="icon' + extra + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      body + '</svg>';
    el.outerHTML = svg;
  });
}

document.addEventListener('DOMContentLoaded', () => renderIcons());
window.NdstIcons = { ICONS, renderIcons };
