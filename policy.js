'use strict';
// Shared, dependency-free validation. URL strings are never persisted to logs.
const GuardPolicy = Object.freeze({
  isWebUrl(url) {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname);
    } catch { return false; }
  },
  isTeamsUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && (
        u.hostname === 'teams.microsoft.com' ||
        u.hostname.endsWith('.teams.microsoft.com') ||
        u.hostname === 'teams.cloud.microsoft' ||
        u.hostname.endsWith('.teams.cloud.microsoft') ||
        u.hostname === 'teams.live.com'
      );
    } catch { return false; }
  },
  domainOnly(url) {
    try { return new URL(url).hostname.slice(0, 160) || '未知域名'; }
    catch { return '未识别网址'; }
  }
});
