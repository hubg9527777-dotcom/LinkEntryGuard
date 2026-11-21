'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const listeners = new Map();
const sent=[];
const elements = new Map();
const body={appendChild: element => elements.set(element.id,element)};
const document={
  baseURI:'https://teams.cloud.microsoft/v2/', body,
  documentElement:body,
  getElementById:id=>elements.get(id)||null,
  createElement:() => ({id:'',style:{},textContent:'',setAttribute(){},remove(){elements.delete(this.id)}})
};
const window={addEventListener:(type, callback)=>listeners.set(type,callback)};
const ctx=vm.createContext({window,document,URL,chrome:{runtime:{sendMessage:obj=>sent.push(obj)}},setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','teams-guard.js'),'utf8'),ctx);
function emit(type,href,extra={}) {
 const link={nodeType:1,matches:()=>true,getAttribute:n=>n==='href'?href:n==='data-href'?(extra.dataHref || null):null};
 const ev={type,button:0,key:'',composedPath:()=>[link],prevented:false,stopped:false,
  preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},stopPropagation(){this.stopped=true},...extra};
 const fn=listeners.get(type);
 assert.ok(fn);
 fn(ev);
 return ev;
}
assert.equal(emit('click','https://example.com').prevented,true);
assert.equal(emit('click','https://example.com',{ctrlKey:true}).prevented,true);
assert.equal(emit('auxclick','https://example.com',{button:1}).prevented,true);
assert.equal(emit('click','https://example.com',{button:2}).prevented,false);
assert.equal(emit('keydown','https://example.com',{key:'Enter'}).prevented,true);
assert.equal(emit('click','https://example.com',{button:0,shiftKey:true}).prevented,true);
assert.equal(emit('click','#channel').prevented,false);
assert.equal(emit('click','#',{dataHref:'https://dual.example/external'}).prevented,true,
  'placeholder href must not mask a real data-href');
assert.equal(emit('click','',{dataHref:'https://data-only.example/'}).prevented,true,
  'data-href without href must still be blocked');
assert.equal(emit('click','#channel',{dataHref:''}).prevented,false);
assert.equal(emit('mousedown','https://example.com').stopped,true);
assert.equal(emit('mousedown','https://example.com').prevented,false);
assert.equal(emit('click','blob:https://teams.cloud.microsoft/abcdef').prevented,true);
assert.equal(emit('click','data:text/html,hello').prevented,true);
assert.equal(emit('click','customscheme:launch').prevented,true);
assert.equal(emit('click','mailto:person@example.com').prevented,true);
assert.equal(sent.length,11);
assert.equal(sent[0].type,'teams-link-blocked');
console.log('PASS: Teams link click, Ctrl/Shift-click, middle-click, keyboard, context menu, hash link and mouse down behavior.');
