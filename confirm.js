'use strict';
const $ = id => document.getElementById(id);
const buttons = [$('approve'),$('incognito'),$('cancel')];
const updateButtons = disabled => { for (const button of buttons) button.disabled = disabled; };
let target = '';
if (window.top !== window.self) {
  $('status').textContent = '无法在嵌入页面中确认。';
} else {
  const raw = location.hash.slice(1);
  try {
    const parsed = new URL(raw);
    if (!['https:','http:'].includes(parsed.protocol) || !parsed.hostname || raw.length > 1600) throw new Error('invalid');
    target = raw;
    $('domain').textContent = parsed.hostname;
    $('address').textContent = parsed.href;
    $('approve').disabled = false;
    $('incognito').disabled = false;
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
$('cancel').addEventListener('click',async()=>{
  updateButtons(true);
  try { await chrome.tabs.remove((await chrome.tabs.getCurrent()).id); }
  catch { location.replace('about:blank'); }
});
async function openLink(type) {
  if (!target) return;
  updateButtons(true);
  $('status').textContent = type==='confirm-incognito'?'正在打开无痕窗口…':'正在打开…';
  try {
    const response = await chrome.runtime.sendMessage({type,url:target});
    if (response?.ok !== true) throw new Error(response?.reason || '无法打开');
    $('status').textContent = '';
  } catch (error) {
    const reason = String(error?.message || '打开失败');
    $('status').textContent = reason.slice(0,100);
    updateButtons(false);
  }
}
$('approve').addEventListener('click',()=>openLink('confirm-visit'));
$('incognito').addEventListener('click',()=>openLink('confirm-incognito'));

