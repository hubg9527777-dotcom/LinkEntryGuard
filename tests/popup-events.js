'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
class Element {
  constructor(){this.textContent='';this.value='';this.checked=false;this.children=[];this.handlers={};this.classListValues=new Set();this.classList={add:v=>this.classListValues.add(v),remove:v=>this.classListValues.delete(v),toggle:(v,on)=>on?this.classListValues.add(v):this.classListValues.delete(v)};}
  append(...items){this.children.push(...items);}
  appendChild(item){this.children.push(item);return item;}
  replaceChildren(){this.children=[];this.textContent='';}
  addEventListener(type,handler){this.handlers[type]=handler;}
}
const ids=Object.fromEntries(['guardState','teamsCount','externalCount','events','clearLogs','showFloat','profileName','saveState','resetPosition'].map(id=>[id,new Element()]));
const document={getElementById:id=>ids[id],createElement:()=>new Element()};
let offline=false,failSave=false;
const saved={name:'工作专用',show:false,position:{top:35,right:230}};
const chrome={runtime:{sendMessage:async msg=>{
  if(offline)throw new Error('offline');
  if(msg.type==='get-ui')return {ok:true,ui:{...saved}};
  if(msg.type==='save-ui'){
    if(failSave)return {ok:false};
    Object.assign(saved,msg.changes);
    if(!saved.name.trim())saved.name='未命名浏览器';
    return {ok:true,ui:{...saved}};
  }
  if(msg.type==='get-status')return {ok:true,ready:true,events:[{type:'teams',host:'example.test',at:Date.now()}]};
  if(msg.type==='clear-events')return {ok:true};
}}};
const context=vm.createContext({document,chrome,console,Date,Promise});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','popup.js'),'utf8'),context);
(async()=>{
  await new Promise(r=>setImmediate(r));
  assert.equal(ids.guardState.textContent,'ON');
  assert.equal(ids.profileName.value,'工作专用');
  assert.equal(ids.showFloat.checked,false);
  ids.showFloat.checked=true;
  await ids.showFloat.handlers.change();
  assert.equal(saved.show,true);
  ids.profileName.value='账号 2';
  await ids.profileName.handlers.blur();
  assert.equal(saved.name,'账号 2');
  await ids.resetPosition.handlers.click();
  assert.equal(JSON.stringify(saved.position),JSON.stringify({top:0,right:110}),'reset button restores exact initial position');
  assert.equal(ids.saveState.textContent,'位置已重置');
  assert.equal(ids.resetPosition.disabled,false);
  saved.position={top:40,right:220};
  failSave=true;
  await ids.resetPosition.handlers.click();
  assert.equal(JSON.stringify(saved.position),JSON.stringify({top:40,right:220}),'failed reset keeps the saved position');
  assert.equal(ids.saveState.textContent,'重置失败');
  assert.equal(ids.resetPosition.disabled,false);
  ids.showFloat.checked=false;
  await ids.showFloat.handlers.change();
  assert.equal(ids.showFloat.checked,true,'failed toggle must revert');
  assert.equal(saved.show,true);
  offline=true;
  await vm.runInContext('render()',context);
  assert.equal(ids.guardState.textContent,'异常');
  console.log('PASS: popup toggle, per-profile note editing on blur, failures roll back, protection status visible.');
})().catch(error=>{console.error(error);process.exitCode=1;});
