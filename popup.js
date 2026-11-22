'use strict';
const $ = id => document.getElementById(id);
const typeLabel = type => ({teams:'Teams 已阻止',prompt:'链接已拦截',approved:'已允许',error:'规则异常'})[type]||'访问记录';
let savedName='未命名浏览器';
let loaded = false;
async function setUi(changes) {
  const result=await chrome.runtime.sendMessage({type:'save-ui',changes});
  if (!result?.ok) throw new Error('保存失败');
  return result.ui;
}
async function loadUi() {
  try {
    const result=await chrome.runtime.sendMessage({type:'get-ui'});
    if (!result?.ok) throw new Error('offline');
    $('showFloat').checked=result.ui.show===true;
    savedName=result.ui.name||'未命名浏览器';
    $('profileName').value=savedName;
    loaded=true;
  } catch { $('saveState').textContent='无法读取设置'; }
}
$('showFloat').addEventListener('change',async()=>{
  if(!loaded) return;
  const selected=$('showFloat').checked;
  try { await setUi({show:selected}); $('saveState').textContent=''; }
  catch { $('showFloat').checked=!selected; $('saveState').textContent='切换失败'; }
});
async function saveName(){
  if(!loaded) return;
  const current=$('profileName').value.trim();
  if(current===savedName) return;
  try {
    const next=await setUi({name:current});
    savedName=next.name;
    $('profileName').value=savedName;
    $('saveState').textContent='';
  } catch { $('profileName').value=savedName; $('saveState').textContent='保存失败'; }
}
const DEFAULT_POSITION = {top:0,right:110};
$('resetPosition').addEventListener('click',async()=>{
  if(!loaded) return;
  const button=$('resetPosition');
  button.disabled=true;
  try {
    await setUi({position:{...DEFAULT_POSITION}});
    $('saveState').textContent='位置已重置';
  } catch {
    $('saveState').textContent='重置失败';
  } finally {
    button.disabled=false;
  }
});
$('profileName').addEventListener('blur',saveName);
$('profileName').addEventListener('keydown',event=>{if(event.key==='Enter')event.target.blur();});
async function render() {
  try {
    const result=await chrome.runtime.sendMessage({type:'get-status'});
    if(result?.ok!==true || !Array.isArray(result.events)) throw new Error('backend');
    $('guardState').textContent=result.ready?'ON':'异常';
    $('guardState').classList.toggle('unavailable',result.ready!==true);
    $('teamsCount').textContent=String(result.events.filter(e=>e.type==='teams').length);
    $('externalCount').textContent=String(result.events.filter(e=>e.type==='prompt'||e.type==='approved').length);
    const container=$('events');container.replaceChildren();
    if(!result.ready){const warning=document.createElement('div');warning.className='entry';warning.textContent='保护规则异常，请重新加载插件。';container.appendChild(warning);}
    if(!result.events.length){const empty=document.createElement('div');empty.textContent='暂无记录';container.appendChild(empty);return;}
    for(const event of result.events.slice(0,25)) {
      const item=document.createElement('div');item.className='entry';
      const label=document.createElement('b');label.textContent=`${typeLabel(event.type)} · ${event.host||'未知域名'}`;
      const time=document.createElement('div');time.className='when';time.textContent=new Date(event.at).toLocaleString();
      item.append(label,time);container.appendChild(item);
    }
  } catch { $('guardState').textContent='异常';$('guardState').classList.add('unavailable');$('events').textContent='后台未响应'; }
}
$('clearLogs').addEventListener('click',async()=>{
  try {const result=await chrome.runtime.sendMessage({type:'clear-events'});if(!result?.ok)throw new Error();await render();}
  catch {$('events').textContent='清除失败';}
});
Promise.all([loadUi(),render()]);
