(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SpeakDobreRoomNavigation=api;
})(typeof window==='undefined'?{}:window,function(){
  'use strict';
  // An explicit room/contact rail does not depend on the denied global
  // conversation list. This is UI routing; CometChat remains the authorizer.
  function createNavigator({session,getSession,app}){
    const uid=session?.user?.uid, role=session?.user?.role;
    if(!uid||!['student','moderator','super_moderator'].includes(role))throw Error('Не вдалося перевірити акаунт.');
    let busy=false;
    return async function open(type,id){
      if(busy)return false;
      if(!['group','user'].includes(type)||typeof id!=='string')throw Error('Невідомий чат.');
      busy=true;
      try{
        const fresh=await getSession();
        if(fresh?.user?.uid!==uid||fresh?.user?.role!==role)throw Error('Акаунт змінився. Оновіть сторінку.');
        const allowed=type==='group'
          ? fresh.rooms?.some(room=>room.guid===id&&room.unlocked===true)
          : fresh.staffContacts?.includes(id);
        if(!allowed)throw Error('Цей чат недоступний. Оновіть список груп.');
        if(type==='group')await app.chatWithGroup(id);
        else await app.chatWithUser(id);
        return true;
      }finally{busy=false;}
    };
  }
  function mount({root,session,getSession,app,onChangeGroups}){
    const doc=root.ownerDocument, open=createNavigator({session,getSession,app});
    root.replaceChildren(); root.classList.add('sd-chat-room-rail');
    root.setAttribute('aria-label','Ваші групи та підтримка');
    const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    function button(label,type,id){
      const el=doc.createElement('button');el.type='button';el.textContent=label;
      el.addEventListener('click',async()=>{
        el.disabled=true;status.textContent='Відкриваємо чат…';
        try{if(await open(type,id))status.textContent='';}
        catch{status.textContent='Не вдалося відкрити чат. Оновіть сторінку та перевірте доступ.';}
        finally{el.disabled=false;}
      });root.append(el);
    }
    (session.rooms||[]).filter(room=>room.unlocked===true).forEach(room=>button(room.name,'group',room.guid));
    (session.staffContacts||[]).forEach((id,index)=>button(index?'Модератор '+(index+1):'Зв’язатися з модератором','user',id));
    if(session.user.role==='student'&&onChangeGroups){
      const change=doc.createElement('button');change.type='button';change.textContent='Змінити групи';
      change.addEventListener('click',onChangeGroups);root.append(change);
    }
    root.append(status);
  }
  return {createNavigator,mount};
});
