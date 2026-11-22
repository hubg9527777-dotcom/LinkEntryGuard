'use strict';
importScripts('policy.js');

// A persisted network rule runs inside Chrome's request pipeline, without
// waiting for the MV3 worker. It covers external app launches and tabs alike.
const GLOBAL_RULE_ID = 1;
const FAILSAFE_RULESET_ID = 'failsafe';
const FAILSAFE_RULE_ID = 1;
const GLOBAL_PRIORITY = 10;
const ONE_TIME_PRIORITY = 100;
const GRANT_MIN_ID = 10000;
const GRANT_TTL_MS = 25000;
const EVENT_KEY = 'leg_events';
const UI_KEY = 'leg_ui';
const DEFAULT_POSITION = Object.freeze({top:0,right:110});
const DEFAULT_UI = Object.freeze({name:'未命名浏览器',show:true,position:DEFAULT_POSITION});
const MAX_NAME_LENGTH = 24;
const newConfirmationTabs = new Set();
const MAX_EVENTS = 100;
const CONFIRM_PREFIX = chrome.runtime.getURL('confirm.html') + '#';
const activeGrants = new Map();
let grantRuleId = GRANT_MIN_ID;
let ruleQueue = Promise.resolve();
let logQueue = Promise.resolve();
let uiWriteQueue = Promise.resolve();
let globalReady = false;
let grantCleanupFault = false;
let lastError = '';
let logStorageSafe = false;
const storageAccessReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .then(() => { logStorageSafe = true; })
  .catch(async error => {
    // Chrome exposes storage.local to content scripts by default. Never write
    // navigation history if trusted-context isolation could not be enforced.
    console.warn('[LEG] privacy isolation failed; persistent logging disabled');
    try { await chrome.storage.local.remove(EVENT_KEY); } catch { /* diagnostic only */ }
  });

function normalizeName(value) {
  if (typeof value !== 'string') throw new Error('备注必须是文字');
  const cleaned = value.replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || DEFAULT_UI.name;
}
function normalizePosition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      !Number.isInteger(raw.top) || !Number.isInteger(raw.right) ||
      raw.top < 0 || raw.top > 8192 || raw.right < 0 || raw.right > 8192 ||
      Object.keys(raw).some(key => !['top','right'].includes(key))) {
    throw new Error('悬浮标签位置无效');
  }
  return {top:raw.top,right:raw.right};
}
async function readUi() {
  await storageAccessReady;
  const data = await chrome.storage.local.get(UI_KEY);
  const raw = data[UI_KEY];
  return {
    name: typeof raw?.name === 'string' ? normalizeName(raw.name) : DEFAULT_UI.name,
    show: raw?.show !== false,
    position: raw?.position === undefined ? {...DEFAULT_POSITION} :
      (() => { try { return normalizePosition(raw.position); } catch { return {...DEFAULT_POSITION}; } })()
  };
}
async function broadcastUi(state) {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id))
      .map(tab => chrome.tabs.sendMessage(tab.id,{type:'leg-ui-changed',ui:state})));
    // Extension pages (e.g. confirm.html) are not content-script targets.
    // A separate extension-runtime message updates the label there as well.
    await chrome.runtime.sendMessage({type:'leg-ui-changed',ui:state}).catch(() => {});
  } catch { /* Newly opened pages will read the saved profile settings. */ }
}
function saveUi(changes) {
  // Popup and floating labels in different tabs may update different fields at
  // the same time. Serialize read/merge/write to prevent lost settings.
  const task = uiWriteQueue.catch(() => {}).then(async () => {
    const current = await readUi();
    const next = {...current};
    if (Object.hasOwn(changes,'name')) next.name = normalizeName(changes.name);
    if (Object.hasOwn(changes,'show')) {
      if (typeof changes.show !== 'boolean') throw new Error('显示状态无效');
      next.show = changes.show;
    }
    if (Object.hasOwn(changes,'position')) next.position = normalizePosition(changes.position);
    await chrome.storage.local.set({[UI_KEY]:next});
    await broadcastUi(next);
    updateActionTitle(next.name);
    return next;
  });
  uiWriteQueue = task.catch(() => {});
  return task;
}
function safeUrl(url) { return GuardPolicy.isWebUrl(url); }
function host(url) { return GuardPolicy.domainOnly(url); }
function exactRegex(url) {
  // Fragments are not part of network HTTP requests.
  const u = new URL(url); u.hash = '';
  return '^' + u.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
}
function runRules(fn) {
  const job = ruleQueue.catch(() => {}).then(fn);
  ruleQueue = job.catch(() => {});
  return job;
}
function record(type, reason, url = '', stage = '') {
  const entry = { at: Date.now(), type, reason, host: host(url), stage };
  logQueue = logQueue.catch(() => {}).then(async () => {
    await storageAccessReady;
    if (!logStorageSafe) return;
    const old = await chrome.storage.local.get(EVENT_KEY);
    const rows = Array.isArray(old[EVENT_KEY]) ? old[EVENT_KEY] : [];
    rows.unshift(entry);
    await chrome.storage.local.set({ [EVENT_KEY]: rows.slice(0, MAX_EVENTS) });
  }).catch(error => console.warn('[LEG] event log failed'));
}
function globalRule() {
  // Include complete URL in the fragment; no target HTTP(S) request occurs
  // until an explicit one-time allow rule is installed by the background.
  return {
    id: GLOBAL_RULE_ID,
    priority: GLOBAL_PRIORITY,
    action: { type: 'redirect', redirect: {
      regexSubstitution: CONFIRM_PREFIX + '\\0'
    } },
    condition: { regexFilter: '^https?://.*$', resourceTypes: ['main_frame'] }
  };
}
function hasExpectedGlobalRule(rule) {
  const expected = globalRule();
  const action = rule?.action;
  const condition = rule?.condition;
  // Reject even newly added restricting fields: a rule with the right ID
  // and redirect action can otherwise silently exclude some destinations.
  if (!rule || !action || !condition) return false;
  const onlyKeys = (object, allowed) => Object.keys(object).every(key => allowed.includes(key));
  return rule.id === expected.id && rule.priority === expected.priority &&
    action.type === 'redirect' && action.redirect?.regexSubstitution === expected.action.redirect.regexSubstitution &&
    onlyKeys(action, ['type', 'redirect']) &&
    onlyKeys(action.redirect, ['regexSubstitution']) &&
    condition.regexFilter === expected.condition.regexFilter &&
    Array.isArray(condition.resourceTypes) && condition.resourceTypes.length === 1 &&
    condition.resourceTypes[0] === 'main_frame' &&
    condition.isUrlFilterCaseSensitive !== true &&
    onlyKeys(condition, ['regexFilter', 'resourceTypes', 'isUrlFilterCaseSensitive']);
}
async function ensureFailsafe() {
  // Detect disabled static rules as well as a disabled whole ruleset. Both
  // configurations persist and cannot be inferred from the manifest alone.
  let enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  if (!enabled.includes(FAILSAFE_RULESET_ID)) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: [FAILSAFE_RULESET_ID]
    });
    enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  }
  if (!enabled.includes(FAILSAFE_RULESET_ID)) throw new Error('静态兜底规则集未启用');
  let disabled = await chrome.declarativeNetRequest.getDisabledRuleIds({rulesetId: FAILSAFE_RULESET_ID});
  if (disabled.includes(FAILSAFE_RULE_ID)) {
    await chrome.declarativeNetRequest.updateStaticRules({
      rulesetId: FAILSAFE_RULESET_ID, enableRuleIds: [FAILSAFE_RULE_ID]
    });
    disabled = await chrome.declarativeNetRequest.getDisabledRuleIds({rulesetId: FAILSAFE_RULESET_ID});
  }
  if (disabled.includes(FAILSAFE_RULE_ID)) throw new Error('静态兜底拦截规则未启用');
}
async function installGlobalRuleNow() {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    if (!hasExpectedGlobalRule(rules.find(r => r.id === GLOBAL_RULE_ID))) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [GLOBAL_RULE_ID], addRules: [globalRule()]
      });
    }
    globalReady = (await chrome.declarativeNetRequest.getDynamicRules())
      .some(hasExpectedGlobalRule);
    if (!globalReady) throw new Error('动态确认规则未能正确安装');
    await ensureFailsafe();
    if (!grantCleanupFault) lastError = '';
  } catch (error) {
    globalReady = false;
    lastError = '请求前确认规则或静态兜底异常';
    record('error', 'rule-check-failed');
    console.error('[LEG] protection health check failed');
  }
  return globalReady;
}
let pendingGlobalRuleCheck = null;
function installGlobalRule() {
  if (!pendingGlobalRuleCheck) {
    const task = installGlobalRuleNow();
    const finished = task.finally(() => {
      if (pendingGlobalRuleCheck === finished) pendingGlobalRuleCheck = null;
    });
    pendingGlobalRuleCheck = finished;
  }
  return pendingGlobalRuleCheck;
}
function updateActionTitle(name) {
  const safe = typeof name === 'string' ? normalizeName(name) : DEFAULT_UI.name;
  // Chrome internal/new-tab pages do not allow DOM badges. Keep the full note
  // discoverable via the browser's native extension-icon tooltip instead.
  // Tooltip failure must never turn a successful Profile setting save into
  // an apparent failure, or interrupt startup network protections.
  try {
    const change = chrome.action.setTitle({title:`LinkEntryGuard · ${safe} · 链接访问保护`});
    change?.catch?.(() => {});
  } catch { /* Optional browser UI only; never affects the security rules. */ }
}
function refreshBadge(healthy) {
  chrome.action.setBadgeBackgroundColor({color:healthy?'#146d4b':'#b91c1c'}).catch(() => {});
  chrome.action.setBadgeText({text:healthy?'ON':'ERR'}).catch(() => {});
}
async function checkGlobalRule() {
  // A rule with the expected numeric ID but altered action/condition is NOT
  // adequate protection; repair it before ever displaying ON.
  const ruleReady = await installGlobalRule();
  await runRules(cleanupExpired);
  const healthy = ruleReady && !grantCleanupFault;
  refreshBadge(healthy);
  return healthy;
}
function isPopup(sender) {
  return sender?.id === chrome.runtime.id && !sender.tab &&
    sender.url === chrome.runtime.getURL('popup.html');
}
function isTeamsContent(sender) {
  return sender?.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) &&
    (GuardPolicy.isTeamsUrl(sender.url) ||
      (/^about:blank(?:[?#]|$)/i.test(sender.url || '') &&
       GuardPolicy.isTeamsUrl(sender.origin)));
}
function isPageContent(sender) {
  return sender?.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) &&
    sender.frameId === 0 && safeUrl(sender.url) && !GuardPolicy.isTeamsUrl(sender.url);
}
function isConfirm(sender) {
  return sender?.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) &&
    sender.frameId === 0 && typeof sender.url === 'string' &&
    sender.url.startsWith(CONFIRM_PREFIX);
}
async function clearGrant(tabId) {
  const old = activeGrants.get(tabId);
  if (!old) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[old.id]});
  } catch (error) {
    // Fail visible rather than losing track of a still-active allow rule.
    // The 1-minute alarm and subsequent browser restarts can retry cleanup.
    old.needsRemoval = true;
    grantCleanupFault = true;
    lastError = '单次放行规则撤销失败';
    record('error', 'allow-rule-removal-failed', old.url, 'cleanup');
    refreshBadge(false);
    console.warn('[LEG] grant cleanup failed; retained for retry');
    throw error;
  }
  clearTimeout(old.timer);
  if (activeGrants.get(tabId) === old) activeGrants.delete(tabId);
}
async function cleanupExpired() {
  let cleanupSucceeded = true;
  const now = Date.now();
  for (const [tabId, state] of activeGrants) {
    if (state.needsRemoval || now - state.created >= GRANT_TTL_MS) {
      try { await clearGrant(tabId); } catch { cleanupSucceeded = false; /* retry on next alarm */ }
    }
  }
  // Recover after service-worker restarts: stale session rules are removed.
  const liveIds = new Set(Array.from(activeGrants.values(), g => g.id));
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const orphans = rules.filter(r => r.id >= GRANT_MIN_ID && !liveIds.has(r.id)).map(r => r.id);
    if (orphans.length) await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:orphans});
  } catch (error) {
    cleanupSucceeded = false;
    grantCleanupFault = true;
    lastError = '过期放行规则未能清理';
    console.warn('[LEG] orphan cleanup failed');
  }
  if (cleanupSucceeded) {
    grantCleanupFault = false;
    if (globalReady) lastError = '';
  }
}
async function allowOnce(tabId, url) {
  return runRules(async () => {
    await clearGrant(tabId);
    const id = ++grantRuleId;
    // Chrome RE2 regular expressions have size limits; overly long URL
    // cannot be safely whitelisted for a single request, so reject it.
    if (url.length > 1600) throw new Error('网址过长，无法创建安全的单次放行规则');
    const regexFilter = exactRegex(url);
    const supported = await chrome.declarativeNetRequest.isRegexSupported({regex:regexFilter});
    if (!supported.isSupported) throw new Error('该网址暂不支持精确单次放行');
    const entry = {
      id, priority: ONE_TIME_PRIORITY,
      action: {type:'allow'},
      condition: {regexFilter, isUrlFilterCaseSensitive:true, resourceTypes:['main_frame'], tabIds:[tabId]}
    };
    await chrome.declarativeNetRequest.updateSessionRules({addRules:[entry]});
    const timer = setTimeout(() => {
      runRules(() => clearGrant(tabId)).catch(() => {});
    }, GRANT_TTL_MS);
    activeGrants.set(tabId,{id,url,created:Date.now(),timer});
    try {
      await chrome.tabs.update(tabId,{url});
      record('approved','confirmed-by-user',url,'before-navigation');
    } catch (error) {
      await clearGrant(tabId);
      throw error;
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  if (message.type === 'teams-link-blocked') {
    if (!isTeamsContent(sender)) return false;
    if (safeUrl(message.url)) record('teams','teams-click',message.url,'click');
    respond({ok:true}); return false;
  }
  if (message.type === 'click-guard') {
    if (!isPageContent(sender) || !safeUrl(message.url)) return false;
    // Only navigation to an extension-owned confirmation page is permitted.
    const target = CONFIRM_PREFIX + message.url;
    const isNew = message.newTab === true;
    const navigate = isNew ? chrome.tabs.create({url:target, active:true}) :
      chrome.tabs.update(sender.tab.id,{url:target});
    navigate.then(tab => {
      if (isNew && Number.isInteger(tab?.id)) newConfirmationTabs.add(tab.id);
      record('prompt','page-click',message.url,'before-navigation');
      respond({ok:true});
    }).catch(() => respond({ok:false}));
    return true;
  }
  if (message.type === 'confirm-seen') {
    if (!isConfirm(sender) || !safeUrl(message.url) ||
        sender.url.slice(CONFIRM_PREFIX.length) !== message.url) return false;
    record('prompt','network-or-manual-confirm',message.url,'before-navigation');
    respond({ok:true});
    return false;
  }
  if (message.type === 'get-ui') {
    if (!(isPopup(sender) || isConfirm(sender) || isPageContent(sender) || isTeamsContent(sender))) return false;
    readUi().then(ui => respond({ok:true,ui})).catch(() => respond({ok:false}));
    return true;
  }
  if (message.type === 'save-ui') {
    const popup = isPopup(sender);
    const page = isPageContent(sender) || isTeamsContent(sender);
    if (!(popup || page) || !message.changes || typeof message.changes !== 'object' ||
        Array.isArray(message.changes) ||
        Object.keys(message.changes).some(key => !['name','show','position'].includes(key)) ||
        (!popup && Object.hasOwn(message.changes,'show'))) return false;
    saveUi(message.changes).then(ui => respond({ok:true,ui})).catch(() => respond({ok:false}));
    return true;
  }
  if (message.type === 'confirm-incognito') {
    if (!isConfirm(sender) || !safeUrl(message.url) ||
        sender.url.slice(CONFIRM_PREFIX.length) !== message.url) return false;
    (async () => {
      const source = await chrome.tabs.get(sender.tab.id);
      if (source.url !== sender.url) throw new Error('确认页已失效');
      const hasIncognitoAccess = await chrome.extension.isAllowedIncognitoAccess();
      if (initialization) await initialization;
      if (!(await checkGlobalRule())) throw new Error('保护规则异常，无法打开');
      if (!hasIncognitoAccess) {
        // Chrome lets an extension OPEN an incognito window without being
        // allowed to READ or control its tabs. The API deliberately returns
        // undefined in that case; it does not indicate an opening failure.
        // The extension does not run in that private profile, so pass the
        // explicitly user-approved destination directly to windows.create.
        // Chrome policy may still disable incognito; the API then rejects.
        try {
          await chrome.windows.create({incognito:true, focused:true, url:message.url});
        } catch {
          throw new Error('Chrome 当前不允许创建无痕窗口');
        }
        record('approved','opened-incognito',message.url,'user-confirmed');
        respond({ok:true});
        if (newConfirmationTabs.delete(source.id)) {
          chrome.tabs.remove(source.id).catch(()=>{});
        } else {
          chrome.tabs.update(source.id,{url:'about:blank'}).catch(()=>{});
        }
        return;
      }
      // With incognito access granted, the protection rule also applies to
      // private tabs. Create a blank tab and install a tab-scoped grant first.
      // Create a blank incognito tab first. Never pass the target URL to
      // windows.create, because that would skip installation of its tab grant.
      const created = await chrome.windows.create({incognito:true,focused:true,url:'about:blank'});
      // Some Chromium builds return a newly created Window without its tabs
      // populated. Query that window rather than incorrectly reporting a
      // failure (or navigating an unverified tab).
      let destination = created?.tabs?.[0];
      if (!Number.isInteger(destination?.id) && created?.incognito &&
          Number.isInteger(created?.id)) {
        try {
          const candidates = await chrome.tabs.query({windowId:created.id});
          destination = candidates.find(t => t.incognito === true);
        } catch { /* Chrome API unavailable; close blank window below. */ }
      }
      if (!created?.incognito || !Number.isInteger(destination?.id) ||
          (Number.isInteger(destination.windowId) && destination.windowId !== created.id)) {
        if (Number.isInteger(created?.id)) await chrome.windows.remove(created.id).catch(()=>{});
        throw new Error('创建无痕窗口失败');
      }
      try {
        await allowOnce(destination.id,message.url);
      } catch (error) {
        await chrome.windows.remove(created.id).catch(()=>{});
        throw error;
      }
      record('approved','opened-incognito',message.url,'before-navigation');
      // The source is a confirmation page. Never open the requested URL in it.
      respond({ok:true});
      if (newConfirmationTabs.delete(source.id)) {
        chrome.tabs.remove(source.id).catch(()=>{});
      } else {
        // Do not destroy a long-lived tab if user pasted into its address bar.
        chrome.tabs.update(source.id,{url:'about:blank'}).catch(()=>{});
      }
    })().catch(error => {
      const reason = String(error?.message||'');
      const known = ['确认页已失效',
        '保护规则异常，无法打开','创建无痕窗口失败',
        'Chrome 当前不允许创建无痕窗口',
        '网址过长，无法创建安全的单次放行规则','该网址暂不支持精确单次放行'];
      respond({ok:false,reason:known.includes(reason)?reason:'无痕打开失败，请重试'});
    });
    return true;
  }
  if (message.type === 'confirm-visit') {
    if (!isConfirm(sender) || !safeUrl(message.url) ||
        sender.url.slice(CONFIRM_PREFIX.length) !== message.url) return false;
    (async () => {
      const tab = await chrome.tabs.get(sender.tab.id);
      if (tab.url !== sender.url) throw new Error('确认页已失效');
      if (initialization) await initialization;
      if (!(await checkGlobalRule())) throw new Error('全局拦截规则异常，已拒绝放行');
      await allowOnce(sender.tab.id,message.url);
      newConfirmationTabs.delete(sender.tab.id);
      respond({ok:true});
    })().catch(error => { console.warn('[LEG] confirmation rejected');
      const message = String(error.message || '');
      const safeReasons = [
        '确认页已失效', '全局拦截规则异常，已拒绝放行',
        '网址过长，无法创建安全的单次放行规则',
        '该网址暂不支持精确单次放行'
      ];
      respond({ok:false,reason:safeReasons.includes(message) ? message : '无法完成本次放行，请重试。'}); });
    return true;
  }
  if (!isPopup(sender)) return false;
  if (message.type === 'get-status') {
    Promise.all([checkGlobalRule(),chrome.storage.local.get(EVENT_KEY)]).then(([ready,state]) => {
      respond({ok:true, ready, events:state[EVENT_KEY] || [], guards:[true,ready], error:lastError});
    }).catch(() => respond({ok:false,ready:false,events:[]}));
    return true;
  }
  if (message.type === 'clear-events') {
    const job = logQueue.catch(() => {}).then(() => chrome.storage.local.remove(EVENT_KEY));
    logQueue = job.catch(() => {});
    job.then(() => respond({ok:true})).catch(() => respond({ok:false}));
    return true;
  }
  return false;
});
chrome.tabs.onRemoved.addListener(tabId => {
  newConfirmationTabs.delete(tabId);
  runRules(() => clearGrant(tabId)).catch(() => {});
});
chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  const grant = activeGrants.get(details.tabId);
  if (!grant) return;
  // Do not revoke the allowance before the approved request has committed.
  if (safeUrl(details.url) || details.url.startsWith(chrome.runtime.getURL('confirm.html'))) {
    runRules(() => clearGrant(details.tabId)).catch(() => {});
  }
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'leg-expire-grants') {
    runRules(cleanupExpired)
      .then(() => refreshBadge(globalReady && !grantCleanupFault))
      .catch(() => refreshBadge(false));
  }
});
async function initialize() {
  await installGlobalRule();
  await runRules(cleanupExpired);
  chrome.alarms.create('leg-expire-grants',{periodInMinutes:1}).catch(()=>{});
  refreshBadge(globalReady && !grantCleanupFault);
  try { updateActionTitle((await readUi()).name); }
  catch { updateActionTitle(DEFAULT_UI.name); }
}
// Listeners registered synchronously; DNR dynamic rules persist across restarts.
let inFlightInitialization = null;
function startInitialization() {
  if (!inFlightInitialization) {
    const pending = initialize().catch(error => {
      globalReady = false;
      console.error('[LEG] initialize failed');
    });
    const finished = pending.finally(() => {
      if (inFlightInitialization === finished) inFlightInitialization = null;
    });
    inFlightInitialization = finished;
  }
  return inFlightInitialization;
}
chrome.runtime.onInstalled.addListener(() => { startInitialization(); });
chrome.runtime.onStartup.addListener(() => { startInitialization(); });
const initialization = startInitialization();
