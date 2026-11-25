'use strict';
const $ = id => document.getElementById(id);
const typeLabel = type => ({teams:'Teams 已阻止',prompt:'链接已拦截',approved:'已允许',error:'规则异常'})[type]||'访问记录';
let savedName='未命名浏览器';
let loaded = false;
let renderSequence = 0;
async function setUi(changes) {
  const result=await LegUI.request({type:'save-ui',changes});
  if (!result?.ok) throw new Error('保存失败');
  return result.ui;
}
async function loadUi() {
  for(const id of ['showFloat','profileName','resetPosition'])$(id).disabled=true;
  try {
    const result=await LegUI.request({type:'get-ui'},{read:true});
    if (!result?.ok) throw new Error('offline');
    $('showFloat').checked=result.ui.show===true;
    savedName=result.ui.name||'未命名浏览器';
    $('profileName').value=savedName;
    loaded=true;
    for(const id of ['showFloat','profileName','resetPosition'])$(id).disabled=false;
    $('saveState').textContent='';
  } catch { loaded=false;$('saveState').textContent='无法读取设置，请重新打开弹窗'; }
}
$('showFloat').addEventListener('change',async()=>{
  if(!loaded) return;
  const selected=$('showFloat').checked;
  $('showFloat').disabled=true;
  try { await setUi({show:selected}); $('saveState').textContent=''; }
  catch { $('showFloat').checked=!selected; $('saveState').textContent='切换失败'; }
  finally{$('showFloat').disabled=false;}
});
async function saveName(){
  if(!loaded) return;
  const current=$('profileName').value.trim();
  if(current===savedName) return;
  try {
    const next=await setUi({name:current});
    savedName=next.name;
    const identity=$('profileIdentity');if(identity){identity.textContent=savedName;identity.title=savedName;}
    if ($('profileName').value.trim()===current) $('profileName').value=savedName;
    $('saveState').textContent='';
  } catch { if ($('profileName').value.trim()===current) $('profileName').value=savedName; $('saveState').textContent='保存失败'; }
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
  const seq=++renderSequence;
  try {
    const result=await LegUI.request({type:'get-status'},{read:true});
    if(seq!==renderSequence)return;
    if(result?.ok!==true || !Array.isArray(result.events)) throw new Error('backend');
    const healthy=result.ready===true&&result.listReady!==false&&document.getElementById('listState')?.dataset.kind!=='error';
    $('guardState').textContent=healthy?'ON':'异常';
    $('guardState').classList.toggle('unavailable',!healthy);
    $('teamsCount').textContent=String(result.events.filter(e=>e.type==='teams').length);
    $('externalCount').textContent=String(result.events.filter(e=>e.type==='prompt'||e.type==='approved').length);
    const container=$('events');container.replaceChildren();
    if(!result.ready){const warning=document.createElement('div');warning.className='entry';warning.textContent='保护异常，请重试或重新加载。'+(result.code?' '+result.code:'');container.appendChild(warning);}
    if(!result.events.length){const empty=document.createElement('div');empty.textContent='暂无记录';container.appendChild(empty);return;}
    for(const event of result.events.slice(0,25)) {
      const item=document.createElement('div');item.className='entry';
      const label=document.createElement('b');label.textContent=`${typeLabel(event.type)} · ${event.host||'未知域名'}`;
      const time=document.createElement('div');time.className='when';const reasons={'whitelist-auto':'白名单自动放行','confirmed-by-user':'手动确认','opened-incognito':'无痕打开','blacklist-spa':'黑名单 · 站内地址变化','allow-rule-removal-failed':'临时权限撤销失败','allow-rule-mismatch':'异常临时权限已撤销','rule-check-failed':'保护规则异常','page-click':'网页点击','network-or-manual-confirm':'访问前确认','after-recent-same-origin':'近期同源访问后再次确认','after-recent-cross-origin':'近期跨源访问后再次确认','automatic-loop-paused':'白名单多次自动打开已暂停','teams-click':'Teams 点击'};time.textContent=[new Date(event.at).toLocaleString(),reasons[event.reason]].filter(Boolean).join(' · ');
      item.append(label,time);container.appendChild(item);
    }
  } catch { if(seq!==renderSequence)return; $('guardState').textContent='异常';$('guardState').classList.add('unavailable');$('events').textContent='后台未响应'; }
}
$('clearLogs').addEventListener('click',async()=>{
  try {const result=await LegUI.request({type:'clear-events'});if(!result?.ok)throw new Error();await render();}
  catch {$('events').textContent='清除失败';}
});
if (typeof LegUI.watchProfile==='function') LegUI.watchProfile(name=>{
  const el=$('profileIdentity');if(!el)return;
  el.textContent=name||'名称读取失败';el.title=el.textContent;
});
Promise.all([loadUi(),render()]);

$('copyDiagnostics')?.addEventListener('click',async e=>{if(!e.isTrusted)return;const button=$('copyDiagnostics');button.disabled=true;try{const r=await LegUI.request({type:'diagnostics'},{read:true});await navigator.clipboard.writeText(JSON.stringify(r.diagnostics,null,2));$('diagState').textContent='已复制（不含网址和备注）';}catch{$('diagState').textContent='复制失败，请重试';}finally{button.disabled=false;}});
