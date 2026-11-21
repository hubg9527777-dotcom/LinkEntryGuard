'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
class Element {
  constructor() {
    this.textContent = '';
    this.children = [];
    this.handlers = {};
    this.classListValues = new Set();
    this.classList = {
      add: value => this.classListValues.add(value),
      remove: value => this.classListValues.delete(value),
      toggle: (value,on) => on ? this.classListValues.add(value) : this.classListValues.delete(value)
    };
  }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); return item; }
  replaceChildren() { this.children = []; this.textContent = ''; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
}
const ids = Object.fromEntries(
  ['guardState','teamsCount','externalCount','events','clearLogs'].map(id => [id,new Element()])
);
const html = fs.readFileSync(path.join(__dirname, '..','popup.html'), 'utf8');
assert.match(html, /id="guardState"/);
const document = {
  getElementById: id => ids[id],
  createElement: () => new Element()
};
let mode = 'success';
const chrome = { runtime: { sendMessage: async msg => {
  if (msg.type === 'clear-events') return {ok: mode !== 'clear-failed'};
  if (mode === 'offline') throw new Error('simulated worker offline');
  if (mode === 'bad-status') return {ok:false};
  return {ok:true,ready:true,events:[{type:'teams',host:'example.test',at:Date.now(),stage:'before-navigation'}]};
} } };
const ctx = vm.createContext({ document, chrome, Date, console });
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','popup.js'),'utf8'), ctx);
(async () => {
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ids.guardState.textContent,'ON');
  assert.equal(ids.teamsCount.textContent,'1');
  assert.ok(!ids.guardState.classListValues.has('unavailable'));
  mode = 'bad-status';
  await vm.runInContext('render()',ctx);
  assert.equal(ids.guardState.textContent,'异常');
  assert.ok(ids.guardState.classListValues.has('unavailable'));
  mode = 'offline';
  await vm.runInContext('render()',ctx);
  assert.match(ids.events.textContent,/后台未响应/);
  mode = 'clear-failed';
  await ids.clearLogs.handlers.click();
  assert.equal(ids.events.textContent,'清除失败');
  mode = 'success';
  await vm.runInContext('render()',ctx);
  assert.equal(ids.guardState.textContent,'ON');
  assert.ok(!ids.guardState.classListValues.has('unavailable'));
  console.log('PASS: popup health status, failed background response, failed log deletion and recovery.');
})().catch(e => { console.error(e); process.exitCode = 1; });
