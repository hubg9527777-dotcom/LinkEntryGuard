'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
class Item {
  constructor() {
    this.children=[];this.isConnected=false;this.offsetWidth=132;this.offsetHeight=30;
    this.style={setProperty:(key,value)=>{this.style[key]=value},top:'0px',right:'110px'};
    this.classList={add(){},remove(){}};this.handlers={};this.attributes={};
    this.className='';this.textContent='';this.value='';
  }
  appendChild(child){this.children.push(child);child.isConnected=true;return child;}
  append(...elements){elements.forEach(e=>this.appendChild(e));}
  replaceChildren(...elements){this.children=elements;}
  attachShadow(){this.shadow = new Item();return this.shadow;}
  addEventListener(type,cb){this.handlers[type]=cb;}
  setAttribute(key,value){this.attributes[key]=value;}
  focus(){}select(){}setPointerCapture(){}releasePointerCapture(){}
}
class Observer {
  constructor(callback){this.callback=callback;Observer.all.push(this);}
  observe(target){this.target=target;}
  disconnect(){this.target=null;}
  fire(){this.callback([]);}
}
Observer.all=[];
const html=new Item();html.isConnected=true;
const document={documentElement:html,createElement:()=>new Item(),addEventListener(){}};
const window={innerWidth:1300,innerHeight:800,addEventListener(){}};window.top=window;
const note={name:'研究账号',show:true,position:{top:0,right:110}};
let listener;
const chrome={extension:{inIncognitoContext:true},runtime:{id:'own',onMessage:{addListener(fn){listener=fn;}},sendMessage:async req=>({ok:true,ui:note})}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','floating-label.js'),'utf8'),{window,document,chrome,MutationObserver:Observer,console});
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  const host=html.children[0];
  assert.equal(host.style.display,'block','authorized incognito/extension page shows note');
  const chip=host.shadow.children.find(child=>child.className==='chip');
  assert.equal(chip.children[1].textContent,'研究账号');
  // Emulate SPA removing the overlay root. Only an explicit reset can change position.
  html.children=[];host.isConnected=false;
  Observer.all.find(o=>o.target===html).fire();
  assert.equal(host.isConnected,true,'overlay should be remounted after direct DOM replacement');
  assert.equal(host.style.right,'110px');
  listener({type:'leg-ui-changed',ui:{name:'研究账号',show:false,position:{top:0,right:110}}},{id:'own'});
  assert.equal(host.style.display,'none','user can switch the note off');
  listener({type:'leg-ui-changed',ui:{name:'INJECTED',show:true,position:{top:-5,right:110}}},{id:'own'});
  assert.equal(host.style.display,'none','reject malformed broadcast positions');
  console.log('PASS: extension/authorized-incognito note, restoration after DOM removal, user-off and state validation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
