(() => {
  'use strict';
  // Content script handles client-side/SPAs as well as ordinary anchor clicks;
  // DNR separately handles desktop-app launches and script-based navigations.
  if (window !== window.top) return;
  const mark = event => {
    const composed = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const element of composed) {
      if (!element || element.nodeType !== 1) continue;
      const a = typeof element.closest === 'function' ? element.closest('a[href],area[href]') : null;
      if (!a) continue;
      const raw = a.getAttribute('href');
      if (!raw || raw.startsWith('#') || a.hasAttribute('download')) return null;
      try {
        const url = new URL(raw, document.baseURI);
        if (!['https:', 'http:'].includes(url.protocol)) return null;
        if (url.origin === location.origin && url.pathname === location.pathname &&
            url.search === location.search && url.hash !== location.hash) return null;
        return url.href;
      } catch { return null; }
    }
    return null;
  };
  window.addEventListener('click', e => {
    if (e.button !== 0 || !e.isTrusted) return;
    const url = mark(e);
    if (!url) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Keep the existing page intact; a rejected link only closes its confirmation tab.
    const newTab = true;
    chrome.runtime.sendMessage({type:'click-guard',url,newTab}).catch(() => {
      // Fail closed: no link navigation if the background is not available.
      console.warn('[LEG] 无法显示确认页，链接已阻止');
    });
  }, {capture:true,passive:false});
})();
