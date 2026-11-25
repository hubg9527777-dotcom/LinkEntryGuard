'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
class El{constructor(){this.handlers={};this.dataset={};this.children=[];this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.checked=false;}addEventListener(k,fn){this.handlers[k]=fn;}append(...x){this.children.push(...x);}replaceChildren(){this.children=[];}querySelectorAll(){return [];}setAttribute(){}focus(){}reset(){}click(){}}
const html=read('lists.html'),els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new El()]));
const old={kind:'black',scope:'url',url:'https://test.example/a',note:'保留'};let rows=[old],backup=null,calls=[],profileName='AI 谷歌会员PRO',profileListener;const build='1.0.2-r20261125.9';
const chrome={runtime:{id:'test-id',onMessage:{addListener:fn=>{profileListener=fn;}},sendMessage:async m=>{calls.push(m);if(m.type==='get-ui')return {ok:true,build,ui:{name:profileName,show:false}};if(m.type==='list-all')return {ok:true,build,rows,backupAt:backup?1:null};if(m.type==='list-edit'){if(JSON.stringify(m.expected)!==JSON.stringify(rows))return {ok:false,build,reason:'名单已变化，请刷新'};const prior=rows;rows=m.op==='restore'?backup:m.rows;backup=prior;return {ok:true,build,rows,backupAt:1};}if(m.type==='list-status'){const matches=rows.filter(r=>r.url===m.url);return {ok:true,build,kind:matches[0]?.kind||'none',matches};}throw Error('unexpected');}}};
const dialogs=[];let confirmAllowed=true;const window={confirm:text=>{dialogs.push(text);return confirmAllowed;},addEventListener(){}};const ctx=vm.createContext({window,document:{getElementById:id=>els[id],createElement:()=>new El(),querySelectorAll:()=>[]},location:{hash:'',pathname:'/lists.html'},history:{replaceState(){}},chrome,URL,Date,Promise,setTimeout,clearTimeout});
for(const m of html.matchAll(/<script src="([^"]+)"/g))vm.runInContext(read(m[1]),ctx,{filename:m[1]});
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{await tick();assert.equal(els.profileIdentity.textContent,'AI 谷歌会员PRO');assert.equal(els.previewProfile.textContent,'AI 谷歌会员PRO');profileName='私人浏览器';profileListener({type:'leg-ui-changed',ui:{name:'伪造名称'}},{id:'foreign'});await tick();assert.equal(els.profileIdentity.textContent,'AI 谷歌会员PRO');profileListener({type:'leg-ui-changed',ui:{name:'伪造名称'}},{id:'test-id'});await tick();assert.equal(els.profileIdentity.textContent,'私人浏览器');assert.equal(els.previewProfile.textContent,'私人浏览器');assert.equal(els.total.textContent,'白名单 0 · 黑名单 1');assert.equal(els.rows.children.length,1);els.batchUrls.value='test.example/a\nhttps://test.example/b';els.batchKind.value='white';els.batchNote.value='新备注';els.batchAdd.handlers.click({isTrusted:true});assert.match(els.previewText.textContent,/新增 1 条 · 跳过 1 条/);assert.equal(rows.length,1);await els.applyPreview.handlers.click({isTrusted:true});assert.equal(dialogs.length,0,'preview save is already explicit');assert.equal(rows.length,2);assert.equal(rows[0].kind,'black');assert.equal(els.preview.hidden,true);els.selectAll.handlers.change({isTrusted:true,target:{checked:true}});assert.match(els.selection.textContent,/2/);els.toBlack.handlers.click({isTrusted:true});await tick();assert.ok(rows.every(r=>r.kind==='black'));assert.equal(dialogs.length,1,'multi-rule conversion requires confirmation');els.restoreList.handlers.click({isTrusted:true});await tick();assert.equal(rows[1].kind,'white');assert.equal(dialogs.length,1,'undo is immediate');
// Delete one item, then delete another without reloading. This regresses the old reset-button name collision bug.
els.selectAll.handlers.change({isTrusted:true,target:{checked:false}});
const deleteButtons=()=>els.rows.children.map(row=>row.children[2].children[2]);
deleteButtons()[0].handlers.click({isTrusted:true});await tick();assert.equal(rows.length,1);
deleteButtons()[0].handlers.click({isTrusted:true});await tick();assert.equal(rows.length,0);assert.equal(dialogs.length,1,'consecutive single removals never prompt');assert.equal(els.listActionStatus.textContent,'已移除规则');
// Single URL add/convert, note-only edit, broad whitelist cancellation.
const submit=()=>els.editor.handlers.submit({isTrusted:true,preventDefault(){}});
els.url.value='test.example/new?utm_source=test';els.scope.value='url';els.kind.value='white';els.note.value='备注';submit();await tick();assert.equal(rows.length,1);assert.equal(rows[0].url,'https://test.example/new?utm_source=test');assert.equal(dialogs.length,1);assert.equal(els.url.value,'');
els.rows.children[0].children[2].children[0].handlers.click({isTrusted:true});els.note.value='改备注';els.url.value='test.example/new?utm_source=test';submit();await tick();assert.equal(rows[0].note,'改备注');assert.equal(dialogs.length,1);
els.rows.children[0].children[2].children[1].handlers.click({isTrusted:true});await tick();assert.equal(rows[0].kind,'black');assert.equal(dialogs.length,1);
els.url.value='https://test.example/';els.scope.value='site';els.kind.value='white';confirmAllowed=false;submit();await tick();assert.equal(rows.length,1);assert.equal(dialogs.length,2);confirmAllowed=true;
assert.match(html,/<section class="records">[\s\S]*id="exportList"[\s\S]*id="rows"[\s\S]*批量添加网址[\s\S]*<\/section>/);assert.match(html,/<details><summary>网址匹配检测（高级）<\/summary>/);
const detect=()=>els.testForm.handlers.submit({isTrusted:true,preventDefault(){}});
assert.match(html,/id="url" required type="text"/);assert.match(html,/id="testUrl" type="text"/);
els.testUrl.value='test.example/new?utm_source=test';await detect();assert.match(els.testResult.textContent,/黑名单 · 当前浏览器阻止/);assert.match(els.testResult.textContent,/命中规则/);assert.equal(calls.filter(m=>m.type==='list-status').at(-1).url,'https://test.example/new?utm_source=test');
els.testUrl.value='www.google.com';await detect();assert.equal(els.testUrl.value,'https://www.google.com/');assert.match(els.testResult.textContent,/未加入名单 · 当前浏览器需要确认/);
els.testUrl.value='http://test.example/new?utm_source=test';await detect();assert.match(els.testResult.textContent,/未加入名单 · 当前浏览器需要确认/);assert.equal(calls.filter(m=>m.type==='list-status').at(-1).url,'http://test.example/new?utm_source=test');
els.rows.children[0].children[2].children[1].handlers.click({isTrusted:true});await tick();els.testUrl.value='test.example/new?utm_source=test';await detect();assert.match(els.testResult.textContent,/白名单 · 当前浏览器自动打开/);
const beforeInvalid=calls.length;els.testUrl.value='javascript:alert(1)';await detect();assert.match(els.testResult.textContent,/请输入有效网址/);assert.equal(calls.length,beforeInvalid);assert.equal(els.testRule.disabled,false);
// Long URL is rendered as text and preview appears only for clipped content.
const wrap=els.rows.children[0].children[1].children[1];const [shortUrl,fullUrl]=wrap.children;
assert.equal(shortUrl.textContent,rows[0].url);assert.equal(fullUrl.textContent,rows[0].url);assert.equal(shortUrl.tabIndex,0);
shortUrl.scrollWidth=900;shortUrl.clientWidth=200;wrap.handlers.mouseenter();assert.equal(wrap.dataset.clipped,'true');
shortUrl.scrollWidth=100;shortUrl.handlers.focus();assert.equal(wrap.dataset.clipped,'false');
assert.match(read('lists.css'),/ruleUrlWrap\[data-clipped=true\]:hover/);assert.match(html,/不用实际打开网站，也不会修改名单/);
// A slow file read must not overwrite a newer preview from pasted URLs.
let finishFile;const slowFile={size:200,text:()=>new Promise(resolve=>{finishFile=resolve;})};
const pending=els.importFile.handlers.change({isTrusted:true,target:{files:[slowFile],value:'x'}});
els.batchUrls.value='https://new.test/path';els.batchAdd.handlers.click({isTrusted:true});
const previewText=els.previewRows.children[0].textContent;assert.match(previewText,/new\.test/);
finishFile(JSON.stringify({format:'LinkEntryGuard-lists',schema:1,rows:[{kind:'white',scope:'url',url:'https://old.test/',note:''}]}));await pending;
assert.equal(els.previewRows.children[0].textContent,previewText,'late import may not replace newer preview');
console.log('PASS: actual manager scripts, preview before save, conflict retention, filtered selection, bulk conversion, undo and local test.');})().catch(e=>{console.error(e);process.exitCode=1;});
