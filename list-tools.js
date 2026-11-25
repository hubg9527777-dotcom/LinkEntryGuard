'use strict';
// Pure helpers shared by the manager and regression tests. Never visit a URL.
const ListTools = Object.freeze({
  // Only for human-entered text. Stored rules, imports and navigation messages
  // keep the original strict validation; never reinterpret an existing rule.
  userUrl(raw) {
    const invalid=()=>new Error('请输入有效网址，例如 www.google.com 或 https://www.google.com/');
    if(typeof raw!=='string'||raw.length>1600||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\\]/u.test(raw))throw invalid();
    const text=raw.trim();
    if(!text||/\s/u.test(text))throw invalid();
    const explicit=/^https?:\/\//i.test(text);
    const body=explicit?text.replace(/^https?:\/\//i,''):text;
    const authority=body.split(/[/?#]/,1)[0];
    if(!authority||authority.includes('@')||!/^(?:\[[0-9a-f:.]+\]|[^:\[\]@]+)(?::[0-9]+)?$/i.test(authority))throw invalid();
    let u;try{u=new URL(explicit?text:'https://'+text);}catch{throw invalid();}
    if(!GuardPolicy.isWebUrl(u.href)||u.username||u.password||u.href.length>1600)throw invalid();
    // A bare word is ambiguous (often a search phrase). Explicit HTTP(S)
    // still supports intranet names; bare localhost, IP and domains work.
    if(!explicit&&!u.hostname.includes('.')&&!u.hostname.startsWith('[')&&u.hostname!=='localhost')throw invalid();
    u.hash=''; // existing matching rules ignore URL fragments
    return u.href;
  },
  validate(raw) {
    if (!Array.isArray(raw) || raw.length > 300) throw new Error('最多300条规则');
    const rows=raw.map(r=>ListPolicy.normalize(r));
    if(new Set(rows.map(ListPolicy.key)).size!==rows.length) throw new Error('文件内存在重复规则，请先整理');
    return rows;
  },
  merge(existing,incoming) {
    const current=this.validate(existing), next=this.validate(incoming);
    const known=new Map(current.map(r=>[ListPolicy.key(r),r]));
    let added=0,skipped=0,conflicts=0;const additions=[];
    for(const rule of next){const old=known.get(ListPolicy.key(rule));if(old){skipped++;if(old.kind!==rule.kind||old.note!==rule.note)conflicts++;continue;}known.set(ListPolicy.key(rule),rule);added++;additions.push(rule);}
    const rows=this.validate([...known.values()]);
    return {rows,added,skipped,conflicts,additions};
  },
  fromFile(text) {
    if(typeof text!=='string'||text.length>2000000)throw new Error('文件过大');
    let parsed;try{parsed=JSON.parse(text);}catch{throw new Error('不是有效的 JSON 文件');}
    if(parsed?.format!=='LinkEntryGuard-lists'||parsed.schema!==1)throw new Error('不支持的名单文件');
    return this.validate(parsed.rows);
  },
  fromLines(text,kind,note) {
    if(typeof text!=='string'||text.length>500000)throw new Error('输入过长');
    const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(!lines.length||lines.length>300)throw new Error('请输入1至300条网址');
    return this.validate(lines.map((url,index)=>{try{return {kind,scope:'url',url:this.userUrl(url),note};}catch(e){throw new Error(`第 ${index+1} 条网址：${e.message}`);}}));
  },
  selected(rows,keys,operation) {
    const selected=new Set(keys);
    return this.validate(operation==='delete'?rows.filter(r=>!selected.has(ListPolicy.key(r))):rows.map(r=>selected.has(ListPolicy.key(r))?{...r,kind:operation}:r));
  }
});
