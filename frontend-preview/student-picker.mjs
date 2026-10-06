export function createStudentPicker({identity,roomGuid,getSession,createRequest,authorizeStudent,onSelect,onState,pageSize=30}) {
  if(!identity?.uid||!['moderator','super_moderator'].includes(identity.role)||!roomGuid)throw Error('Доступ лише для модераторів.');
  let request, rows=[], busy=false, more=true, disposed=false;
  const emit=(error='')=>{if(!disposed)onState({rows:[...rows],busy,more,error});};
  async function check(){
    const session=await getSession();
    if(disposed||!session?.token||session.user?.uid!==identity.uid||session.user.role!==identity.role||!session.rooms?.some(room=>room.guid===roomGuid&&room.unlocked===true))throw Error('Доступ до групи змінився.');
  }
  return{
    async loadMore(){
      if(disposed||busy||!more)return false;busy=true;emit();
      try{
        await check();request ||= createRequest(roomGuid,pageSize);
        const page=await request.fetchNext();await check();
        if(!Array.isArray(page)||page.length>pageSize)throw Error('Некоректна відповідь.');
        const seen=new Set(rows.map(row=>row.uid));
        const additions=[];
        for(const member of page){
          const uid=member.getUid(),scope=member.getScope();
          if(!/^mem_[A-Za-z0-9_-]{1,96}$/.test(uid)||scope!=='participant'||uid===identity.uid||seen.has(uid))continue;
          seen.add(uid);additions.push({uid,name:member.getName()||'Студент'});
        }
        rows.push(...additions);more=page.length===pageSize;busy=false;emit();return true;
      }catch{busy=false;rows=[];more=false;emit('Не вдалося завантажити учасників. Відкрийте групу повторно.');return false;}
    },
    async select(uid){
      if(disposed||busy||!rows.some(row=>row.uid===uid))return false;busy=true;emit();
      try{
        await check();const approved=await authorizeStudent({uid,roomGuid});await check();
        if(approved?.actor?.uid!==identity.uid||approved.actor.role!==identity.role||approved.target?.uid!==uid||approved.roomGuid!==roomGuid)throw Error('Контакт недоступний.');
        await onSelect(uid,roomGuid);busy=false;emit();return true;
      }catch{busy=false;emit('Контакт недоступний. Можливо, доступ студента завершився.');return false;}
    },
    dispose(){disposed=true;rows=[];request=undefined;},
  };
}

export function mountStudentPicker(container,options){
  const doc=container.ownerDocument;
  container.className='sd-student-picker';container.setAttribute('aria-label','Учасники групи для модератора');
  const title=doc.createElement('h3');title.textContent='Студенти цієї групи';
  const list=doc.createElement('div');list.className='sd-student-list';
  const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const more=doc.createElement('button');more.type='button';more.textContent='Показати учасників';
  container.replaceChildren(title,list,status,more);
  const picker=createStudentPicker({...options,onState(state){
    list.replaceChildren();
    for(const row of state.rows){const button=doc.createElement('button');button.type='button';button.textContent=row.name;button.setAttribute('aria-label',`Відкрити розмову: ${row.name}`);button.disabled=state.busy;button.addEventListener('click',()=>{void picker.select(row.uid);});list.append(button);}
    more.disabled=state.busy;more.hidden=!state.more;more.textContent=state.rows.length?'Показати ще':'Показати учасників';
    status.textContent=state.error||(state.busy?'Перевіряємо доступ…':!state.rows.length&&!state.more?'У цій групі немає доступних студентів.':'');
  }});
  more.addEventListener('click',()=>{void picker.loadMore();});
  return()=>{picker.dispose();container.replaceChildren();};
}
