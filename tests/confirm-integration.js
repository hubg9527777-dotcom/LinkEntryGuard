'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const event = () => { const listeners=[];return {addListener:fn=>listeners.push(fn),emit:(...args)=>listeners.forEach(fn=>fn(...args))}; };
const installed = new Map(), session = new Map(), local = new Map(), tabs=new Map();
const actions=[], permissions=[];
const enabledRulesets = new Set(['failsafe']), disabledStaticIds = new Set();
let failSessionRuleRemoval = false;
const storage = {local: {
  setAccessLevel:async obj=>{permissions.push(obj.accessLevel);},
  get:async k=>({[k]:local.get(k)}),
  set:async obj=>{for(const [k,v] of Object.entries(obj))local.set(k,v);},
  remove:async k=>{local.delete(k);}
}};
const rtMessage=event(), committed=event(), removed=event();
const chrome = {
  storage, runtime: {id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,
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
    async get(id){if(!tabs.has(id))throw new Error('missing tab');return tabs.get(id);},
    async update(id,{url}){if(!tabs.has(id))throw new Error('missing tab');const t=tabs.get(id);t.url=url;actions.push({type:'update',id,url});return t;},
    async create({url}) {const id=tabs.size+100;const tab={id,url};tabs.set(id,tab);actions.push({type:'create',id,url});return tab;}
  },
  webNavigation:{onCommitted:committed},
  alarms:{onAlarm:event(),create:async()=>{}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}
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
  assert.equal(parsedManifest.version,'1.0.0');
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
