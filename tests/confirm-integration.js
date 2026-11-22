'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const event = () => { const listeners=[];return {addListener:fn=>listeners.push(fn),emit:(...args)=>listeners.forEach(fn=>fn(...args))}; };
const installed = new Map(), session = new Map(), local = new Map(), tabs=new Map();
const actions=[], permissions=[], titles=[], uiBroadcasts=[];
const enabledRulesets = new Set(['failsafe']), disabledStaticIds = new Set();
let failSessionRuleRemoval = false;
let slowUiWrites = false;
let incognitoAllowed = true;
let incognitoPolicyDisabled = false;
let createReturnsTabs = true;
let failIncognitoTabQuery = false;
const storage = {local: {
  setAccessLevel:async obj=>{permissions.push(obj.accessLevel);},
  get:async k=>({[k]:local.get(k)}),
  set:async obj=>{if(slowUiWrites && Object.hasOwn(obj,'leg_ui'))await new Promise(done=>setTimeout(done,5));for(const [k,v] of Object.entries(obj))local.set(k,v);},
  remove:async k=>{local.delete(k);}
}};
const rtMessage=event(), committed=event(), removed=event();
const chrome = {
  storage, extension:{isAllowedIncognitoAccess:async()=>incognitoAllowed},
  windows:{create:async options=>{if(incognitoPolicyDisabled)throw new Error('Incognito mode is disabled');const id=900;const tab={id:909,windowId:900,url:options.url,incognito:true};tabs.set(909,tab);actions.push({type:'create-incognito',options});return !incognitoAllowed ? undefined : (createReturnsTabs ? {id,incognito:true,tabs:[tab]} : {id,incognito:true});},remove:async id=>{actions.push({type:'remove-window',id});}},
  runtime: {id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,
    sendMessage:async message=>{uiBroadcasts.push(message);return {ok:true};},
    onMessage:rtMessage,onInstalled:event(),onStartup:event()},
  declarativeNetRequest:{
    async getEnabledRulesets(){return Array.from(enabledRulesets);},
    async updateEnabledRulesets({enableRulesetIds=[]}){for(const id of enableRulesetIds)enabledRulesets.add(id);},
    async getDisabledRuleIds(){return Array.from(disabledStaticIds);},
    async updateStaticRules({enableRuleIds=[]}){for(const id of enableRuleIds)disabledStaticIds.delete(id);},
    async getDynamicRules(){return Array.from(installed.values());},
    async updateDynamicRules({removeRuleIds=[],addRules=[]}) {for(const id of removeRuleIds)installed.delete(id);for(const r of addRules)installed.set(r.id,r);},
    async getSessionRules(){return Array.from(session.values());},
    async updateSessionRules({removeRuleIds=[],addRules=[]}) {if(failSessionRuleRemoval && removeRuleIds.length)throw new Error('injected deletion failure');for(const id of removeRuleIds)session.delete(id);for(const r of addRules)session.set(r.id,r);},
    async isRegexSupported({regex}) {try{new RegExp(regex);return {isSupported:true};}catch{return {isSupported:false};}}
  },
  tabs:{onRemoved:removed,
    async query(options={}){if(options.windowId!==undefined && failIncognitoTabQuery)throw new Error('injected tab lookup failure');return Array.from(tabs.values()).filter(t=>options.windowId===undefined || t.windowId===options.windowId);},
    async sendMessage(){return {ok:true};},
    async remove(id){tabs.delete(id);actions.push({type:'remove-tab',id});},
    async get(id){if(!tabs.has(id))throw new Error('missing tab');return tabs.get(id);},
    async update(id,{url}){if(!tabs.has(id))throw new Error('missing tab');const t=tabs.get(id);t.url=url;actions.push({type:'update',id,url});return t;},
    async create({url}) {const id=tabs.size+100;const tab={id,url};tabs.set(id,tab);actions.push({type:'create',id,url});return tab;}
  },
  webNavigation:{onCommitted:committed},
  alarms:{onAlarm:event(),create:async()=>{}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async arg=>{titles.push(arg.title);}}
};
const ctx=vm.createContext({chrome,console,URL,Date,Promise,setTimeout,clearTimeout,importScripts:()=>{}});
vm.runInContext(fs.readFileSync(path.join(root,'policy.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),ctx);
const pause=async()=>new Promise(r=>setTimeout(r,15));
const send=(request,sender)=>new Promise(resolve=>{
  let settled=false;
  const keep=rtMessage.emit(request,sender,result=>{settled=true;resolve({handled:true,result});});
  setTimeout(()=>{if(!settled) resolve({handled:false});},25);
});
(async()=>{
  await pause();
  assert.equal(permissions[0],'TRUSTED_CONTEXTS','logs must be private');
  const global = installed.get(1);
  assert.equal(global.action.type,'redirect');
  assert.equal(global.priority,10);
  assert.equal(global.condition.resourceTypes[0],'main_frame');
  assert.ok(global.action.redirect.regexSubstitution.endsWith('\\0'));
  const parsedManifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(parsedManifest.version,'1.0.1');
  assert.ok(parsedManifest.permissions.includes('declarativeNetRequest'));
  assert.ok(parsedManifest.web_accessible_resources[0].resources.includes('confirm.html'));
  const fallback=JSON.parse(fs.readFileSync(path.join(root,'rules','failsafe.json'),'utf8'))[0];
  assert.equal(fallback.action.type,'block');
  assert.ok(global.priority>fallback.priority,'redirect must override failsafe block');

  const target='https://www.google.com/search?q=teams%20url#section';
  const confirm='chrome-extension://test-extension/confirm.html#'+target;
  tabs.set(1,{id:1,url:confirm});
  const sender={id:'test-extension',tab:{id:1},url:confirm,frameId:0};
  assert.equal((await send({type:'confirm-visit',url:'https://evil.example/'},sender)).handled,false);
  assert.equal(session.size,0,'sender must not whitelist arbitrary URL');
  assert.equal((await send({type:'confirm-visit',url:target},{...sender,id:'foreign'})).handled,false);
  assert.equal((await send({type:'confirm-visit',url:target},{...sender,frameId:1})).handled,false);
  const approved=await send({type:'confirm-visit',url:target},sender);
  assert.equal(approved.result.ok,true,'genuine confirmation must open requested URL');
  assert.equal(actions.at(-1).url,target);
  const [grant]=Array.from(session.values());
  assert.equal(grant.action.type,'allow');
  assert.ok(grant.priority>global.priority);
  assert.equal(grant.condition.tabIds[0],1);
  assert.equal(grant.condition.isUrlFilterCaseSensitive,true,'grant must not authorize case-altered paths or tokens');
  assert.ok(new RegExp(grant.condition.regexFilter).test('https://www.google.com/search?q=teams%20url'),
    'URL fragments must not prevent one-time allow');
  assert.ok(!new RegExp(grant.condition.regexFilter).test('https://www.google.com/phish'));
  assert.ok(!new RegExp(grant.condition.regexFilter).test('https://wwwXgoogle.com/search?q=teams%20url'));
  failSessionRuleRemoval = true;
  committed.emit({tabId:1,frameId:0,url:target});
  await pause();
  assert.equal(session.size,1,'failed grant removal must not be reported as successful');
  const popupSender={id:'test-extension',url:'chrome-extension://test-extension/popup.html'};
  const brokenStatus=await send({type:'get-status'},popupSender);
  assert.equal(brokenStatus.result.ready,false,'active failed removal must be reported as unhealthy');
  assert.ok(brokenStatus.result.error,'reason must be visible');
  failSessionRuleRemoval = false;
  chrome.alarms.onAlarm.emit({name:'leg-expire-grants'});
  await pause();
  assert.equal(session.size,0,'allow rule must be revoked after top-level commit');
  assert.ok(installed.has(1),'global protection must remain in place');

  const ui=await send({type:'get-ui'},popupSender);
  assert.equal(ui.result.ui.show,true);
  assert.equal(ui.result.ui.name,'未命名浏览器');
  assert.equal(ui.result.ui.position.top,0);
  assert.equal(ui.result.ui.position.right,110);
  assert.equal((await send({type:'save-ui',changes:{show:true,name:'测试 Profile'}},popupSender)).result.ok,true);
  assert.ok(titles.some(x=>x.includes('测试 Profile')), 'native toolbar tooltip should contain current Profile note');
  assert.ok(uiBroadcasts.some(x=>x.type==='leg-ui-changed' && x.ui.name==='测试 Profile'), 'extension-owned confirmation page must receive settings broadcast');
  assert.equal((await send({type:'get-ui'},popupSender)).result.ui.name,'测试 Profile');
  // Concurrent popup toggle + floating-note edit must not lose either field.
  await send({type:'save-ui',changes:{show:false,name:'并发前'}},popupSender);
  slowUiWrites = true;
  const simultaneous = await Promise.all([
    send({type:'save-ui',changes:{show:true}},popupSender),
    send({type:'save-ui',changes:{name:'隔离账户'}},popupSender)
  ]);
  slowUiWrites = false;
  assert.ok(simultaneous.every(x=>x.result?.ok));
  const afterSimultaneous=(await send({type:'get-ui'},popupSender)).result.ui;
  assert.equal(afterSimultaneous.show,true,'concurrent name edit must not revert visibility');
  assert.equal(afterSimultaneous.name,'隔离账户','concurrent toggle must not overwrite note');
  assert.equal((await send({type:'save-ui',changes:{show:false}},{id:'test-extension',tab:{id:2},url:'https://example.com/dashboard',frameId:0})).handled,false,'page cannot toggle badge');
  tabs.set(50,{id:50,url:confirm});
  const incognitoSender={...sender,tab:{id:50}};
  const privateResult=await send({type:'confirm-incognito',url:target},incognitoSender);
  assert.equal(privateResult.result.ok,true,'incognito must be explicitly approved');
  assert.ok(actions.some(a=>a.type==='create-incognito'&&a.options.url==='about:blank'), 'target must not load in windows.create before grant');
  assert.ok(actions.some(a=>a.type==='update'&&a.id===909&&a.url===target), 'navigate only after incognito grant');
  assert.ok(session.size>=1, 'incognito one-time grant must be present');
  assert.equal(tabs.get(50).url,'about:blank', 'existing source tab must not be destroyed');
  committed.emit({tabId:909,frameId:0,url:target});
  await pause();
  assert.equal(session.size,0,'incognito approval must also be revoked after commit');
  // Some Chromium builds return a Window object without populated tabs.
  // The extension must recover the new tab by windowId.
  createReturnsTabs = false;
  tabs.set(52,{id:52,url:confirm});
  const recovered = await send({type:'confirm-incognito',url:target},{...sender,tab:{id:52}});
  assert.equal(recovered.result.ok,true,'incognito tab fallback must succeed');
  assert.ok(actions.some(a=>a.type==='update'&&a.id===909&&a.url===target));
  committed.emit({tabId:909,frameId:0,url:target});
  await pause();
  // An unavailable window tab list must fail closed and clean up the blank window.
  failIncognitoTabQuery = true;
  tabs.set(53,{id:53,url:confirm});
  const failedRecovery = await send({type:'confirm-incognito',url:target},{...sender,tab:{id:53}});
  assert.equal(failedRecovery.result.ok,false);
  assert.ok(actions.some(a=>a.type==='remove-window'&&a.id===900));
  failIncognitoTabQuery = false;
  createReturnsTabs = true;

  tabs.set(51,{id:51,url:confirm});
  incognitoAllowed=false;
  const countBefore=actions.filter(a=>a.type==='create-incognito').length;
  const grantedBefore=session.size;
  const openedWithoutAccess=await send({type:'confirm-incognito',url:target},{...sender,tab:{id:51}});
  assert.equal(openedWithoutAccess.result.ok,true,'incognito launch must work without extension access');
  assert.equal(actions.filter(a=>a.type==='create-incognito').length,countBefore+1);
  const latestLaunch=actions.filter(a=>a.type==='create-incognito').at(-1);
  assert.equal(latestLaunch.options.url,target,'without incognito access Chrome opens approved URL directly');
  assert.equal(session.size,grantedBefore,'must not invent an inaccessible incognito tab grant');
  assert.equal(tabs.get(51).url,'about:blank','source confirm tab stays protected');
  incognitoAllowed=false;
  incognitoPolicyDisabled=true;
  tabs.set(54,{id:54,url:confirm});
  const blockedByPolicy=await send({type:'confirm-incognito',url:target},{...sender,tab:{id:54}});
  assert.equal(blockedByPolicy.result.ok,false,'Chrome policy denial must be reported');
  assert.match(blockedByPolicy.result.reason,/不允许创建无痕窗口/);
  assert.equal(tabs.get(54).url,confirm,'policy denial must keep original confirmation page');
  incognitoPolicyDisabled=false;
  incognitoAllowed=true;
  assert.equal((await send({type:'confirm-incognito',url:target},{...sender,tab:{id:51},id:'foreign'})).handled,false,'foreign sender must be rejected');
  const uiAfter=await send({type:'save-ui',changes:{name:'<img src=x onerror=alert(1)>'}},popupSender);
  assert.equal(uiAfter.result.ui.name.length<=24,true,'profile note length must be limited');
  assert.equal((await send({type:'save-ui',changes:{role:'admin'}},popupSender)).handled,false);
  const tabSender={id:'test-extension',tab:{id:2},url:'https://example.com/dashboard',frameId:0};
  const moved=await send({type:'save-ui',changes:{position:{top:2,right:145}}},tabSender);
  assert.equal(moved.result.ok,true,'dragged position must save');
  assert.equal((await send({type:'get-ui'},popupSender)).result.ui.position.right,145);
  assert.equal((await send({type:'save-ui',changes:{position:{top:-1,right:20}}},tabSender)).result.ok,false,'negative position must be rejected');
  assert.equal((await send({type:'save-ui',changes:{position:{top:0,right:20000}}},tabSender)).result.ok,false,'oversized position must be rejected');

  tabs.set(2,{id:2,url:'https://example.com/dashboard'});
  const pageSender={id:'test-extension',tab:{id:2},url:tabs.get(2).url,frameId:0};
  const click=await send({type:'click-guard',url:'https://example.com/path',newTab:true},pageSender);
  assert.equal(click.result.ok,true);
  assert.equal(tabs.get(2).url,'https://example.com/dashboard','original page should remain unchanged');
  assert.ok(actions.at(-1).url.startsWith('chrome-extension://test-extension/confirm.html#'));
  assert.equal((await send({type:'click-guard',url:'javascript:alert(1)',newTab:true},pageSender)).handled,false);

  const oldGrantId=10008;
  session.set(oldGrantId,{id:oldGrantId,action:{type:'allow'},condition:{tabIds:[99]}});
  chrome.alarms.onAlarm.emit({name:'leg-expire-grants'});
  await pause();
  assert.equal(session.has(oldGrantId),false,'orphan grants must be removed');

  // A disabled static failsafe must be restored before ON is claimed.
  enabledRulesets.delete('failsafe'); disabledStaticIds.add(1);
  const status=await send({type:'get-status'},popupSender);
  assert.equal(status.result.ready,true);
  assert.ok(enabledRulesets.has('failsafe'));
  assert.equal(disabledStaticIds.has(1),false);
  assert.equal(status.result.guards[0],true);
  assert.equal(status.result.guards[1],true);
  installed.set(1,{id:1, priority:10,action:{type:'allow'},condition:{}});
  const repaired=await send({type:'get-status'},popupSender);
  assert.equal(repaired.result.ready,true);
  assert.equal(installed.get(1).action.type,'redirect','altered dynamic rule must be repaired');
  const log=JSON.stringify(local.get('leg_events'));
  assert.ok(!log.includes('teams%20url'),'logs must not persist URL paths');
  assert.ok(!log.includes('#section'),'logs must not persist URL fragments');
  assert.equal((await send({type:'get-status'},pageSender)).handled,false);
  assert.equal((await send({type:'clear-events'},pageSender)).handled,false);
  assert.equal((await send({type:'clear-events'},popupSender)).result.ok,true);
  await pause(); assert.equal(local.has('leg_events'),false);
  console.log('PASS: persisted intercept rule, fail-safe, one-time confirmation, exact URL, cleanup, source authorization, log privacy.');
})().catch(e=>{console.error(e);process.exitCode=1;});
