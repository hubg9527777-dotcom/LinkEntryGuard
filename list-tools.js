'use strict';
// Pure helpers shared by the manager and regression tests. Never visit a URL.
const ListTools = Object.freeze({
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
    return this.validate(lines.map(url=>({kind,scope:'url',url,note})));
  },
  selected(rows,keys,operation) {
    const selected=new Set(keys);
    return this.validate(operation==='delete'?rows.filter(r=>!selected.has(ListPolicy.key(r))):rows.map(r=>selected.has(ListPolicy.key(r))?{...r,kind:operation}:r));
  }
});
