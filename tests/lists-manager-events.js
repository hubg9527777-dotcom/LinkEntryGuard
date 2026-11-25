'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
class El{constructor(){this.handlers={};this.dataset={};this.children=[];this.value='';this.textContent='';this.disabled=false;this.hidden=false;this.checked=false;}addEventListener(k,fn){this.handlers[k]=fn;}append(...x){this.children.push(...x);}replaceChildren(){this.children=[];}querySelectorAll(){return [];}setAttribute(){}focus(){}reset(){}click(){}}
const html=read('lists.html'),els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new El()]));
const old={kind:'black',scope:'url',url:'https://test.example/a',note:'保留'};let rows=[old],backup=null,calls=[];const build='1.0.2-r20261125.2';
const chrome={runtime:{sendMessage:async m=>{calls.push(m);if(m.type==='list-all')return {ok:true,build,rows,backupAt:backup?1:null};if(m.type==='list-edit'){if(JSON.stringify(m.expected)!==JSON.stringify(rows))return {ok:false,build,reason:'名单已变化，请刷新'};const prior=rows;rows=m.op==='restore'?backup:m.rows;backup=prior;return {ok:true,build,rows,backupAt:1};}if(m.type==='list-status')return {ok:true,build,kind:'black',matches:[old]};throw Error('unexpected');}}};
const window={confirm:()=>true,addEventListener(){}};const ctx=vm.createContext({window,document:{getElementById:id=>els[id],createElement:()=>new El(),querySelectorAll:()=>[]},location:{hash:'',pathname:'/lists.html'},history:{replaceState(){}},chrome,URL,Date,Promise,setTimeout,clearTimeout});
for(const m of html.matchAll(/<script src="([^"]+)"/g))vm.runInContext(read(m[1]),ctx,{filename:m[1]});
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{await tick();assert.equal(els.total.textContent,'白名单 0 · 黑名单 1');assert.equal(els.rows.children.length,1);els.batchUrls.value='https://test.example/a\nhttps://test.example/b';els.batchKind.value='white';els.batchNote.value='新备注';els.batchAdd.handlers.click({isTrusted:true});assert.match(els.previewText.textContent,/新增 1 条 · 跳过 1 条/);assert.equal(rows.length,1);await els.applyPreview.handlers.click({isTrusted:true});assert.equal(rows.length,2);assert.equal(rows[0].kind,'black');assert.equal(els.preview.hidden,true);els.selectAll.handlers.change({isTrusted:true,target:{checked:true}});assert.match(els.selection.textContent,/2/);els.toBlack.handlers.click({isTrusted:true});await tick();assert.ok(rows.every(r=>r.kind==='black'));els.restoreList.handlers.click({isTrusted:true});await tick();assert.equal(rows[1].kind,'white');els.testUrl.value='https://test.example/a';await els.testRule.handlers.click({isTrusted:true});assert.match(els.testResult.textContent,/黑名单 · 阻止/);assert.equal(calls.filter(m=>m.type==='list-status').length,1);
// A slow file read must not overwrite a newer preview from pasted URLs.
let finishFile;const slowFile={size:200,text:()=>new Promise(resolve=>{finishFile=resolve;})};
const pending=els.importFile.handlers.change({isTrusted:true,target:{files:[slowFile],value:'x'}});
els.batchUrls.value='https://new.test/path';els.batchAdd.handlers.click({isTrusted:true});
const previewText=els.previewRows.children[0].textContent;assert.match(previewText,/new\.test/);
finishFile(JSON.stringify({format:'LinkEntryGuard-lists',schema:1,rows:[{kind:'white',scope:'url',url:'https://old.test/',note:''}]}));await pending;
assert.equal(els.previewRows.children[0].textContent,previewText,'late import may not replace newer preview');
console.log('PASS: actual manager scripts, preview before save, conflict retention, filtered selection, bulk conversion, undo and local test.');})().catch(e=>{console.error(e);process.exitCode=1;});
