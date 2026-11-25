'use strict';
// Loaded only in trusted extension UI. No list contents sent to web scripts.
const L = id => document.getElementById(id);
const inConfirm = location.pathname.endsWith('/confirm.html');
let quickUrl = '', quickDialog = false, quickBusy = false, quickMatches=[], quickSequence=0, quickReading=false, autoTried=false, noteDirty=false;
const retryList=L('retryList');
const listNames = {none:'当前浏览器 · 访问前确认',white:'白名单 · 当前浏览器自动打开',black:'黑名单 · 当前浏览器阻止访问'};
function safeQuickUrl(raw) {
  try {const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&raw.length<=1600?raw:'';}catch{return '';}
}
async function getQuickUrl() {
  if(inConfirm) return safeQuickUrl(location.hash.slice(1));
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  let url=tab?.url||'';
  const prefix=chrome.runtime.getURL('confirm.html')+'#';
  if(url.startsWith(prefix)) url=url.slice(prefix.length);
  return safeQuickUrl(url);
}
function fillScope() {
  noteDirty=false;
  const rule=quickMatches.find(r=>r.scope===L('listScope').value);
  L('listNote').value=rule?.note||'';
  L('addWhite').textContent=rule?.kind==='white'?'保存白名单':rule?'转为白名单':'加入白名单';
  L('addBlack').textContent=rule?.kind==='black'?'保存黑名单':rule?'转为黑名单':'加入黑名单';
  L('addWhite').title='允许在当前浏览器自动打开';L('addBlack').title='禁止在当前浏览器访问，黑名单优先';
}
L('listScope').addEventListener('change',fillScope);
L('listNote').addEventListener('input',()=>{noteDirty=true;});
function renderQuick(result) {
  const hint=inConfirm?L('navigationHint'):null;
  if(hint){const text=result.recentVisit==='same-origin'?'当前标签页刚请求打开同一网站。为防止新的独立访问被误放行，此网址仍需按名单规则核验。':result.recentVisit==='cross-origin'?'当前标签页刚请求打开其他网站。此网址与之前不同源，按当前浏览器规则重新核验。':'';hint.textContent=text;hint.hidden=!text;}
  quickMatches=result.matches||[];
  const draft=noteDirty?L('listNote').value:null;
  fillScope();
  if(draft!==null){L('listNote').value=draft;noteDirty=true;}
  const state=L('listState');state.textContent=listNames[result.kind]||'名单异常';state.dataset.kind=result.kind;
  const box=L('listMatches');box.replaceChildren();
  for(const rule of result.matches||[]) {
    const row=document.createElement('div');row.className='matchRow';
    const name=document.createElement('span');name.textContent=(rule.kind==='black'?'黑名单':'白名单')+' · '+(({site:'整个网站',path:'指定目录',url:'当前网址'})[rule.scope])+(rule.note?' · '+rule.note:'');
    const remove=document.createElement('button');remove.type='button';remove.className='textButton';remove.textContent='移除';remove.title='移除当前浏览器的此条规则；其他匹配规则仍然有效';
    remove.addEventListener('click',event=>{if(event.isTrusted)editQuick({op:'delete',key:rule.scope+'|'+rule.url});});
    row.append(name,remove);box.append(row);
  }
  L('listControls').hidden=false;
  if(retryList)retryList.hidden=true;
  if(inConfirm){const block=result.kind==='black'||!quickUrl;L('approve').disabled=block;L('incognito').disabled=block;L('cancel').disabled=false;}
}
function quickFailure(e,label='名单读取失败'){
  const hint=inConfirm?L('navigationHint'):null;if(hint){hint.hidden=true;hint.textContent='';}
  L('listState').textContent=label;L('listState').dataset.kind='error';
  L('listFeedback').textContent=(e?.message||'请重试')+(e?.code?' · '+e.code:'');
  L('listControls').hidden=true;L('listMatches').replaceChildren();
  if(retryList)retryList.hidden=false;
  if(inConfirm){L('approve').disabled=true;L('incognito').disabled=true;L('cancel').disabled=false;}
  else {const badge=L('guardState');if(badge){badge.textContent='异常';badge.classList.add('unavailable');}}
}
async function refreshQuick(auto,force=false) {
  if(quickDialog||quickBusy||quickReading||(inConfirm&&typeof linkBusy!=='undefined'&&linkBusy))return;
  const seq=++quickSequence;quickReading=true;
  if(retryList)retryList.disabled=true;
  L('addWhite').disabled=true;L('addBlack').disabled=true;
  if(inConfirm){L('approve').disabled=true;L('incognito').disabled=true;}
  try {
    const nextUrl=await getQuickUrl();
    if(nextUrl!==quickUrl)noteDirty=false;
    quickUrl=nextUrl;
    if(!quickUrl){quickMatches=[];L('listFeedback').textContent='';L('listState').dataset.kind='none';L('listState').textContent='当前页不支持名单';L('listControls').hidden=true;L('listMatches').replaceChildren();if(retryList)retryList.hidden=true;return;}
    const result=await LegUI.request({type:'list-status',url:quickUrl},{read:true});
    if(seq!==quickSequence)return;
    if(!['none','black','white'].includes(result.kind)||!Array.isArray(result.matches))throw new Error('名单响应异常');
    L('listFeedback').textContent='';renderQuick(result);
    if(inConfirm&&auto&&!autoTried&&result.kind==='white'){
      autoTried=true;quickReading=false;await openLink('confirm-visit',true);
    }
  }catch(e){if(seq===quickSequence)quickFailure(e);}
  finally{if(seq===quickSequence){quickReading=false;L('addWhite').disabled=false;L('addBlack').disabled=false;if(retryList)retryList.disabled=false;}}
  if(!inConfirm&&typeof render==='function'){await render();if(force&&typeof loadUi==='function'&&typeof loaded!=='undefined'&&!loaded)await loadUi();}
}
if(retryList)retryList.addEventListener('click',e=>{if(e.isTrusted)refreshQuick(false,true);});
async function editQuick(message) {
  if((inConfirm&&window.top!==window.self)||quickBusy||quickReading||!quickUrl||(inConfirm&&typeof linkBusy!=='undefined'&&linkBusy))return;
  quickBusy=true;L('addWhite').disabled=true;L('addBlack').disabled=true;
  if(inConfirm){L('approve').disabled=true;L('incognito').disabled=true;}
  try {
    const r=await LegUI.request({type:'list-edit',url:quickUrl,expectedMatches:quickMatches,...message});
    if(!r?.ok)throw new Error(r?.reason||'保存失败');
    noteDirty=false;renderQuick(r);L('listFeedback').textContent='当前浏览器名单已更新';
    fillScope();
  }catch(e){quickFailure(e,'名单修改未确认');}
  finally{quickBusy=false;L('addWhite').disabled=false;L('addBlack').disabled=false;}
}
for(const [id,kind] of [['addWhite','white'],['addBlack','black']])L(id).addEventListener('click',e=>{
  if(!e.isTrusted||quickBusy||quickReading||!quickUrl)return;
  const scope=L('listScope').value;
  // Native dialogs can synchronously fire focus. Don't let that refresh
  // disable the operation before the user has answered.
  quickDialog=true;
  try {
    if(kind==='white'&&scope==='site'&&!quickMatches.some(r=>r.scope===scope&&r.kind==='white')&&!window.confirm('允许整个网站在当前浏览器自动打开？（同协议、域名和端口，黑名单优先）'))return;
    editQuick({op:'save',rule:{kind,scope,url:quickUrl,note:L('listNote').value}});
  } finally {quickDialog=false;}
});
L('manageLists').addEventListener('click',e=>{if(e.isTrusted&&(!inConfirm||window.top===window.self))chrome.tabs.create({url:chrome.runtime.getURL('lists.html')}).catch(()=>{L('listFeedback').textContent='无法打开名单管理';});});
if(!inConfirm||window.top===window.self)refreshQuick(true);
if(inConfirm)window.addEventListener('focus',()=>{if(!quickDialog&&!quickBusy&&!quickReading&&!L('cancel').disabled&&document.activeElement!==L('listNote')&&document.activeElement!==L('listScope'))refreshQuick(false);});
