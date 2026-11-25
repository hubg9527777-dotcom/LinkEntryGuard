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

// List rules match normalized HTTP(S) URLs without fragments (not sent to servers).
const ListPolicy = Object.freeze({
  normalize(raw) {
    if (!raw || !['white','black'].includes(raw.kind) || !['url','site','path'].includes(raw.scope) ||
        typeof raw.url !== 'string' || raw.url.length > 1600 || typeof raw.note !== 'string') throw new Error('名单格式无效');
    const u = new URL(raw.url.trim());
    if (!GuardPolicy.isWebUrl(u.href) || u.username || u.password) throw new Error('仅支持无凭据的 HTTP/HTTPS 网址');
    u.hash = '';
    // A directory rule is deliberately restricted to an explicit trailing
    // slash; never infer a wider path from a pasted URL or ignore a query.
    if(raw.scope==='path'&&(u.pathname==='/'||!u.pathname.endsWith('/')||u.search))throw new Error('路径规则须为非根目录且以 / 结尾，不含查询参数');
    const url = raw.scope === 'site' ? u.origin : raw.scope==='path' ? u.origin+u.pathname : u.href;
    if (url.length > 1600) throw new Error('网址过长');
    const note = raw.note.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').trim().slice(0,80);
    return {kind:raw.kind,scope:raw.scope,url,note};
  },
  key(rule) { return rule.scope + '|' + rule.url; },
  match(rules, raw) {
    if (!GuardPolicy.isWebUrl(raw)) return [];
    const u = new URL(raw); u.hash = '';
    return rules.filter(r => r.scope === 'site' ? r.url === u.origin : r.scope==='path' ? u.href.startsWith(r.url) : r.url === u.href)
      .sort((a,b) => (a.kind === b.kind ? 0 : a.kind === 'black' ? -1 : 1) || (({url:0,path:1,site:2})[a.scope]-({url:0,path:1,site:2})[b.scope]) || (b.url.length-a.url.length));
  },
  regex(rule) {
    const escaped = rule.url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return '^' + escaped + (rule.scope === 'site' ? '/.*$' : rule.scope==='path' ? '.*$' : '$');
  }
});
