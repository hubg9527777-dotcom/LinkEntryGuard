'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
class Item {
  constructor(tag='div'){
    this.tagName=tag;this.children=[];this.handlers={};this.style={display:'',top:'0px',right:'110px',setProperty:(k,v)=>{this.style[k]=v}};
    this.offsetWidth=135;this.offsetHeight=30;this.classList={add:()=>{},remove:()=>{}};
    this.className='';this.attributes={};this.isConnected=false;this.value='';this.textContent='';
  }
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,handler){this.handlers[k]=handler;}
  appendChild(child){this.children.push(child);child.isConnected=true;return child;}
  append(...items){items.forEach(item=>this.appendChild(item));}
  replaceChildren(...items){this.children=items;}
  attachShadow(){this.shadow=new Item('shadow');return this.shadow;}
  focus(){this.focused=true;}
  select(){this.selected=true;}
  blur(){if(this.handlers.blur)this.handlers.blur();}
  setPointerCapture(){} releasePointerCapture(){}
}
const document={documentElement:new Item('html'),createElement:tag=>new Item(tag),addEventListener:()=>{}};
const winEvents={};const window={innerHeight:800,innerWidth:1200,addEventListener:(type,handler)=>{winEvents[type]=handler;}};window.top=window;
const stored={name:'工作浏览器',show:true,position:{top:0,right:110}};
const messages=[];
let listener;
const chrome={extension:{inIncognitoContext:false},runtime:{id:'leg-test',
  onMessage:{addListener:fn=>{listener=fn;}},
  sendMessage:async request=>{
    messages.push(request);
    if(request.type==='get-ui')return {ok:true,ui:{...stored}};
    if(request.type==='save-ui'){Object.assign(stored,request.changes);return {ok:true,ui:{...stored}};}
    throw new Error('unexpected message');
  }
}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','floating-label.js'),'utf8'),{
  window,document,chrome,console
});
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  const host=document.documentElement.children[0];
  assert.equal(host.style.display,'block');
  assert.ok(!fs.readFileSync(path.join(__dirname,'..','floating-label.js'),'utf8').includes('inIncognitoContext) return'), 'authorized incognito pages must not be skipped');
  const chip=host.shadow.children.find(item=>item.className==='chip');
  assert.equal(chip.children[1].textContent,'工作浏览器');
  assert.equal(chip.attributes['aria-label'].includes('工作浏览器'),true);
  chip.handlers.dblclick({isTrusted:false});
  assert.equal(chip.children[1].tagName,'span','synthetic double-click must not edit');
  chip.handlers.keydown({isTrusted:false,key:'F2',preventDefault(){}});
  assert.equal(chip.children[1].tagName,'span','synthetic keyboard events must not edit');
  chip.handlers.dblclick({isTrusted:true});
  const field=chip.children[1];
  assert.equal(field.tagName,'input');
  field.value='研究专用';
  field.handlers.blur();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stored.name,'研究专用','blur must persist the note');
  assert.equal(chip.children[1].textContent,'研究专用');
  assert.ok(messages.some(message=>message.type==='save-ui'));
  assert.equal(host.style.top,'0px');
  assert.equal(host.style.right,'110px');
  chip.handlers.pointerdown({isTrusted:true,button:0,pointerId:7,clientX:200,clientY:100});
  chip.handlers.pointermove({isTrusted:true,pointerId:7,clientX:165,clientY:120});
  chip.handlers.pointerup({isTrusted:true,pointerId:7,clientX:165,clientY:120});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(stored.position),JSON.stringify({top:20,right:145}),'drag must persist top/right offsets');
  assert.equal(host.style.top,'20px');
  assert.equal(host.style.right,'145px');
  // Dragging into the toolbar/bookmark-bar boundary must not restore the
  // previous offset. Chrome may cancel the pointer sequence at that boundary.
  chip.handlers.pointerdown({isTrusted:true,button:0,pointerId:10,clientX:165,clientY:120});
  chip.handlers.pointermove({isTrusted:true,pointerId:10,clientX:165,clientY:-100});
  assert.equal(host.style.top,'0px','drag cannot leave the top of the webpage');
  chip.handlers.pointercancel({pointerId:10});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(stored.position),JSON.stringify({top:0,right:145}),
    'pointer cancellation at the bookmark bar must save the last valid position');
  assert.equal(host.style.top,'0px','cancel cannot return to the previous location');
  // Chrome can also release pointer capture instead of delivering pointerup.
  chip.handlers.pointerdown({isTrusted:true,button:0,pointerId:11,clientX:165,clientY:60});
  chip.handlers.pointermove({isTrusted:true,pointerId:11,clientX:155,clientY:72});
  chip.handlers.lostpointercapture({pointerId:11});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(stored.position),JSON.stringify({top:12,right:155}),
    'lost pointer capture must save the last position');
  chip.handlers.pointerdown({isTrusted:true,button:0,pointerId:12,clientX:155,clientY:72});
  chip.handlers.pointermove({isTrusted:true,pointerId:12,clientX:145,clientY:68});
  winEvents.blur();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(stored.position),JSON.stringify({top:8,right:165}),
    'window blur must save, not revert, an active drag');
  // Right-hand viewport edge is also a clamped boundary, not a reset.
  chip.handlers.pointerdown({isTrusted:true,button:0,pointerId:13,clientX:145,clientY:70});
  chip.handlers.pointermove({isTrusted:true,pointerId:13,clientX:800,clientY:70});
  assert.equal(host.style.right,'0px','right edge must clamp instead of reset');
  chip.handlers.pointercancel({pointerId:13});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(JSON.stringify(stored.position),JSON.stringify({top:8,right:0}),
    'right edge must persist the clamped position');
  chip.handlers.pointerdown({isTrusted:false,button:0,pointerId:9,clientX:200,clientY:100});
  chip.handlers.pointermove({isTrusted:false,pointerId:9,clientX:0,clientY:0});
  assert.equal(JSON.stringify(stored.position),JSON.stringify({top:8,right:0}),'synthetic drag is rejected');
  listener({type:'leg-ui-changed',ui:{name:'研究专用',show:true,position:{top:0,right:110}}},{id:'leg-test'});
  assert.equal(host.style.top,'0px','popup reset must update the open page');
  assert.equal(host.style.right,'110px','popup reset must update the open page');
  listener({type:'leg-ui-changed',ui:{name:'研究专用',show:false,position:{top:0,right:110}}},{id:'leg-test'});
  assert.equal(host.style.display,'none','popup toggle should update open tabs');
  listener({type:'leg-ui-changed',ui:{name:'INJECTED',show:true,position:{top:0,right:110}}},{id:'foreign'});
  assert.equal(host.style.display,'none','foreign messages must not update badge');
  console.log('PASS: floating label drag boundaries, pointer cancel, lost capture, blur, double-click editing and state sync.');
})().catch(error=>{console.error(error);process.exitCode=1;});
