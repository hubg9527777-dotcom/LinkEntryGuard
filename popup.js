'use strict';
const $ = id => document.getElementById(id);
const typeLabel = type => ({ teams:'Teams 网页点击已阻止', prompt:'网页点击已拦截', approved:'本次访问已确认', error:'安全规则异常' })[type] || '访问记录';
async function render() {
  try {
    const result = await chrome.runtime.sendMessage({type:'get-status'});
    if (result?.ok !== true || !Array.isArray(result.events)) throw new Error('后台无响应');
    $('guardState').textContent = result.ready === true ? 'ON' : '异常';
    $('guardState').classList.toggle('unavailable',result.ready !== true);
    $('teamsCount').textContent = String(result.events.filter(e=>e.type==='teams').length);
    $('externalCount').textContent = String(result.events.filter(e=>e.type==='prompt' || e.type==='approved').length);
    const host = $('events'); host.replaceChildren();
    if (result.ready !== true) {
      const warn = document.createElement('div');
      warn.className = 'entry';
      warn.textContent = '请求前确认规则无法确认，静态兜底规则将尝试阻止网页加载。请重新加载插件。';
      host.appendChild(warn);
    }
    if (!result.events.length) {
      const empty = document.createElement('div'); empty.textContent='暂无记录（最多保留最近 100 条）。';
      host.appendChild(empty); return;
    }
    for (const entry of result.events.slice(0,25)) {
      const box = document.createElement('div'); box.className='entry';
      const name = document.createElement('b');
      name.textContent = `${typeLabel(entry.type)} · ${entry.host || '未知域名'}`;
      const time = document.createElement('div'); time.className='when';
      time.textContent = new Date(entry.at).toLocaleString();
      box.append(name,time);host.appendChild(box);
    }
  } catch {
    $('guardState').textContent='异常'; $('guardState').classList.add('unavailable');
    $('events').textContent='后台未响应，无法确认动态规则状态。请检查插件服务工作线程。';
  }
}
$('clearLogs').addEventListener('click',async()=>{
  try { const result=await chrome.runtime.sendMessage({type:'clear-events'});
    if (result?.ok!==true) throw new Error('clear failed'); await render(); }
  catch { $('events').textContent='清除失败'; }
});
render();
