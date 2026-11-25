'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const c=vm.createContext({URL});for(const f of ['policy.js','list-tools.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),c);vm.runInContext('this.P=ListPolicy;this.T=ListTools',c);const {P,T}=c;
const old={kind:'black',scope:'url',url:'https://example.test/A',note:'keep'};
const changed={...old,kind:'white',note:'replace'};
const extra={kind:'white',scope:'url',url:'https://example.test/B',note:'new'};
const merged=T.merge([old],[changed,extra]);assert.equal(merged.added,1);assert.equal(merged.conflicts,1);assert.equal(merged.rows[0].kind,'black');assert.equal(merged.rows[0].note,'keep');
assert.throws(()=>T.fromFile('{"format":"wrong"}'));assert.throws(()=>T.fromFile('x'.repeat(2000001)));assert.throws(()=>T.fromLines('javascript:alert(1)','white',''));assert.throws(()=>T.fromLines('https://u:p@example.test/','white',''));assert.throws(()=>T.fromLines('https://example.test/A\nhttps://example.test/A','white',''));
assert.equal(T.fromLines('https://example.test/A\nhttps://example.test/B','black','x').length,2);
assert.equal(T.fromFile(JSON.stringify({format:'LinkEntryGuard-lists',schema:1,rows:[old]}))[0].kind,'black');
assert.equal(T.selected([old,extra],[P.key(old)],'white')[0].kind,'white');assert.equal(T.selected([old,extra],[P.key(old)],'delete').length,1);
const dir=P.normalize({kind:'black',scope:'path',url:'https://example.test/work/',note:''});
const site=P.normalize({kind:'white',scope:'site',url:'https://example.test/',note:''});
for(const u of ['https://example.test/work/','https://example.test/work/a?q=2']){assert.equal(P.match([site,dir],u)[0].kind,'black');assert.ok(new RegExp(P.regex(dir)).test(u));}
for(const u of ['https://example.test/work-other/','https://example.test/Work/a','https://example.test.evil/work/a','http://example.test/work/a','https://example.test:8080/work/a']){assert.ok(!P.match([dir],u).length);assert.ok(!new RegExp(P.regex(dir)).test(u));}
assert.throws(()=>P.normalize({...dir,url:'https://example.test/work'}));assert.throws(()=>P.normalize({...dir,url:'https://example.test/'}));assert.throws(()=>P.normalize({...dir,url:'https://example.test/work/?q=1'}));
for(const [input,expected] of [
 ['www.google.com','https://www.google.com/'],['google.com','https://google.com/'],
 [' chatgpt.com/c/123?x=AbC ','https://chatgpt.com/c/123?x=AbC'],
 ['http://example.test:8080/A?q=B','http://example.test:8080/A?q=B'],
 ['example.test:8443/work/','https://example.test:8443/work/'],
 ['[::1]:8080','https://[::1]:8080/'],['localhost:8000','https://localhost:8000/'],
 ['https://intranet/','https://intranet/'],['example.test/a#fragment','https://example.test/a']
])assert.equal(T.userUrl(input),expected,input);
for(const invalid of ['','hello','a search','javascript:alert(1)','data:text/html,foo','file:///tmp/a','ftp://example.test/','//example.test/','/relative','https:///example.test','https:example.test','example.test:bad','https://u:p@example.test/','https://@example.test/','example.test@evil.test','example.test\\evil.test','https://exam\nple.test/','https://exam\u202eple.test/','https://example.test/a b','https://example.test:99999/'])assert.throws(()=>T.userUrl(invalid),undefined,invalid);
assert.equal(T.fromLines('www.google.com\nhttp://example.test/A','white','')[0].url,'https://www.google.com/');
assert.throws(()=>T.fromLines('example.test\nhttps://example.test/','white',''),/重复/);
assert.throws(()=>T.fromLines('example.test\ninvalid','white',''),/第 2 条/);
assert.throws(()=>T.fromFile(JSON.stringify({format:'LinkEntryGuard-lists',schema:1,rows:[{...old,url:'example.test'}]})));
assert.equal(P.match([P.normalize({...old,url:T.userUrl('example.test/A')})],'http://example.test/A').length,0);
console.log('PASS: safe import, duplicate/conflict preservation, batch operations, directory scope and regex parity.');
