'use strict';
// Regression: if storage isolation fails, content scripts must not receive new history logs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const listeners = () => ({addListener() {}});
let logWrites = 0, logRemoved = false;
const chrome = {
  runtime: {id:'test-ext',getURL:p=>'chrome-extension://test-ext/'+p,onInstalled:listeners(),onStartup:listeners(),onMessage:listeners()},
  storage: {local:{
    async setAccessLevel(){throw new Error('injected privacy isolation failure');},
    async get(){return {};},
    async set(obj){if(Object.hasOwn(obj,'leg_events')) logWrites++;},
    async remove(k){if(k==='leg_events') logRemoved=true;}
  }},
  declarativeNetRequest: {
    async getDynamicRules(){return [];},
    async updateDynamicRules(){},
    async getEnabledRulesets(){return ['failsafe'];},
    async getDisabledRuleIds(){return [];},
    async getSessionRules(){return [];},
    async updateSessionRules(){},
  },
  tabs:{onRemoved:listeners()},webNavigation:{onCommitted:listeners()},
  alarms:{onAlarm:listeners(),async create(){}},
  action:{async setBadgeBackgroundColor(){},async setBadgeText(){}}
};
const quiet={log(){},warn(){},error(){}};
const context = vm.createContext({chrome,URL,Date,Promise,console:quiet,setTimeout,clearTimeout,importScripts(){}});
vm.runInContext(fs.readFileSync(path.join(base,'policy.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),context);
(async()=>{
  await new Promise(done=>setTimeout(done,40));
  assert.equal(logWrites,0,'no navigation history may be stored when isolation fails');
  assert.equal(logRemoved,true,'previously stored log history must be purged if isolation fails');
  console.log('PASS: privacy isolation failure disables log writes and removes prior log records.');
})().catch(error=>{console.error(error);process.exitCode=1});
