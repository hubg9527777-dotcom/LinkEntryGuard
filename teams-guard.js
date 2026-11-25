(() => {
  'use strict';
  // Runs at document_start in Teams, before normal page scripts.
  const BANNER_ID = 'leg-blocked-banner';
  let toastTimer = 0;

  function urlFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const nodes = path.length ? path : [event.target];
    for (const node of nodes) {
      if (!node || node.nodeType !== 1) continue;
      let link = null;
      if (typeof node.matches === 'function' && node.matches('a[href], area[href], [role="link"][data-href]')) {
        link = node;
      } else if (typeof node.closest === 'function') {
        link = node.closest('a[href], area[href], [role="link"][data-href]');
      }
      if (!link) continue;
      // Teams may use href="#" as a placeholder while storing the actual
      // destination in data-href. Do not treat that as a harmless anchor.
      const href = (link.getAttribute('href') || '').trim();
      const dataHref = (link.getAttribute('data-href') || '').trim();
      const raw = (!href || href.startsWith('#')) && dataHref ? dataHref : href;
      if (!raw || raw.startsWith('#')) return '';
      try {
        const parsed = new URL(raw, document.baseURI);
        // A navigable href must not bypass this guard via blob:, data:,
        // custom URI schemes or a newly introduced protocol. Preserve only
        // same-document #fragment navigation for Teams UI compatibility.
        return parsed.href;
      } catch { /* malformed href, browser won't navigate normally */ }
      return '';
    }
    return '';
  }

  function showNotice() {
    const root = document.body || document.documentElement;
    if (!root) return;
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.setAttribute('role', 'status');
      banner.style.cssText = [
        'position:fixed!important', 'z-index:2147483647!important',
        'bottom:22px!important', 'left:50%!important',
        'transform:translateX(-50%)!important', 'max-width:88vw!important',
        'padding:12px 18px!important', 'border-radius:12px!important',
        'box-shadow:0 5px 25px #0004!important',
        'background:#173b34!important', 'color:white!important',
        'font:14px/1.5 system-ui,sans-serif!important',
        'pointer-events:none!important'
      ].join(';');
      banner.textContent = '链接已拦截。请复制链接，再粘贴到浏览器地址栏。';
      root.appendChild(banner);
    }
    banner.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => banner.remove(), 2700);
  }

  function stop(event) {
    // Allow right click so the user can use "Copy link address".
    if (['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].includes(event.type) &&
        typeof event.button === 'number' && event.button !== 0) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;

    const url = urlFromEvent(event);
    if (!url) return;
    // Blocking early pointer/mouse events helps suppress scripts that navigate on mousedown.
    // Do not preventDefault until click/auxclick/keydown: preserves text selection/focus.
    if (!['pointerdown','pointerup','mousedown','mouseup'].includes(event.type)) {
      event.preventDefault();
    }
    event.stopImmediatePropagation();
    event.stopPropagation();
    if (['click', 'auxclick', 'keydown'].includes(event.type)) {
      showNotice();
      try { chrome.runtime.sendMessage({ type: 'teams-link-blocked', url })?.catch?.(() => {}); }
      catch { /* Guard still blocks the DOM action if background is unavailable. */ }
    }
  }

  for (const type of ['pointerdown','pointerup','mousedown','mouseup','click','auxclick','keydown']) {
    window.addEventListener(type, stop, { capture: true, passive: false });
  }

  // Prevent dragging a hyperlink into another tab or onto the tab strip.
  window.addEventListener('dragstart', event => {
    if (!urlFromEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
