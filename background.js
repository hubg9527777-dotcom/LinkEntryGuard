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
const MAX_EVENTS = 100;
const CONFIRM_PREFIX = chrome.runtime.getURL('confirm.html') + '#';
const activeGrants = new Map();
let grantRuleId = GRANT_MIN_ID;
let ruleQueue = Promise.resolve();
let logQueue = Promise.resolve();
let globalReady = false;
let grantCleanupFault = false;
let lastError = '';
let logStorageSafe = false;
const storageAccessReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .then(() => { logStorageSafe = true; })
  .catch(async error => {
    // Chrome exposes storage.local to content scripts by default. Never write
    // navigation history if trusted-context isolation could not be enforced.
    console.warn('[LEG] privacy isolation failed; persistent logging disabled', error);
    try { await chrome.storage.local.remove(EVENT_KEY); } catch { /* diagnostic only */ }
  });

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
  }).catch(error => console.warn('[LEG] event log failed', error));
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
    console.error('[LEG] protection health check failed', error);
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
    console.warn('[LEG] grant cleanup failed; retained for retry', error);
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
    console.warn('[LEG] orphan cleanup failed', error);
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
    navigate.then(() => {
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
  if (message.type === 'confirm-visit') {
    if (!isConfirm(sender) || !safeUrl(message.url) ||
        sender.url.slice(CONFIRM_PREFIX.length) !== message.url) return false;
    (async () => {
      const tab = await chrome.tabs.get(sender.tab.id);
      if (tab.url !== sender.url) throw new Error('确认页已失效');
      if (initialization) await initialization;
      if (!(await checkGlobalRule())) throw new Error('全局拦截规则异常，已拒绝放行');
      await allowOnce(sender.tab.id,message.url);
      respond({ok:true});
    })().catch(error => { console.warn('[LEG] confirmation rejected',error);
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
}
// Listeners registered synchronously; DNR dynamic rules persist across restarts.
let inFlightInitialization = null;
function startInitialization() {
  if (!inFlightInitialization) {
    const pending = initialize().catch(error => {
      globalReady = false;
      console.error('[LEG] initialize',error);
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
