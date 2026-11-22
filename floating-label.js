(() => {
  'use strict';
  if (window !== window.top) return; // Includes our own confirmation page and incognito if authorized.

  const DEFAULT_POSITION = {top:0,right:110};
  const node = document.createElement('div');
  node.id = 'leg-profile-indicator';
  node.style.cssText = [
    'position:fixed!important','top:0px!important','right:110px!important',
    'z-index:2147483647!important','pointer-events:none!important',
    'display:none!important','width:max-content',
    'max-width:min(240px,calc(100vw - 16px))'
  ].join(';');
  const root = node.attachShadow({mode:'closed'});
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial}*{box-sizing:border-box}
    .chip{pointer-events:auto;height:30px;display:flex;align-items:center;gap:7px;
      max-width:240px;min-width:90px;border:1px solid #c9dfd3;
      background:#f7fbf9;color:#175841;border-radius:8px;padding:0 10px;
      box-shadow:0 2px 9px rgba(20,55,40,.12);
      font:600 13px/1.2 system-ui,-apple-system,sans-serif;
      user-select:none;white-space:nowrap;cursor:grab;touch-action:none}
    .chip.dragging{cursor:grabbing}
    .dot{width:7px;height:7px;background:#1d805a;border-radius:99px;flex:none}
    .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    input{font:600 13px system-ui,-apple-system,sans-serif;color:#175841;
      border:0;outline:0;min-width:70px;width:min(180px,60vw);
      background:transparent;letter-spacing:0;padding:0;margin:0;cursor:text}
    .chip:focus-visible{outline:2px solid #458eb5;outline-offset:2px}
  `;
  const chip=document.createElement('div');chip.className='chip';chip.tabIndex=0;
  const dot=document.createElement('span');dot.className='dot';dot.setAttribute('aria-hidden','true');
  const name=document.createElement('span');name.className='name';
  chip.append(dot,name);root.append(style,chip);
  let state={name:'未命名浏览器',show:false,position:{...DEFAULT_POSITION}};
  let editing=false;
  let dragging=null;

  function maxTop() { return Math.max(0,window.innerHeight - node.offsetHeight - 4); }
  function maxRight() { return Math.max(0,window.innerWidth - node.offsetWidth - 4); }
  function validPosition(position) {
    return position && Number.isInteger(position.top) && Number.isInteger(position.right);
  }
  function validStoredPosition(position) {
    return validPosition(position) && position.top >= 0 && position.top <= 8192 &&
      position.right >= 0 && position.right <= 8192;
  }
  function applyPosition(position) {
    // During dragging, negative offsets mean the pointer crossed the top or
    // right edge. Clamp them to the viewport rather than resetting to defaults.
    // Persisted positions remain validated independently by the background.
    const safe = validPosition(position) ? position : DEFAULT_POSITION;
    const next={top:Math.max(0,Math.min(safe.top,maxTop())),
      right:Math.max(0,Math.min(safe.right,maxRight()))};
    node.style.setProperty('top',`${next.top}px`,'important');
    node.style.setProperty('right',`${next.right}px`,'important');
    return next;
  }
  function render(){
    if(editing || dragging)return;
    node.style.setProperty('display',state.show?'block':'none','important');
    name.textContent=state.name;
    chip.title='拖动位置 · 双击修改备注';
    chip.setAttribute('aria-label',`浏览器备注：${state.name}。拖动位置，双击编辑`);
    applyPosition(state.position);
  }
  async function finish(input,original,cancel){
    if(!editing)return;
    editing=false;
    const text=cancel?original:input.value;
    chip.replaceChildren(dot,name);
    state.name=text.trim()||'未命名浏览器';render();
    if(cancel||state.name===original)return;
    try{
      const response=await chrome.runtime.sendMessage({type:'save-ui',changes:{name:state.name}});
      if(!response?.ok)throw new Error('save failed');
      state=response.ui;render();
    }catch{state.name=original;render();chip.title='保存失败，请重试';}
  }
  function edit(){
    if(editing || dragging || !state.show)return;
    editing=true;
    const original=state.name;
    const input=document.createElement('input');
    input.maxLength=24;input.value=original;input.setAttribute('aria-label','编辑浏览器备注');
    chip.replaceChildren(dot,input);
    let cancel=false;
    input.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();input.blur();}
      if(e.key==='Escape'){cancel=true;input.blur();}
      e.stopPropagation();
    });
    input.addEventListener('blur',()=>finish(input,original,cancel),{once:true});
    input.focus();input.select();
  }
  chip.addEventListener('dblclick',event=>{if(event.isTrusted)edit();});
  chip.addEventListener('keydown',event=>{
    if(event.isTrusted&&(event.key==='F2'||event.key==='Enter')){
      event.preventDefault();edit();
    }
  });

  // Only a genuine pointer gesture can reposition the chip. Store distances
  // from the viewport top/right, so all windows in the same Profile keep a
  // consistent location even when their widths differ.
  chip.addEventListener('pointerdown',event=>{
    if(!event.isTrusted || editing || !state.show || event.button!==0 || dragging)return;
    const pos=applyPosition(state.position);
    dragging={id:event.pointerId,x:event.clientX,y:event.clientY,
      initial:pos,moved:false};
    try {chip.setPointerCapture?.(event.pointerId);} catch { /* unsupported */ }
  });
  chip.addEventListener('pointermove',event=>{
    if(!dragging || dragging.id!==event.pointerId || !event.isTrusted)return;
    const dx=event.clientX-dragging.x,dy=event.clientY-dragging.y;
    if(!dragging.moved && Math.hypot(dx,dy)<5)return;
    dragging.moved=true;chip.classList.add('dragging');
    applyPosition({top:Math.round(dragging.initial.top+dy),
      right:Math.round(dragging.initial.right-dx)});
  });
  function endDrag(pointerId){
    if(!dragging || dragging.id!==pointerId)return;
    const previous=dragging;
    dragging=null;
    chip.classList.remove('dragging');
    // Crossing the webpage's top edge can produce pointercancel or release the
    // capture. Keep the last position *inside the webpage* instead of reverting
    // to the starting point. Only the popup's explicit reset restores defaults.
    try {chip.releasePointerCapture?.(pointerId);} catch { /* unsupported */ }
    if(!previous.moved){applyPosition(state.position);return;}
    const position=applyPosition({
      top:Number.parseInt(node.style.top,10),
      right:Number.parseInt(node.style.right,10)
    });
    state.position=position;
    chrome.runtime.sendMessage({type:'save-ui',changes:{position}})
      .then(response=>{if(!response?.ok)throw new Error('save failed');state=response.ui;render();})
      .catch(()=>{state.position=previous.initial;render();chip.title='位置保存失败，请重试';});
  }
  chip.addEventListener('pointerup',event=>{if(event.isTrusted)endDrag(event.pointerId);});
  chip.addEventListener('pointercancel',event=>endDrag(event.pointerId));
  chip.addEventListener('lostpointercapture',event=>endDrag(event.pointerId));
  window.addEventListener('blur',()=>{if(dragging)endDrag(dragging.id);});
  const remountTimes=[];
  function mount(){
    if(!document.documentElement || node.isConnected) return;
    // Prevent a hostile site from triggering an unbounded observer/remount
    // feedback loop by immediately deleting this element on every insertion.
    const now=Date.now();
    while(remountTimes.length && now-remountTimes[0] > 10000) remountTimes.shift();
    if(remountTimes.length >= 12) return;
    remountTimes.push(now);
    document.documentElement.appendChild(node);
  }
  mount();
  if(!node.isConnected) document.addEventListener('DOMContentLoaded',mount,{once:true});
  // A SPA may replace its <html> element or remove direct children. Observe
  // only the document root + direct children, not every DOM mutation on the page.
  if(typeof MutationObserver === 'function') {
    const rootObserver = new MutationObserver(() => {
      mount();
      observeHtml();
    });
    const htmlObserver = new MutationObserver(() => { if(!node.isConnected) mount(); });
    let observedHtml = null;
    function observeHtml() {
      if(document.documentElement && document.documentElement !== observedHtml) {
        htmlObserver.disconnect();
        htmlObserver.observe(document.documentElement,{childList:true});
        observedHtml = document.documentElement;
      }
    }
    rootObserver.observe(document,{childList:true});
    observeHtml();
  }
  window.addEventListener('resize',()=>{if(!dragging&&!editing)applyPosition(state.position);});
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender?.id!==chrome.runtime.id||message?.type!=='leg-ui-changed')return;
    if(typeof message.ui?.name!=='string'||typeof message.ui?.show!=='boolean'||
       !validStoredPosition(message.ui.position))return;
    state=message.ui;render();
  });
  chrome.runtime.sendMessage({type:'get-ui'}).then(response=>{
    if(response?.ok){state=response.ui;render();}
  }).catch(()=>{});
})();
