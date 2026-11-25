// Trusted extension UI only. Keep build ID in sync with background.js.
'use strict';
const LegUI = (() => {
  const BUILD = '1.0.2-r20261125.2';
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
  function error(code,reason){return Object.assign(new Error(reason),{code});}
  async function request(message,{read=false}={}) {
    const attempts=read?3:1;
    let last;
    for(let i=0;i<attempts;i++) {
      let timer;
      try {
        const response=await Promise.race([
          chrome.runtime.sendMessage({...message,build:BUILD}),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('LEG-03','后台响应超时')),read?4000:15000);})
        ]);
        if(!response)throw error('LEG-02','后台未返回结果，请重试或重新加载扩展');
        if(response.build!==BUILD)throw error('LEG-01','插件版本不一致，请重新加载扩展');
        if(!response.ok)throw error(response.code||'LEG-04',response.reason||'操作失败，请重试');
        return response;
      }catch(e){last=e.code?e:error('LEG-02','后台未响应，请重试');}
      finally{clearTimeout(timer);}
      if(i+1<attempts)await sleep(250*(i+1));
    }
    throw last;
  }
  return Object.freeze({BUILD,request});
})();
