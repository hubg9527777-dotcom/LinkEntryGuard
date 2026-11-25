'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
let attempts=0,mode='retry';const build='1.0.2-r20261125.9';
const chrome={runtime:{async sendMessage(m){attempts++;assert.equal(m.build,build);if(mode==='retry'&&attempts<3)throw new Error('closed');if(mode==='stale')return {ok:true,build:'old'};if(mode==='write')throw new Error('closed');return {ok:true,build};}}};
const c=vm.createContext({chrome,setTimeout,clearTimeout,Promise,Error});vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui-transport.js'),'utf8')+'\nthis.transport=LegUI;',c);
(async()=>{await c.transport.request({type:'list-status'},{read:true});assert.equal(attempts,3);mode='stale';attempts=0;await assert.rejects(c.transport.request({type:'list-status'},{read:true}),e=>e.code==='LEG-01');assert.equal(attempts,3);mode='write';attempts=0;await assert.rejects(c.transport.request({type:'list-edit'}),e=>e.code==='LEG-02');assert.equal(attempts,1);console.log('PASS: read retry, stale build identification, no automatic mutation replay.');})().catch(e=>{console.error(e);process.exitCode=1;});
