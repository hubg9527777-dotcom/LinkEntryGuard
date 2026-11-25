'use strict';
importScripts('policy.js');
const BUILD = '1.0.2-r20261125.2';
let listError = '';
const openingTabs = new Set();

// A persisted network rule runs inside Chrome's request pipeline, without
// waiting for the MV3 worker. It covers external app launches and tabs alike.
const GLOBAL_RULE_ID = 1;
const EMERGENCY_RULE_ID = 2; // persisted, higher priority than any normal grant
const FAILSAFE_RULESET_ID = 'failsafe';
const FAILSAFE_RULE_ID = 1;
const GLOBAL_PRIORITY = 10;
const ONE_TIME_PRIORITY = 100;
const GRANT_MIN_ID = 10000;
const GRANT_TTL_MS = 25000;
const EVENT_KEY = 'leg_events';
const UI_KEY = 'leg_ui';
const PREFILL_KEY = 'leg_menu_prefill';
let prefillQueue = Promise.resolve();
const BACKUP_KEY = 'leg_lists_backup_v1';
const LIST_KEY = 'leg_lists_v1';
const LIST_BASE = 1000, LIST_LIMIT = 300;
let listFault = true; // Unknown until the persisted policy has been verified.
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
let storageAccessReady;
function ensureStorageAccess(){
  if (storageAccessReady) return storageAccessReady;
  storageAccessReady = Promise.resolve().then(()=>chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }))
  .then(() => { logStorageSafe = true; })
  .catch(async error => {
    // Chrome exposes storage.local to content scripts by default. Never write
    // navigation history if trusted-context isolation could not be enforced.
    console.warn('[LEG] privacy isolation failed; persistent logging disabled');
    try { await chrome.storage.local.remove(EVENT_KEY); } catch { /* diagnostic only */ }
  }).finally(()=>{ if(!logStorageSafe) storageAccessReady=undefined; });
  return storageAccessReady;
}
ensureStorageAccess();

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
  await ensureStorageAccess();
  if (!logStorageSafe) throw new Error('设置存储不可用');
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
function safeUrl(url) {
  if (!GuardPolicy.isWebUrl(url)) return false;
  const u = new URL(url); return !u.username && !u.password;
}
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
async function readList() {
  await ensureStorageAccess();
  if (!logStorageSafe) throw new Error('名单存储不可用');
  const data = await chrome.storage.local.get(LIST_KEY);
  const raw = data[LIST_KEY] === undefined ? [] : data[LIST_KEY]; // null is corrupt, not an empty list
  if (!Array.isArray(raw) || raw.length > LIST_LIMIT) throw new Error('名单数据异常');
  let rows;
  try { rows = raw.map(r => ListPolicy.normalize(r)); } catch { throw new Error('名单数据异常'); }
  if (new Set(rows.map(ListPolicy.key)).size !== rows.length) throw new Error('名单数据重复');
  return rows;
}
function normalizeRows(raw) {
  if (!Array.isArray(raw) || raw.length > LIST_LIMIT) throw new Error('名单最多300条');
  const rows = raw.map(r=>ListPolicy.normalize(r));
  if (new Set(rows.map(ListPolicy.key)).size !== rows.length) throw new Error('名单数据重复');
  return rows;
}
function listStatus(rows,url) {
  const matches = ListPolicy.match(rows,url);
  return {kind:matches[0]?.kind || 'none',matches};
}
function blackRules(rows) {
  return rows.filter(r => r.kind === 'black').map((r,i) => ({id:LIST_BASE+i,priority:200,
    action:{type:'redirect',redirect:{regexSubstitution:CONFIRM_PREFIX+'\\0'}},
    condition:{regexFilter:ListPolicy.regex(r),isUrlFilterCaseSensitive:true,resourceTypes:['main_frame']}}));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
async function syncList(rows) {
  const expected = blackRules(rows);
  const current = (await chrome.declarativeNetRequest.getDynamicRules()).filter(r=>r.id>=LIST_BASE && r.id<LIST_BASE+LIST_LIMIT).sort((a,b)=>a.id-b.id);
  if (JSON.stringify(stable(current)) === JSON.stringify(stable(expected))) {listFault=false;return;}
  for (const rule of expected) {
    const result = await chrome.declarativeNetRequest.isRegexSupported({regex:rule.condition.regexFilter,isCaseSensitive:true});
    if (!result.isSupported) throw new Error('网址规则过长或不支持');
  }
  await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:current.map(r=>r.id),addRules:expected});
  const actual = (await chrome.declarativeNetRequest.getDynamicRules()).filter(r=>r.id>=LIST_BASE && r.id<LIST_BASE+LIST_LIMIT).sort((a,b)=>a.id-b.id);
  if (JSON.stringify(stable(actual)) !== JSON.stringify(stable(expected))) throw new Error('名单规则校验失败');
  listFault=false;
}
async function verifiedList() {
  let rows;
  try { rows=await readList(); }
  catch(e) {
    listFault=true;listError=e.message==='名单存储不可用'?'LEG-11':e.message.startsWith('名单数据')?'LEG-12':'LEG-13';
    refreshBadge(false);throw new Error('名单读取异常');
  }
  try {await syncList(rows);listError='';return rows;}
  catch {listFault=true;listError='LEG-14';refreshBadge(false);throw new Error('名单规则异常');}
}
async function checkLists() {
  try {await verifiedList();return true;} catch {return false;}
}

async function changeList(message, confirmUrl, quickTarget = null, sourceCheck = null) {
  return runRules(async()=>{
    const old = await verifiedList();
    if (sourceCheck) await sourceCheck();
    // Quick controls also need optimistic concurrency checks. Compare just
    // the rules affecting the displayed URL, not unrelated edits elsewhere.
    if (quickTarget !== null) {
      const expected = normalizeRows(message.expectedMatches);
      const actual = listStatus(old,quickTarget).matches;
      if (JSON.stringify(stable(expected)) !== JSON.stringify(stable(actual)))
        throw new Error('名单已变化，请刷新');
    }
    let rows = old.slice();
    if (message.op === 'delete') {
      const entry = old.find(r=>ListPolicy.key(r)===message.key);
      if (!entry || (confirmUrl && !ListPolicy.match([entry],confirmUrl).length)) throw new Error('名单已变化，请刷新');
      rows = rows.filter(r=>ListPolicy.key(r)!==message.key);
    } else if (message.op === 'save') {
      const next = ListPolicy.normalize(message.rule);
      if (confirmUrl && !ListPolicy.match([next],confirmUrl).length) throw new Error('只能修改当前网址');
      const key = ListPolicy.key(next);
      if (message.oldKey && !old.some(r=>ListPolicy.key(r)===message.oldKey)) throw new Error('名单已变化，请刷新');
      if (message.oldKey && message.oldKey!==key) {
        if (confirmUrl) throw new Error('确认页不能修改其他规则');
        rows=rows.filter(r=>ListPolicy.key(r)!==message.oldKey);
      }
      rows=rows.filter(r=>ListPolicy.key(r)!==key); rows.push(next);
      if (rows.length>LIST_LIMIT) throw new Error('名单最多300条');
    } else if (message.op === 'batch' || message.op === 'restore') {
      if (confirmUrl) throw new Error('无效操作');
      // Compare the full normalized snapshot under the rule lock: stale tabs
      // cannot silently overwrite newer edits. Never accept a blind replace.
      const expected = normalizeRows(message.expected);
      if (JSON.stringify(stable(expected)) !== JSON.stringify(stable(old))) throw new Error('名单已变化，请刷新');
      if (message.op === 'restore') {
        const saved = (await chrome.storage.local.get(BACKUP_KEY))[BACKUP_KEY];
        if (!saved || !Number.isFinite(saved.at)) throw new Error('暂无备份');
        rows = normalizeRows(saved.rows);
      } else rows = normalizeRows(message.rows);
    } else throw new Error('无效操作');
    if (JSON.stringify(stable(rows)) === JSON.stringify(stable(old))) return old;
    // Validate all rows before touching live rules or the stored policy.
    const existingKeys = new Set(old.map(ListPolicy.key));
    for (const r of rows) {
      if(existingKeys.has(ListPolicy.key(r)))continue;
      if (!(await chrome.declarativeNetRequest.isRegexSupported({regex:ListPolicy.regex(r),isCaseSensitive:true})).isSupported) throw new Error('网址规则过长或不支持');
    }
    try {
      // Revoke temporary grants before changing the policy, including orphan grants.
      for (const tabId of activeGrants.keys()) await clearGrant(tabId);
      await cleanupExpired();
      if (grantCleanupFault) throw new Error('临时放行清理失败');
      if(sourceCheck)await sourceCheck();
      await syncList(rows);
      if(sourceCheck)await sourceCheck();
      await chrome.storage.local.set({[LIST_KEY]:rows,[BACKUP_KEY]:{at:Date.now(),rows:old}});
    } catch (e) {
      try { await syncList(old); } catch { listFault=true;listError='LEG-14';refreshBadge(false); }
      throw new Error(e.message==='确认页已失效'?'确认页已失效':'名单保存失败，请重试');
    }
    return rows;
  });
}
function record(type, reason, url = '', stage = '') {
  const entry = { at: Date.now(), type, reason, host: host(url), stage };
  logQueue = logQueue.catch(() => {}).then(async () => {
    await ensureStorageAccess();
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
    const unexpected = rules.filter(r => r.id !== GLOBAL_RULE_ID && r.id !== EMERGENCY_RULE_ID && !(r.id >= LIST_BASE && r.id < LIST_BASE + LIST_LIMIT)).map(r => r.id);
    if (unexpected.length) await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:unexpected});
    if (!hasExpectedGlobalRule(rules.find(r => r.id === GLOBAL_RULE_ID))) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [GLOBAL_RULE_ID], addRules: [globalRule()]
      });
    }
    const actual = await chrome.declarativeNetRequest.getDynamicRules();
    globalReady = actual.some(hasExpectedGlobalRule) && actual.every(r => r.id === GLOBAL_RULE_ID || r.id === EMERGENCY_RULE_ID || (r.id >= LIST_BASE && r.id < LIST_BASE + LIST_LIMIT));
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
  const listReady = await runRules(checkLists);
  const healthy = ruleReady && listReady && !grantCleanupFault;
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
// Session-rule deletion can fail while the stale allow rule remains effective.
// Install a separate, higher-priority block as a best-effort fail-closed barrier.
// It survives worker restarts and is removed ONLY after a successful cleanup.
function emergencyRule() {
  return {id:EMERGENCY_RULE_ID,priority:1000,action:{type:'block'},
    condition:{regexFilter:'^https?://.*$',resourceTypes:['main_frame']}};
}
async function setEmergencyBlock(enabled) {
  const expected=emergencyRule();
  const same=rule=>{
    if(!rule)return false;
    const condition={...rule.condition};
    if(condition.isUrlFilterCaseSensitive===false)delete condition.isUrlFilterCaseSensitive;
    return JSON.stringify(stable({...rule,condition}))===JSON.stringify(stable(expected));
  };
  const current=(await chrome.declarativeNetRequest.getDynamicRules()).find(r=>r.id===EMERGENCY_RULE_ID);
  if(enabled ? !same(current) : Boolean(current)) {
    await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[EMERGENCY_RULE_ID],addRules:enabled?[expected]:[]});
  }
  const actual=(await chrome.declarativeNetRequest.getDynamicRules()).find(r=>r.id===EMERGENCY_RULE_ID);
  if(enabled ? !same(actual) : Boolean(actual)) throw new Error('emergency rule mismatch');
}
async function quarantineGrants() {
  grantCleanupFault=true;refreshBadge(false);
  try {await setEmergencyBlock(true);}
  catch {lastError='临时权限及紧急拦截异常，请停止访问并重新加载扩展';record('error','emergency-block-failed');}
}
async function clearGrant(tabId) {
  const old = activeGrants.get(tabId);
  if (!old) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[old.id]});
    if ((await chrome.declarativeNetRequest.getSessionRules()).some(r=>r.id===old.id)) throw new Error('grant remains');
  } catch (error) {
    // Fail visible rather than losing track of a still-active allow rule.
    // The 1-minute alarm and subsequent browser restarts can retry cleanup.
    old.needsRemoval = true;
    grantCleanupFault = true;
    lastError = '单次放行规则撤销失败';
    record('error', 'allow-rule-removal-failed', old.url, 'cleanup');
    refreshBadge(false);
    console.warn('[LEG] grant cleanup failed; retained for retry');
    await quarantineGrants();
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
    const orphans = rules.filter(r => !liveIds.has(r.id)).map(r => r.id);
    if (orphans.length) await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:orphans});
    const actual = await chrome.declarativeNetRequest.getSessionRules();
    if (actual.some(r => !liveIds.has(r.id))) throw new Error('orphan rules remain');
    for (const [tabId, state] of activeGrants) {
      const rule = actual.find(r => r.id === state.id);
      if (!rule || JSON.stringify(stable(rule)) !== JSON.stringify(stable(state.rule))) {
        await clearGrant(tabId);
        record('error','allow-rule-mismatch',state.url,'cleanup');
      }
    }
  } catch (error) {
    cleanupSucceeded = false;
    grantCleanupFault = true;
    lastError = '过期放行规则未能清理';
    console.warn('[LEG] orphan cleanup failed');
  }
  if (cleanupSucceeded) {
    try {
      await setEmergencyBlock(false);
      grantCleanupFault = false;
      if (globalReady) lastError = '';
    } catch {grantCleanupFault=true;lastError='紧急拦截尚未解除，请重试';refreshBadge(false);}
  } else await quarantineGrants();
}
async function assertCurrentTab(tabId, expected) {
  const tab = await chrome.tabs.get(tabId);
  const blankPending = expected === 'about:blank' && tab.pendingUrl === expected && (!tab.url || ['chrome://newtab/','chrome://new-tab-page/'].includes(tab.url));
  if ((!blankPending && tab.url !== expected) || (tab.pendingUrl && tab.pendingUrl !== expected)) throw new Error('确认页已失效');
  return tab;
}
async function finishIncognitoSource(tabId, expected) {
  try { await assertCurrentTab(tabId, expected); } catch { newConfirmationTabs.delete(tabId); return; }
  if (newConfirmationTabs.delete(tabId)) await chrome.tabs.remove(tabId).catch(()=>{});
  else await chrome.tabs.update(tabId,{url:'about:blank'}).catch(()=>{});
}
async function allowOnce(tabId, url, automatic = false, expected = null, sourceCheck = null) {
  return runRules(async () => {
    const status = listStatus(await verifiedList(),url).kind;
    if (status === 'black') throw new Error('黑名单已阻止，请先移除规则');
    if (automatic && status !== 'white') throw new Error('白名单已变化，请手动确认');
    if (listFault) throw new Error('名单规则异常');
    await cleanupExpired();
    if(grantCleanupFault) throw new Error('临时放行清理失败');
    await clearGrant(tabId);
    const id = ++grantRuleId;
    // Chrome RE2 regular expressions have size limits; overly long URL
    // cannot be safely whitelisted for a single request, so reject it.
    if (url.length > 1600) throw new Error('网址过长，无法创建安全的单次放行规则');
    const regexFilter = exactRegex(url);
    const supported = await chrome.declarativeNetRequest.isRegexSupported({regex:regexFilter,isCaseSensitive:true});
    if (!supported.isSupported) throw new Error('该网址暂不支持精确单次放行');
    const entry = {
      id, priority: ONE_TIME_PRIORITY,
      action: {type:'allow'},
      condition: {regexFilter, isUrlFilterCaseSensitive:true, resourceTypes:['main_frame'], tabIds:[tabId]}
    };
    if (sourceCheck) await sourceCheck();
    if (expected !== null) await assertCurrentTab(tabId, expected);
    await chrome.declarativeNetRequest.updateSessionRules({addRules:[entry]});
    const timer = setTimeout(() => {
      runRules(() => activeGrants.get(tabId)?.id===id ? clearGrant(tabId) : undefined).catch(() => {});
    }, GRANT_TTL_MS);
    activeGrants.set(tabId,{id,url,created:Date.now(),timer,rule:entry});
    try {
      if (sourceCheck) await sourceCheck();
      if (expected !== null) await assertCurrentTab(tabId, expected);
      await chrome.tabs.update(tabId,{url});
      record('approved',automatic?'whitelist-auto':'confirmed-by-user',url,'before-navigation');
    } catch (error) {
      await clearGrant(tabId);
      throw error;
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  // Identify the executing worker, not just the manifest (which can be updated on disk).
  const reply=respond;
  respond=result=>reply({...result,build:BUILD});
  const manager = sender?.id===chrome.runtime.id && typeof sender.url==='string' && sender.url.split('#')[0]===chrome.runtime.getURL('lists.html') && sender.frameId===0;
  const confirmPage = isConfirm(sender);
  const protocolRequired=['list-status','list-edit','list-all','confirm-visit','confirm-incognito','get-status','diagnostics','list-prefill'].includes(message.type);
  if ((isPopup(sender)||manager||confirmPage) && (protocolRequired||message.build!==undefined) && message.build!==BUILD) {
    respond({ok:false,code:'LEG-01',reason:'插件版本不一致，请重新加载扩展'});return false;
  }
  if(message.type==='list-prefill'){
    if(!manager||!/^#[a-f0-9-]{36}$/.test(new URL(sender.url).hash)||new URL(sender.url).hash.slice(1)!==message.token)return false;
    const task=prefillQueue.catch(()=>{}).then(async()=>{
      const data=(await chrome.storage.session.get(PREFILL_KEY))[PREFILL_KEY]||[];
      const live=Array.isArray(data)?data.filter(r=>r?.expires>Date.now()&&safeUrl(r.url)):[];
      const found=live.find(r=>r.token===message.token);
      await chrome.storage.session.set({[PREFILL_KEY]:live.filter(r=>r.token!==message.token)});
      if(!found)throw new Error('快捷链接已过期');
      return {ok:true,url:found.url};
    });prefillQueue=task.catch(()=>{});task.then(respond).catch(()=>respond({ok:false,reason:'快捷链接已过期，请重新右键'}));return true;
  }
  if (['list-status','list-edit','list-all'].includes(message.type)) {
    if (!(isPopup(sender) || manager || confirmPage)) return false;
    const target = confirmPage ? sender.url.slice(CONFIRM_PREFIX.length) : message.url;
    if (message.type === 'list-all' && !manager) return false;
    (async()=>{
      if (initialization) await initialization;
      if (confirmPage && (await chrome.tabs.get(sender.tab.id)).url!==sender.url) throw new Error('确认页已失效');
      if (message.type==='list-status' && !safeUrl(target)) throw new Error('网址无效');
      if (message.type==='list-edit') {
        if (['batch','restore'].includes(message.op) && !manager) throw new Error('无效操作');
        if (!manager && !safeUrl(target)) throw new Error('网址无效');
        const rows=await changeList(message,manager?null:target,manager?null:target,confirmPage?()=>assertCurrentTab(sender.tab.id,sender.url):null);
        if(manager){const saved=await chrome.storage.local.get(BACKUP_KEY).catch(()=>({}));return {ok:true,rows,backupAt:Number.isFinite(saved[BACKUP_KEY]?.at)?saved[BACKUP_KEY].at:null};}
        return {ok:true,...listStatus(rows,target)};
      }
      const rows=await runRules(verifiedList);
      refreshBadge(globalReady && !grantCleanupFault && !listFault);
      if(message.type==='list-all'){const saved=(await chrome.storage.local.get(BACKUP_KEY))[BACKUP_KEY];return {ok:true,rows,backupAt:Number.isFinite(saved?.at)?saved.at:null};}
      return {ok:true,...listStatus(rows,target)};
    })().then(respond).catch(e=>respond({ok:false,code:listError||'LEG-15',reason:['名单最多300条','名单已变化，请刷新','只能修改当前网址','仅支持无凭据的 HTTP/HTTPS 网址','网址规则过长或不支持','确认页已失效','名单读取异常','名单规则异常','名单保存失败，请重试','名单格式无效','网址无效','路径规则须为非根目录且以 / 结尾，不含查询参数','名单数据重复','暂无备份','无效操作'].includes(e.message)?e.message:'名单操作失败，请重试'}));
    return true;
  }
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
    const page = isPageContent(sender) || isTeamsContent(sender) || isConfirm(sender);
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
    if(openingTabs.has(sender.tab.id)){respond({ok:false,code:'LEG-21',reason:'正在打开，请稍候'});return false;}
    openingTabs.add(sender.tab.id);
    (async () => {
      const source = await assertCurrentTab(sender.tab.id, sender.url);
      if (listStatus(await runRules(verifiedList),message.url).kind==='black') throw new Error('黑名单已阻止，请先移除规则');
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
          await runRules(async()=>{
            if (listStatus(await verifiedList(),message.url).kind==='black') throw new Error('黑名单已阻止，请先移除规则');
            await assertCurrentTab(source.id, sender.url);
            await chrome.windows.create({incognito:true, focused:true, url:message.url});
          });
        } catch(e) {
          if(['黑名单已阻止，请先移除规则','确认页已失效','名单读取异常','名单规则异常'].includes(e.message)) throw e;
          throw new Error('Chrome 当前不允许创建无痕窗口');
        }
        record('approved','opened-incognito',message.url,'user-confirmed');
        respond({ok:true});
        await finishIncognitoSource(source.id,sender.url);
        return;
      }
      // With incognito access granted, the protection rule also applies to
      // private tabs. Create a blank tab and install a tab-scoped grant first.
      // Create a blank incognito tab first. Never pass the target URL to
      // windows.create, because that would skip installation of its tab grant.
      await assertCurrentTab(source.id, sender.url);
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
      if (!created?.incognito || !Number.isInteger(created.id) || !Number.isInteger(destination?.id) || destination.incognito !== true ||
          (Number.isInteger(destination.windowId) && destination.windowId !== created.id)) {
        if (Number.isInteger(created?.id)) await chrome.windows.remove(created.id).catch(()=>{});
        throw new Error('创建无痕窗口失败');
      }
      try {
        await allowOnce(destination.id,message.url,false,'about:blank',()=>assertCurrentTab(source.id,sender.url));
      } catch (error) {
        await chrome.windows.remove(created.id).catch(()=>{});
        throw error;
      }
      record('approved','opened-incognito',message.url,'before-navigation');
      // The source is a confirmation page. Never open the requested URL in it.
      respond({ok:true});
      await finishIncognitoSource(source.id,sender.url);
    })().catch(error => {
      const reason = String(error?.message||'');
      const known = ['黑名单已阻止，请先移除规则','确认页已失效',
        '保护规则异常，无法打开','创建无痕窗口失败','名单读取异常','名单规则异常',
        'Chrome 当前不允许创建无痕窗口',
        '网址过长，无法创建安全的单次放行规则','该网址暂不支持精确单次放行'];
      respond({ok:false,reason:known.includes(reason)?reason:'无痕打开失败，请重试'});
    }).finally(()=>openingTabs.delete(sender.tab.id));
    return true;
  }
  if (message.type === 'confirm-visit') {
    if (!isConfirm(sender) || !safeUrl(message.url) ||
        sender.url.slice(CONFIRM_PREFIX.length) !== message.url) return false;
    if(openingTabs.has(sender.tab.id)){respond({ok:false,code:'LEG-21',reason:'正在打开，请稍候'});return false;}
    openingTabs.add(sender.tab.id);
    (async () => {
      await assertCurrentTab(sender.tab.id,sender.url);
      if (initialization) await initialization;
      if (!(await checkGlobalRule())) throw new Error('全局拦截规则异常，已拒绝放行');
      await allowOnce(sender.tab.id,message.url,message.automatic===true,sender.url);
      newConfirmationTabs.delete(sender.tab.id);
      respond({ok:true});
    })().catch(error => { console.warn('[LEG] confirmation rejected');
      const message = String(error.message || '');
      const safeReasons = [
        '黑名单已阻止，请先移除规则','白名单已变化，请手动确认','名单读取异常','名单规则异常','确认页已失效', '全局拦截规则异常，已拒绝放行',
        '网址过长，无法创建安全的单次放行规则',
        '该网址暂不支持精确单次放行'
      ];
      respond({ok:false,reason:safeReasons.includes(message) ? message : '无法完成本次放行，请重试。'}); }).finally(()=>openingTabs.delete(sender.tab.id));
    return true;
  }
  if (!isPopup(sender)) return false;
  if (message.type === 'diagnostics') {
    checkGlobalRule().then(ready=>respond({ok:true,diagnostics:{version:chrome.runtime.getManifest?.().version||'1.0.2',build:BUILD,ready,globalReady,listReady:!listFault,grantCleanupReady:!grantCleanupFault,storageReady:logStorageSafe,activeGrants:activeGrants.size,code:listError||(!ready?'LEG-04':'')}})).catch(()=>respond({ok:false,code:'LEG-04',reason:'诊断失败'}));
    return true;
  }
  if (message.type === 'get-status') {
    Promise.all([checkGlobalRule(),ensureStorageAccess().then(()=>logStorageSafe?chrome.storage.local.get(EVENT_KEY):{})]).then(([ready,state]) => {
      respond({ok:true, ready, listReady:!listFault, code:listError, events:Array.isArray(state[EVENT_KEY])?state[EVENT_KEY]:[], guards:[true,ready], error:lastError});
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
    runRules(() => activeGrants.get(details.tabId)===grant ? clearGrant(details.tabId) : undefined).catch(() => {});
  }
});
// Error events are advisory and can repeat for redirected navigations. Only
// revoke the matching grant, never a newer one queued for the same tab.
chrome.webNavigation.onErrorOccurred?.addListener(details=>{
  if(details.frameId!==0)return;
  const grant=activeGrants.get(details.tabId);
  if(!grant||!safeUrl(details.url)||exactRegex(details.url)!==exactRegex(grant.url))return;
  runRules(()=>activeGrants.get(details.tabId)===grant?clearGrant(details.tabId):undefined).catch(()=>{});
});
// SPA URL changes do not necessarily hit the network stack. Check only black
// entries, never interrupt ordinary internal chat navigation. Best effort,
// after history changes, not a pre-request guarantee.
chrome.webNavigation.onHistoryStateUpdated?.addListener(details=>{
  if(details.frameId!==0||!safeUrl(details.url))return;
  runRules(async()=>{
    if(listStatus(await readList(),details.url).kind!=='black')return;
    const tab=await chrome.tabs.get(details.tabId);
    if(tab.url!==details.url)return;
    await chrome.tabs.update(details.tabId,{url:CONFIRM_PREFIX+details.url});
    record('prompt','blacklist-spa',details.url,'after-history-change');
  }).catch(()=>{});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'leg-expire-grants') {
    checkGlobalRule()
      .then(healthy => refreshBadge(healthy))
      .catch(() => refreshBadge(false));
    if(chrome.storage.session){const job=prefillQueue.catch(()=>{}).then(async()=>{const data=(await chrome.storage.session.get(PREFILL_KEY))[PREFILL_KEY];if(Array.isArray(data))await chrome.storage.session.set({[PREFILL_KEY]:data.filter(r=>r?.expires>Date.now())});});prefillQueue=job.catch(()=>{});}
  }
});
async function initialize() {
  await installGlobalRule();
  await runRules(cleanupExpired);
  await runRules(checkLists);
  chrome.alarms.create('leg-expire-grants',{periodInMinutes:1}).catch(()=>{});
  refreshBadge(globalReady && !grantCleanupFault && !listFault);
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
refreshBadge(false);
const initialization = startInitialization();

// A browser-native user gesture opens the local rule editor, not the target.
if(chrome.contextMenus){
  chrome.runtime.onInstalled.addListener(()=>{
    chrome.contextMenus.removeAll(()=>{
      if(chrome.runtime.lastError)return;
      chrome.contextMenus.create({id:'leg-manage-link',title:'LinkEntryGuard · 管理链接名单',contexts:['link','page'],documentUrlPatterns:['http://*/*','https://*/*']},()=>{void chrome.runtime.lastError;});
    });
  });
  chrome.contextMenus.onClicked.addListener(info=>{
    if(info.menuItemId!=='leg-manage-link')return;
    const url=info.linkUrl||info.pageUrl;
    if(!safeUrl(url)||url.length>1600)return;
    // Only an opaque one-time token enters the extension page's URL/history.
    // Session storage is trusted-only by default and disappears at shutdown.
    const task=prefillQueue.catch(()=>{}).then(async()=>{
      const token=crypto.randomUUID();
      const data=(await chrome.storage.session.get(PREFILL_KEY))[PREFILL_KEY]||[];
      const live=Array.isArray(data)?data.filter(r=>r?.expires>Date.now()).slice(-19):[];
      await chrome.storage.session.set({[PREFILL_KEY]:[...live,{token,url,expires:Date.now()+60000}]});
      return token;
    });prefillQueue=task.catch(()=>{});
    task.then(token=>chrome.tabs.create({url:chrome.runtime.getURL('lists.html')+'#'+token})).catch(()=>{});
  });
}
