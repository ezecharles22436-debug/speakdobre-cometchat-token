(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SpeakDobreRoomPresentation=api;
})(typeof window==='undefined'?{}:window,function(){
  'use strict';
  // Presentation only. Provider permissions remain the access-control boundary.
  function stylesForRole(role){
    if(!['student','moderator','super_moderator'].includes(role))throw Error('Невідома роль чату.');
    return role==='student'
      ? 'button[title="Voice call"],button[title="Video call"],button[title="Голосовий виклик"],button[title="Відеовиклик"]{display:none!important}'
      : '';
  }
  function mount({container,role}){
    const css=stylesForRole(role),doc=container.ownerDocument;
    const Observer=doc.defaultView.MutationObserver;
    const frames=new Set();
    function apply(frame){
      let inner;try{inner=frame.contentDocument;}catch{return;}
      if(!inner?.head)return;
      let style=inner.getElementById('sd-role-presentation');
      if(!style){style=inner.createElement('style');style.id='sd-role-presentation';inner.head.append(style);}
      if(style.textContent!==css)style.textContent=css;
    }
    const handlers=new Map();
    function scan(){
      container.querySelectorAll('iframe').forEach(frame=>{
        if(!frames.has(frame)){
          frames.add(frame);const handler=()=>apply(frame);handlers.set(frame,handler);frame.addEventListener('load',handler);
        }
        apply(frame);
      });
    }
    scan();const observer=new Observer(scan);observer.observe(container,{childList:true,subtree:true});
    return ()=>{
      observer.disconnect();
      frames.forEach(frame=>{
        frame.removeEventListener('load',handlers.get(frame));
        try{frame.contentDocument?.getElementById('sd-role-presentation')?.remove();}catch{}
      });
    };
  }
  return {stylesForRole,mount};
});
