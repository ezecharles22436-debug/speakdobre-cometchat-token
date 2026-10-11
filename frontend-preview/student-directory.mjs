// Read-only staff directory over existing moderated group memberships.
// Opening a private conversation still uses the existing server target gate.
export function createStudentDirectory({identity, prepare, getSession, createRequest, onSelect, onState, pageSize=20}) {
  if (!identity?.uid || !['moderator','super_moderator'].includes(identity.role)) throw Error('Доступ лише для модераторів.');
  let pages=[], rows=new Map(), busy=false, disposed=false, generation=0;
  const emit=(error='',notice='')=>{if(!disposed)onState({rows:[...rows.values()],busy,more:pages.some(p=>p.more),error,notice});};
  async function check(version) {
    const s=await getSession();
    if(disposed || version!==generation || !s?.token || s.user?.uid!==identity.uid || s.user.role!==identity.role) throw Error('changed');
    if(pages.some(p=>!s.rooms?.some(r=>r.guid===p.room.guid && r.unlocked===true))) throw Error('changed');
    return s;
  }
  async function fetchPage(version) {
    const additions=[];
    await check(version);
    // Bound provider concurrency; each request paginates a single permitted group.
    const pending=pages.filter(p=>p.more);
    for(let i=0;i<pending.length;i+=3) {
      if(disposed||version!==generation)throw Error('changed');
      const batch=await Promise.all(pending.slice(i,i+3).map(async p=>{
        const members=await p.request.fetchNext();
        if(!Array.isArray(members)||members.length>pageSize)throw Error('Invalid page');
        return {p,members};
      }));
      if(disposed||version!==generation)throw Error('changed');
      for(const {p,members} of batch) {
        p.more=members.length===pageSize;
        for(const member of members) {
          const uid=member.getUid();
          if(!/^mem_[A-Za-z0-9_-]{1,96}$/.test(uid)||uid===identity.uid||member.getScope()!=='participant'||member.getRole?.()!=='student')continue;
          const name=member.getName();
          additions.push({uid,name:typeof name==='string'&&name.trim()?name.slice(0,120):'Студент',room:{guid:p.room.guid,name:p.room.name}});
        }
      }
    }
    await check(version);
    for(const item of additions) {
      const row=rows.get(item.uid)||{uid:item.uid,name:item.name,rooms:[]};
      if(!row.rooms.some(r=>r.guid===item.room.guid))row.rooms.push(item.room);
      rows.set(item.uid,row);
    }
  }
  async function run(operation) {
    if(disposed||busy)return false;
    const version=++generation;busy=true;emit();
    try {await operation(version);busy=false;emit();return true;}
    catch {busy=false;rows.clear();pages=[];emit('Не вдалося завантажити студентів. Оновіть список або сторінку.');return false;}
  }
  return {
    refresh(query='') {return run(async version=>{
      rows.clear();pages=[];emit();
      const s=await prepare();
      if(disposed||version!==generation)throw Error('changed');
      if(s?.user?.uid!==identity.uid||s.user.role!==identity.role||!s.token)throw Error('changed');
      const seen=new Set();
      pages=(s.rooms||[]).filter(r=>r.unlocked===true&&typeof r.guid==='string'&&!seen.has(r.guid)&&seen.add(r.guid))
        .map(room=>({room:{guid:room.guid,name:room.name||room.guid},more:true,request:createRequest(room.guid,pageSize,String(query).trim().slice(0,80))}));
      await fetchPage(version);
    });},
    more() {return run(fetchPage);},
    async select(uid) {
      const row=rows.get(uid);if(!row||busy||disposed)return false;
      busy=true;emit();const version=generation;
      try {
        await check(version);
        // The adapter authorizes the selected target before and after SDK login.
        const result=await onSelect(uid,row.rooms[0].guid);
        await check(version);
        if(result!==true)throw Error('not opened');
        busy=false;emit('',`Відкрито розмову: ${row.name}.`);return true;
      }catch{busy=false;rows.clear();pages=[];emit('Розмова недоступна. Перевірте доступ студента та оновіть список.');return false;}
    },
    dispose(){disposed=true;generation++;rows.clear();pages=[];}
  };
}

export function mountStudentDirectory(container, options) {
  const doc=container.ownerDocument;
  const heading=doc.createElement('h2'),help=doc.createElement('p'),form=doc.createElement('form');
  const input=doc.createElement('input'),search=doc.createElement('button'),list=doc.createElement('div');
  const status=doc.createElement('p'),more=doc.createElement('button');
  heading.textContent='Студенти Practice Chat';
  help.textContent='Знайдіть студента у своїх групах і відкрийте особисту розмову. Натискання «Написати» не надсилає повідомлення.';
  input.type='search';input.placeholder='Пошук за ім’ям';input.maxLength=80;input.setAttribute('aria-label','Пошук студента за ім’ям');
  search.type='submit';search.textContent='Знайти';form.className='sd-directory-search';form.append(input,search);
  list.className='sd-directory-list';list.setAttribute('aria-label','Список студентів');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  more.type='button';more.textContent='Показати ще';more.hidden=true;
  container.replaceChildren(heading,help,form,status,list,more);
  const directory=createStudentDirectory({...options,onState(state){
    list.replaceChildren();input.disabled=search.disabled=state.busy;more.disabled=state.busy;more.hidden=!state.more;
    for(const row of state.rows){
      const card=doc.createElement('div'),details=doc.createElement('div'),name=doc.createElement('strong'),groups=doc.createElement('span'),button=doc.createElement('button');
      card.className='sd-directory-row';name.textContent=row.name;groups.textContent=row.rooms.map(r=>r.name).join(' · ');
      details.append(name,groups);button.type='button';button.textContent='Написати';button.setAttribute('aria-label',`Написати: ${row.name}`);button.disabled=state.busy;
      button.addEventListener('click',()=>{void directory.select(row.uid);});card.append(details,button);list.append(card);
    }
    status.textContent=state.error||state.notice||(state.busy?'Завантажуємо студентів…':state.rows.length?`Знайдено студентів: ${state.rows.length}${state.more?' · доступні наступні результати':''}`:'Студентів не знайдено. Спробуйте інше ім’я.');
  }});
  form.addEventListener('submit',event=>{event.preventDefault();void directory.refresh(input.value);});
  more.addEventListener('click',()=>{void directory.more();});
  return {open:()=>directory.refresh(input.value),dispose(){directory.dispose();container.replaceChildren();}};
}
