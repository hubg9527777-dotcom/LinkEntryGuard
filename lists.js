'use strict';
const $=id=>document.getElementById(id);
const key=r=>ListPolicy.key(r);
const scopeName=s=>({url:'精确网址',path:'指定目录',site:'整个网站'})[s];
let editSnapshot=null, importSequence=0;
let rows=[],filter='all',oldKey='',busy=false,reading=false,ready=false,backupAt=null,preview=null;
const selected=new Set();
const retry=$('retryList');
const message=e=>(e?.message||'操作失败')+(e?.code?' · '+e.code:'');
function shownRows(){const search=$('search').value.toLocaleLowerCase();return rows.filter(r=>(filter==='all'||r.kind===filter)&&`${r.url} ${r.note}`.toLocaleLowerCase().includes(search));}
function controls(){const enabled=ready&&!busy&&!reading;
  for(const el of $('editor').querySelectorAll('input,select,button[type=submit]'))el.disabled=!enabled;
  for(const id of ['exportList','importList','batchAdd','testRule','selectAll','reset'])$(id).disabled=!enabled;
  for(const el of $('rows').querySelectorAll('button,input[type=checkbox]'))el.disabled=!enabled;
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
    const url=document.createElement('div');url.className='ruleUrl';url.textContent=r.url;const note=document.createElement('small');note.textContent=r.note||'无备注';info.append(tag,url,note);
    const check=document.createElement('input');check.type='checkbox';check.className='ruleCheck';check.setAttribute('aria-label','选择 '+r.url);check.checked=selected.has(key(r));check.disabled=!ready||busy||reading;check.addEventListener('change',e=>{if(!e.isTrusted||!ready||busy||reading)return;if(check.checked)selected.add(key(r));else selected.delete(key(r));controls();});
    const actions=document.createElement('div');actions.className='rowActions';
    for(const [text,fn] of [['编辑',()=>{oldKey=key(r);editSnapshot=JSON.stringify(r);$('url').value=r.url;$('kind').value=r.kind;$('scope').value=r.scope;$('note').value=r.note;$('editorTitle').textContent='编辑名单';$('url').focus();}],['转换',()=>{if(window.confirm('将此规则转为'+(r.kind==='white'?'黑名单':'白名单')+'？'))batch(ListTools.selected(rows,[key(r)],r.kind==='white'?'black':'white'));}],['移除',()=>{if(window.confirm('移除此规则？'))batch(ListTools.selected(rows,[key(r)],'delete'));}]]){const b=document.createElement('button');b.type='button';b.textContent=text;b.disabled=!ready||busy||reading;b.addEventListener('click',e=>{if(e.isTrusted&&ready&&!busy&&!reading)fn();});actions.append(b);}
    row.append(check,info,actions);$('rows').append(row);
  }controls();
}
function reset(){oldKey='';editSnapshot=null;$('editor').reset();$('editorTitle').textContent='添加名单';}
function closePreview(){importSequence++;preview=null;$('preview').hidden=true;$('previewRows').replaceChildren();controls();}
async function load(){if(busy||reading)return;reading=true;ready=false;controls();try{const r=await LegUI.request({type:'list-all'},{read:true});rows=ListTools.validate(r.rows);backupAt=r.backupAt;ready=true;$('feedback').textContent='';}catch(e){$('feedback').textContent=message(e);rows=[];selected.clear();closePreview();}finally{reading=false;render();}}
async function mutate(msg){if(busy||reading||!ready)return false;busy=true;controls();try{const r=await LegUI.request({type:'list-edit',...msg});rows=ListTools.validate(r.rows);backupAt=r.backupAt;selected.clear();closePreview();reset();$('feedback').textContent='已保存';return true;}catch(e){$('feedback').textContent=message(e);ready=false;closePreview();return false;}finally{busy=false;render();}}
const batch=(next,expected=rows)=>mutate({op:'batch',rows:next,expected});
$('editor').addEventListener('submit',e=>{e.preventDefault();if(!e.isTrusted||busy||reading||!ready)return;try{if(oldKey&&JSON.stringify(rows.find(r=>key(r)===oldKey))!==editSnapshot)throw new Error('规则已变化，请重新选择编辑');const rule=ListPolicy.normalize({url:$('url').value,kind:$('kind').value,scope:$('scope').value,note:$('note').value});if(rule.scope==='path'&&!window.confirm('应用到此目录及下级路径？\n'+rule.url))return;if(rule.scope==='site'&&!window.confirm('应用到整个网站（同协议、域名、端口）？'))return;if(rule.scope==='url'&&new URL(rule.url).search&&!window.confirm('网址含查询参数，确认不含敏感信息？'))return;const collision=rows.find(r=>key(r)===key(rule)&&key(r)!==oldKey);if(collision&&!window.confirm('已存在同范围规则，确定覆盖？'))return;let next=rows.filter(r=>key(r)!==oldKey&&key(r)!==key(rule));next.push(rule);batch(ListTools.validate(next));}catch(e){$('feedback').textContent=message(e);}});
$('reset').addEventListener('click',reset);$('search').addEventListener('input',()=>{selected.clear();render();});
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{filter=button.dataset.filter;selected.clear();for(const b of document.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b===button));render();});
retry.addEventListener('click',e=>{if(e.isTrusted&&!busy&&!reading){closePreview();load();}});
$('selectAll').addEventListener('change',e=>{if(!e.isTrusted||!ready||busy||reading)return;for(const r of shownRows())if(e.target.checked)selected.add(key(r));else selected.delete(key(r));render();});
for(const [id,op] of [['toWhite','white'],['toBlack','black'],['deleteSelected','delete']])$(id).addEventListener('click',e=>{if(e.isTrusted&&ready&&selected.size&&window.confirm(`确认处理所选 ${selected.size} 条规则？`))batch(ListTools.selected(rows,[...selected],op));});
function showPreview(incoming){const result=ListTools.merge(rows,incoming);preview={...result,expected:rows.slice()};$('previewText').textContent=`新增 ${result.added} 条 · 跳过 ${result.skipped} 条（冲突 ${result.conflicts} 条，保留原规则）`;$('previewRows').replaceChildren();for(const r of result.additions){const line=document.createElement('div');line.className='previewLine';line.textContent=`${r.kind==='black'?'黑名单':'白名单'} · ${scopeName(r.scope)} · ${r.url}${r.note?' · '+r.note:''}`;$('previewRows').append(line);}$('preview').hidden=false;$('batchFeedback').textContent='';controls();}
$('batchAdd').addEventListener('click',e=>{if(!e.isTrusted||!ready)return;try{importSequence++;showPreview(ListTools.fromLines($('batchUrls').value,$('batchKind').value,$('batchNote').value));}catch(err){closePreview();$('batchFeedback').textContent=message(err);}});
$('importList').addEventListener('click',e=>{if(e.isTrusted&&ready)$('importFile').click();});
$('importFile').addEventListener('change',async e=>{if(!e.isTrusted||!ready)return;const file=e.target.files?.[0];e.target.value='';if(!file)return;const seq=++importSequence;try{if(file.size>2000000)throw new Error('文件过大');const text=await file.text();if(seq!==importSequence||busy||reading||!ready)return;showPreview(ListTools.fromFile(text));}catch(err){if(seq!==importSequence)return;closePreview();$('batchFeedback').textContent=message(err);}});
$('applyPreview').addEventListener('click',async e=>{if(!e.isTrusted||!preview?.added||!ready)return;if(!window.confirm('保存预览中的新增规则？网址可能包含敏感参数。'))return;const next=preview;const ok=await batch(next.rows,next.expected);$('batchFeedback').textContent=ok?'已保存':'未确认保存，请重试读取名单';});
$('cancelPreview').addEventListener('click',closePreview);
$('exportList').addEventListener('click',e=>{if(!e.isTrusted||!ready)return;if(!window.confirm('导出包含完整网址和备注的本地文件？'))return;const blob=new Blob([JSON.stringify({format:'LinkEntryGuard-lists',schema:1,rows},null,2)],{type:'application/json'});const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download='LinkEntryGuard-lists.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);});
$('restoreList').addEventListener('click',e=>{if(e.isTrusted&&ready&&backupAt&&window.confirm('恢复上次修改前的名单？当前名单将成为新的备份。'))mutate({op:'restore',expected:rows});});
$('testRule').addEventListener('click',async e=>{if(!e.isTrusted||!ready)return;const button=$('testRule');button.disabled=true;try{const url=$('testUrl').value.trim();if(!GuardPolicy.isWebUrl(url)||new URL(url).username||new URL(url).password)throw new Error('请输入有效网址');const r=await LegUI.request({type:'list-status',url},{read:true});$('testResult').textContent=({black:'黑名单 · 阻止',white:'白名单 · 自动打开',none:'未加入 · 需要确认'})[r.kind]+' '+r.matches.map(x=>`${scopeName(x.scope)}：${x.url}${x.note?' · '+x.note:''}`).join('；');}catch(err){$('testResult').textContent=message(err);}finally{controls();}});
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
