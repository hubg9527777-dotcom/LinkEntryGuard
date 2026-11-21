'use strict';
const $ = id => document.getElementById(id);
let target = '';
if (window.top !== window.self) {
  $('status').textContent = '安全限制：确认页不能在嵌入框架中使用。';
} else {
  const raw = location.hash.slice(1);
  try {
    const parsed = new URL(raw);
    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || raw.length > 1600) {
      throw new Error('invalid target');
    }
    target = raw;
    $('domain').textContent = parsed.hostname;
    $('address').textContent = parsed.href;
    $('approve').disabled = false;
    chrome.runtime.sendMessage({type:'confirm-seen',url:target}).catch(() => {});
  } catch { $('status').textContent = '网址无效或过长。已拒绝访问。'; }
}
$('cancel').addEventListener('click', async () => {
  $('approve').disabled = true;
  $('cancel').disabled = true;
  // Cancelling must never navigate to the requested website.
  try { await chrome.tabs.remove((await chrome.tabs.getCurrent()).id); }
  catch { location.replace('about:blank'); }
});
$('approve').addEventListener('click', async () => {
  if (!target) return;
  $('approve').disabled = true;
  $('cancel').disabled = true;
  $('status').textContent = '正在确认并打开本次网址…';
  try {
    const response = await chrome.runtime.sendMessage({type:'confirm-visit',url:target});
    if (response?.ok !== true) throw new Error(response?.reason || '无法完成单次放行');
  } catch (error) {
    $('status').textContent = String(error.message || '打开失败，请重试').slice(0,180);
    $('approve').disabled = false;
    $('cancel').disabled = false;
  }
});
