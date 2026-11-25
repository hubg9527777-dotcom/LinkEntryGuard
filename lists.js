'use strict';
const $=id=>document.getElementById(id);
const key=r=>ListPolicy.key(r);
const scopeName=s=>({url:'精确网址',path:'指定目录',site:'整个网站'})[s];
let editSnapshot=null, importSequence=0, testSequence=0, testing=false;
let rows=[],filter='all',oldKey='',busy=false,reading=false,ready=false,backupAt=null,preview=null;
const selected=new Set();
const retry=$('retryList');
let currentProfileName='名称读取中…';
const refreshProfile=LegUI.watchProfile(name=>{
  const next=name||'名称读取失败';
  if(next!==currentProfileName){currentProfileName=next;invalidateTest();controls();}
  for(const id of ['profileIdentity','previewProfile']){const el=$(id);el.textContent=currentProfileName;el.title=currentProfileName;}
});
function actionStatus(text,error=false){const el=$('listActionStatus');el.textContent=text;el.hidden=!text;el.dataset.error=String(error);}
function broadWhite(rule){return rule.kind==='white'&&rule.scope!=='url';}
function confirmBroader(rule){return window.confirm('将此范围加入当前浏览器白名单，访问将自动放行（黑名单优先）：\n'+rule.url+'\n确认范围正确？');}
const message=e=>(e?.message||'操作失败')+(e?.code?' · '+e.code:'');
function shownRows(){const search=$('search').value.toLocaleLowerCase();return rows.filter(r=>(filter==='all'||r.kind===filter)&&`${r.url} ${r.note}`.toLocaleLowerCase().includes(search));}
function controls(){const enabled=ready&&!busy&&!reading;
  for(const el of $('editor').querySelectorAll('input,select,button[type=submit]'))el.disabled=!enabled;
  for(const id of ['exportList','importList','batchAdd','testRule','selectAll','cancelEdit'])$(id).disabled=!enabled;
  for(const el of $('rows').querySelectorAll('button,input[type=checkbox]'))el.disabled=!enabled;
  $('testRule').disabled=!enabled||testing;
  $('restoreList').disabled=!enabled||!backupAt;
  for(const id of ['toWhite','toBlack','deleteSelected'])$(id).disabled=!enabled||!selected.size;
  $('applyPreview').disabled=!enabled||!preview||!preview.added;
  $('selection').textContent=`已选 ${selected.size} 条`;
  const shown=shownRows();$('selectAll').checked=shown.length>0&&shown.every(r=>selected.has(key(r)));$('selectAll').indeterminate=shown.some(r=>selected.has(key(r)))&&!$('selectAll').checked;
  $('backupInfo').textContent=backupAt?'上次修改前的本地备份可恢复':'暂无修改备份';retry.hidden=false;retry.textContent=ready?'刷新':'重试';retry.disabled=busy||reading;
}
function render(){
  const keys=new Set(rows.map(key));for(const k of selected)if(!keys.has(k))selected.delete(k);
  $('total').textContent=`白名单 ${rows.filter(r=>r.kind==='white').length} · 黑名单 ${rows.filter(r=>r.kind==='black').length}`;
  $('rows').replaceChildren();const shown=shownRows();
  if(!shown.length){const p=document.createElement('p');p.className='muted';p.textContent='没有匹配的记录';$('rows').append(p);}
  for(const r of shown){const row=document.createElement('article');row.className='ruleRow';
    const info=document.createElement('div');info.className='ruleInfo';const tag=document.createElement('strong');tag.className='ruleTag';tag.dataset.kind=r.kind;tag.textContent=(r.kind==='white'?'白名单':'黑名单')+' · '+scopeName(r.scope);
    const urlWrap=document.createElement('div');urlWrap.className='ruleUrlWrap';
    const url=document.createElement('div');url.className='ruleUrl';url.textContent=r.url;url.tabIndex=0;
    const full=document.createElement('div');full.className='ruleUrlFull';full.textContent=r.url;full.setAttribute('aria-hidden','true');
    // Measure truncation at interaction time, after layout; never interpret URL as HTML.
    const checkOverflow=()=>{urlWrap.dataset.clipped=String(url.scrollWidth>url.clientWidth);};
    urlWrap.addEventListener('mouseenter',checkOverflow);url.addEventListener('focus',checkOverflow);
    urlWrap.append(url,full);const note=document.createElement('small');note.className='ruleNote';note.textContent=r.note||'无备注';note.title=r.note||'无备注';info.append(tag,urlWrap,note);
    const check=document.createElement('input');check.type='checkbox';check.className='ruleCheck';check.setAttribute('aria-label','选择 '+r.url);check.checked=selected.has(key(r));check.disabled=!ready||busy||reading;check.addEventListener('change',e=>{if(!e.isTrusted||!ready||busy||reading)return;if(check.checked)selected.add(key(r));else selected.delete(key(r));controls();});
    const actions=document.createElement('div');actions.className='rowActions';
    for(const [text,fn] of [['编辑',()=>{oldKey=key(r);editSnapshot=JSON.stringify(r);$('url').value=r.url;$('kind').value=r.kind;$('scope').value=r.scope;$('note').value=r.note;$('editorTitle').textContent='编辑名单';$('url').focus();}],['转换',()=>{const kind=r.kind==='white'?'black':'white';if(broadWhite({...r,kind})&&!confirmBroader(r))return;batch(ListTools.selected(rows,[key(r)],kind),rows,kind==='white'?'已转为白名单':'已转为黑名单');}],['移除',()=>{batch(ListTools.selected(rows,[key(r)],'delete'),rows,'已移除规则');}]]){const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=!ready||busy||reading;b.addEventListener('click',e=>{if(e.isTrusted&&ready&&!busy&&!reading)fn();});actions.append(b);}
    row.append(check,info,actions);$('rows').append(row);
  }controls();
}
function reset(){oldKey='';editSnapshot=null;$('url').value='';$('kind').value='white';$('scope').value='url';$('note').value='';$('editorTitle').textContent='添加名单';$('feedback').textContent='';}
function closePreview(){importSequence++;preview=null;$('preview').hidden=true;$('previewRows').replaceChildren();controls();}
function invalidateTest(){testSequence++;testing=false;$('testResult').textContent='';$('testResult').dataset.kind='';}
async function load(){if(busy||reading)return;invalidateTest();reading=true;ready=false;controls();try{const r=await LegUI.request({type:'list-all'},{read:true});rows=ListTools.validate(r.rows);backupAt=r.backupAt;ready=true;$('feedback').textContent='';actionStatus('');}catch(e){$('feedback').textContent=message(e);actionStatus(message(e),true);rows=[];selected.clear();closePreview();}finally{reading=false;render();}}
async function mutate(msg,success='已保存规则',resetEditor=false){if(busy||reading||!ready)return false;invalidateTest();busy=true;controls();try{const r=await LegUI.request({type:'list-edit',...msg});rows=ListTools.validate(r.rows);backupAt=r.backupAt;selected.clear();closePreview();if(resetEditor){reset();$('feedback').textContent=success;}actionStatus(success);return true;}catch(e){$('feedback').textContent=message(e);actionStatus(message(e),true);ready=false;closePreview();return false;}finally{busy=false;render();}}
const batch=(next,expected=rows,success='已保存规则',resetEditor=false)=>mutate({op:'batch',rows:next,expected},success,resetEditor);
$('editor').addEventListener('submit',e=>{e.preventDefault();if(!e.isTrusted||busy||reading||!ready)return;try{if(oldKey&&JSON.stringify(rows.find(r=>key(r)===oldKey))!==editSnapshot)throw new Error('规则已变化，请重新选择编辑');const rule=ListPolicy.normalize({url:ListTools.userUrl($('url').value),kind:$('kind').value,scope:$('scope').value,note:$('note').value});$('url').value=rule.url;const previous=rows.find(r=>key(r)===key(rule));const collision=previous&&key(previous)!==oldKey;if(collision&&!window.confirm('当前浏览器已存在同范围规则，确定覆盖？'))return;if(broadWhite(rule)&&previous?.kind!=='white'&&!confirmBroader(rule))return;let next=rows.filter(r=>key(r)!==oldKey&&key(r)!==key(rule));next.push(rule);batch(ListTools.validate(next),rows,oldKey?'已更新规则':'已添加规则',true);}catch(e){$('feedback').textContent=message(e);}});
$('cancelEdit').addEventListener('click',reset);$('search').addEventListener('input',()=>{selected.clear();render();});
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{filter=button.dataset.filter;selected.clear();for(const b of document.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b===button));render();});
retry.addEventListener('click',e=>{if(e.isTrusted&&!busy&&!reading){closePreview();refreshProfile();load();}});
$('selectAll').addEventListener('change',e=>{if(!e.isTrusted||!ready||busy||reading)return;for(const r of shownRows())if(e.target.checked)selected.add(key(r));else selected.delete(key(r));render();});
for(const [id,op] of [['toWhite','white'],['toBlack','black'],['deleteSelected','delete']])$(id).addEventListener('click',e=>{if(!e.isTrusted||!ready||busy||reading||!selected.size)return;const affected=rows.filter(r=>selected.has(key(r)));const widened=op==='white'&&affected.some(r=>r.kind!=='white'&&r.scope!=='url');if((selected.size>1||widened)&&!window.confirm(`确认处理当前浏览器所选 ${selected.size} 条规则？${widened?' 包含扩大白名单放行范围的规则。':''}`))return;batch(ListTools.selected(rows,[...selected],op),rows,`已处理 ${selected.size} 条规则`);});
function showPreview(incoming){const result=ListTools.merge(rows,incoming);preview={...result,expected:rows.slice()};$('previewText').textContent=`新增 ${result.added} 条 · 跳过 ${result.skipped} 条（冲突 ${result.conflicts} 条，保留原规则）`;$('previewRows').replaceChildren();for(const r of result.additions){const line=document.createElement('div');line.className='previewLine';line.textContent=`${r.kind==='black'?'黑名单':'白名单'} · ${scopeName(r.scope)} · ${r.url}${r.note?' · '+r.note:''}`;$('previewRows').append(line);}$('preview').hidden=false;$('batchFeedback').textContent='';controls();}
$('batchAdd').addEventListener('click',e=>{if(!e.isTrusted||!ready)return;try{importSequence++;showPreview(ListTools.fromLines($('batchUrls').value,$('batchKind').value,$('batchNote').value));}catch(err){closePreview();$('batchFeedback').textContent=message(err);}});
$('importList').addEventListener('click',e=>{if(e.isTrusted&&ready)$('importFile').click();});
$('importFile').addEventListener('change',async e=>{if(!e.isTrusted||!ready)return;const file=e.target.files?.[0];e.target.value='';if(!file)return;const seq=++importSequence;try{if(file.size>2000000)throw new Error('文件过大');const text=await file.text();if(seq!==importSequence||busy||reading||!ready)return;showPreview(ListTools.fromFile(text));}catch(err){if(seq!==importSequence)return;closePreview();$('batchFeedback').textContent=message(err);}});
$('applyPreview').addEventListener('click',async e=>{if(!e.isTrusted||!preview?.added||!ready)return;const next=preview;const ok=await batch(next.rows,next.expected);$('batchFeedback').textContent=ok?'已保存':'未确认保存，请重试读取名单';});
$('cancelPreview').addEventListener('click',closePreview);
$('exportList').addEventListener('click',e=>{if(!e.isTrusted||!ready)return;const blob=new Blob([JSON.stringify({format:'LinkEntryGuard-lists',schema:1,rows},null,2)],{type:'application/json'});const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download='LinkEntryGuard-lists.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);});
$('restoreList').addEventListener('click',e=>{if(e.isTrusted&&ready&&backupAt)mutate({op:'restore',expected:rows},'已撤销上次修改');});
$('testUrl').addEventListener('input',()=>{invalidateTest();controls();});
$('testForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!e.isTrusted||!ready||busy||reading||testing)return;
  const seq=++testSequence,result=$('testResult');testing=true;controls();
  result.dataset.kind='';result.textContent='正在检测…';
  try{
    const url=ListTools.userUrl($('testUrl').value);$('testUrl').value=url;
    const r=await LegUI.request({type:'list-status',url},{read:true});
    if(seq!==testSequence)return;
    const labels={black:'黑名单 · 当前浏览器阻止访问\n该网址命中当前浏览器黑名单，黑名单优先。',white:'白名单 · 当前浏览器自动打开\n该网址命中当前浏览器白名单，按名单规则无需手动确认。',none:'未加入名单 · 当前浏览器需要确认\n该网址未命中当前浏览器黑白名单，按默认规则需要访问确认。'};
    if(!Object.hasOwn(labels,r.kind)||!Array.isArray(r.matches))throw new Error('名单检测返回异常，请重试');
    result.dataset.kind=r.kind;
    result.textContent='当前浏览器：'+currentProfileName+'\n检测网址：'+url+'\n'+labels[r.kind]+(r.matches.length?'\n命中规则：\n'+r.matches.map(x=>`${x.kind==='black'?'黑名单':'白名单'} · ${scopeName(x.scope)}：${x.url}${x.note?' · '+x.note:''}`).join('\n'):'');
  }catch(err){if(seq===testSequence){result.dataset.kind='error';result.textContent=message(err);}}
  finally{if(seq===testSequence){testing=false;controls();}}
});
async function start(){
  const token=location.hash.slice(1);
  let prefillError='';
  if(/^[a-f0-9-]{36}$/.test(token)){
    try{const r=await LegUI.request({type:'list-prefill',token});if(!GuardPolicy.isWebUrl(r.url)||r.url.length>1600||new URL(r.url).username||new URL(r.url).password)throw new Error('链接无效');$('url').value=r.url;$('testUrl').value=r.url;}
    catch(e){prefillError=message(e);}
    try{history.replaceState(null,'',location.pathname);}catch{}
  }
  await load();if(prefillError)$('feedback').textContent=prefillError;
}
// Native confirm/file dialogs also fire focus; refreshing there can cancel
// the user's pending operation. Explicit refresh + backend snapshot check
// avoids silent overwrites without discarding a draft.
start();
