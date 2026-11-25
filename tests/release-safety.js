'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'), read=f=>fs.readFileSync(path.join(root,f),'utf8');
const wf=read('.github/workflows/release.yml');
assert.match(wf,/verify:[\s\S]*?contents: read[\s\S]*?node "\$test_file"[\s\S]*?release:[\s\S]*?needs: verify[\s\S]*?contents: write/);
assert.ok(!/pull_request_target|workflow_run/.test(wf));
const refs=[...wf.matchAll(/uses: actions\/checkout@([a-f0-9]{40})/g)];assert.equal(refs.length,2);assert.equal(refs[0][1],refs[1][1]);
assert.equal((wf.match(/persist-credentials: false/g)||[]).length,2);
const names=wf.match(/git archive[^\n]+ -- \\\n([\s\S]*?)\n\s+unzip -t/)[1].replace(/\\\n/g,' ').trim().split(/\s+/);
assert.ok(names.every(n=>!n.includes('*')&&!n.startsWith('.')&&fs.lstatSync(path.join(root,n)).isFile()));
const m=JSON.parse(read('manifest.json'));
const needed=[m.background.service_worker,m.action.default_popup,...Object.values(m.icons),...Object.values(m.action.default_icon),...m.content_scripts.flatMap(s=>s.js),...m.declarative_net_request.rule_resources.map(r=>r.path),...m.web_accessible_resources.flatMap(r=>r.resources),'manifest.json'];
for(const html of names.filter(n=>n.endsWith('.html')))for(const match of read(html).matchAll(/(?:src|href)="([^"#]+)"/g)){if(!match[1].includes(':'))needed.push(match[1]);}
for(const n of needed)assert.ok(names.includes(n),'package missing '+n);
assert.ok(!names.some(n=>n.startsWith('tests/')||n.startsWith('.github/')||/lists.*\.json/i.test(n)));
assert.match(read('.gitignore'),/^LinkEntryGuard-lists\*\.json$/m);
console.log('PASS: pinned CI checkout, separate read-only tests, explicit release allowlist and all manifest/UI assets.');
