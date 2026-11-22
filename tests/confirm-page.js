'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ids=Object.fromEntries(['domain','address','approve','incognito','cancel','status','profileName'].map(key=>[key,{
  textContent:'',hidden:false,disabled:['approve','incognito'].includes(key),handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}
}]));
const document={getElementById:key=>ids[key]};
const target='https://www.google.com/search?q=teams#hash';
const location={hash:'#'+target,replace(url){this.replaced=url;}};
const window={};window.top=window;window.self=window;
const sent=[];
let result={ok:true};
const opened=[];
const chrome={runtime:{id:'test-extension',sendMessage:async message=>{sent.push(message);if(message.type==='get-ui')return {ok:true,ui:{name:'测试账号',show:true}};return result;}},tabs:{getCurrent:async()=>({id:10}),remove:async()=>{},create:async options=>{opened.push(options);}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','confirm.js'),'utf8'),{window,document,location,chrome,URL,console});
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ids.approve.disabled,false);
  assert.equal(ids.incognito.disabled,false);
  assert.equal(ids.domain.textContent,'www.google.com');
  assert.equal(ids.profileName.textContent,'测试账号');
  assert.equal(ids.profileName.hidden,true,'the confirmation page avoids duplicate labels when floating note is visible');
  await ids.incognito.handlers.click();
  assert.ok(sent.some(item=>item.type==='confirm-incognito'&&item.url===target));
  assert.equal(ids.incognito.disabled,true);
  result={ok:false,reason:'Chrome 当前不允许创建无痕窗口'};
  ids.incognito.disabled=false;
  await ids.incognito.handlers.click();
  assert.match(ids.status.textContent,/不允许创建无痕窗口/);
  assert.equal(ids.cancel.disabled,false,'failed navigation must not trap the user');
  console.log('PASS: confirmation page renders profile, offers distinct normal/incognito actions, restores buttons on errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
