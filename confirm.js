'use strict';
const $ = id => document.getElementById(id);
const buttons = [$('approve'),$('incognito'),$('cancel')];
const updateButtons = disabled => { for (const button of buttons) button.disabled = disabled; };
let target = '', linkBusy=false;
if (window.top !== window.self) {
  updateButtons(true);
  $('status').textContent = '无法在嵌入页面中确认。';
} else {
  const raw = location.hash.slice(1);
  try {
    const parsed = new URL(raw);
    if (!['https:','http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || raw.length > 1600) throw new Error('invalid');
    target = raw;
    $('domain').textContent = parsed.hostname;
    $('address').textContent = parsed.href;
    // List state is checked before enabling navigation.
    if (!document.getElementById('listQuick')) { $('approve').disabled=false; $('incognito').disabled=false; }
    chrome.runtime.sendMessage({type:'confirm-seen',url:target}).catch(()=>{});
  } catch { $('status').textContent = '网址无效或过长'; }
  chrome.runtime.sendMessage({type:'get-ui'}).then(response => {
    if (response?.ok && typeof response.ui?.name==='string') {
      $('profileName').textContent = response.ui.name;
      // When enabled, the draggable chip above the panel already identifies
      // the Profile. Avoid showing the same name twice in the confirmation UI.
      $('profileName').hidden = response.ui.show === true;
    }
  }).catch(()=>{});
}
$('cancel').addEventListener('click',async event=>{
  if(window.top!==window.self||event?.isTrusted===false||linkBusy)return;
  updateButtons(true);
  try { await chrome.tabs.remove((await chrome.tabs.getCurrent()).id); }
  catch { location.replace('about:blank'); }
});
async function openLink(type, automatic=false) {
  if (window.top!==window.self||!target||location.hash.slice(1)!==target||linkBusy||(!automatic&&typeof quickReading!=='undefined'&&quickReading)||(!automatic&&typeof quickBusy!=='undefined'&&quickBusy)) return;
  linkBusy=true;updateButtons(true);
  $('status').textContent = type==='confirm-incognito'?'正在打开无痕窗口…':'正在打开…';
  try {
    const response = await LegUI.request({type,url:target,automatic:automatic===true});
    if (response?.ok !== true) throw new Error(response?.reason || '无法打开');
    $('status').textContent = '';
    // tabs.update/windows.create accepts a request, not proof of a loaded page.
    // If the confirmation document survives, restore an actionable UI.
    window.setTimeout?.(async()=>{
      if(!linkBusy)return;
      linkBusy=false;$('status').textContent='打开请求已发送，请核对结果';
      $('cancel').disabled=false;
      if(typeof refreshQuick==='function')await refreshQuick(false);
      else updateButtons(false);
    },4000);
  } catch (error) {
    const reason = String(error?.message || '打开失败');
    $('status').textContent = reason.slice(0,100);
    linkBusy=false;
    if (typeof refreshQuick === 'function') { $('cancel').disabled=false; await refreshQuick(false); }
    else updateButtons(false);
  }
}
$('approve').addEventListener('click',e=>{if(e?.isTrusted!==false&&!$('approve').disabled)return openLink('confirm-visit');});
$('incognito').addEventListener('click',e=>{if(e?.isTrusted!==false&&!$('incognito').disabled)return openLink('confirm-incognito');});


// A different fragment can reuse the same extension document. Never display
// or approve a previous target after an address change.
window.addEventListener?.('hashchange',()=>{if(window.top===window.self){updateButtons(true);location.reload();}});
