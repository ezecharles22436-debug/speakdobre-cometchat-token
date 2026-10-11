// Only server-authorized staff contacts. Never enumerate all users/conversations.
const clean = (value, limit = 120) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const contactIds = session => [...new Set((session.staffContacts || []).filter(id =>
  typeof id === 'string' && /^mem_[A-Za-z0-9_-]{1,96}$/.test(id) && id !== session.user.uid))];

export function conversationSummary(uid, user, conversation) {
  const peer = conversation?.getConversationWith?.();
  if (user && user.getUid?.() !== uid) throw Error('Unexpected contact');
  if (conversation && (conversation.getConversationType?.() !== 'user' || peer?.getUid?.() !== uid)) throw Error('Unexpected conversation');
  const last = conversation?.getLastMessage?.();
  const type = last?.getType?.();
  const count = conversation?.getUnreadMessageCount?.();
  const timestamp = last?.getSentAt?.();
  return {
    uid, name: clean(user?.getName?.() || peer?.getName?.()) || 'Модератор SpeakDobre',
    preview: type === 'text' ? clean(last.getText?.(), 140) :
      ({image:'Фото',audio:'Голосове повідомлення',video:'Відео',file:'Файл'})[type] || (last ? 'Повідомлення' : 'Відкрити особисту розмову'),
    unread: Number.isSafeInteger(count) && count >= 0 ? count : null,
    sentAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0,
  };
}

export function createStudentInbox({identity, prepare, getSession, readContact, subscribe, onSelect, onState}) {
  if (!identity?.uid || identity.role !== 'student') throw Error('Доступ лише для студентів.');
  let rows = [], allowed = new Set(), busy = false, disposed = false, generation = 0, connected = false, unsubscribe;
  let pending = null, queued = false;
  const emit = (error = '') => { if (!disposed) onState({rows:rows.map(row => ({...row})),busy,error,
    unread:rows.reduce((sum,row) => sum + (row.unread || 0),0)}); };
  function check(session, version) {
    if (disposed || version !== generation || !session?.token || session.user?.uid !== identity.uid || session.user.role !== 'student') throw Error('Changed session');
    return session;
  }
  async function refresh() {
    if (disposed) return false;
    if (pending) { queued = true; return pending; }
    if (busy) { queued = true; return false; }
    const version = generation;
    busy = true; emit();
    pending = (async () => {
      try {
        const session = check(await (connected ? getSession() : prepare()),version);
        connected = true;
        if (!unsubscribe) unsubscribe = subscribe?.(events);
        const ids = contactIds(session);
        // Clear removed contacts immediately, before awaiting provider metadata.
        allowed = new Set(ids); rows = rows.filter(row => allowed.has(row.uid)); emit();
        const result = [];
        for (let i = 0; i < ids.length; i += 3) {
          const permitted = new Set(contactIds(check(await getSession(),version)));
          if(ids.some(id=>!permitted.has(id)))throw Error('Contact access changed');
          const batch = await Promise.all(ids.slice(i,i+3).map(async uid => {
            try { const row = await readContact(uid); if (row?.uid !== uid) throw Error('Unexpected contact'); return row; }
            catch { return {uid,name:'Модератор SpeakDobre',preview:'Відкрити розмову · огляд недоступний',unread:null,sentAt:0}; }
          }));
          result.push(...batch);
        }
        const fresh = check(await getSession(),version);
        const freshIds = new Set(contactIds(fresh));
        if (ids.some(id => !freshIds.has(id))) throw Error('Contact access changed');
        rows = result.sort((a,b) => b.sentAt-a.sentAt);
        busy = false; emit(); return true;
      } catch {
        if (!disposed && version === generation) {
          connected = false; allowed.clear(); rows = []; busy = false;
          emit('Не вдалося оновити повідомлення. Спробуйте ще раз.');
        }
        return false;
      } finally {
        pending = null;
        if (queued && !disposed && version === generation) { queued = false; void refresh(); }
      }
    })();
    return pending;
  }
  const events = {
    message(message) {
      const uid = message?.getSender?.()?.getUid?.();
      const recipient = message?.getReceiverId?.();
      // No peer data or group messages are displayed by this private inbox.
      if (message?.getReceiverType?.() === 'user' && recipient === identity.uid && allowed.has(uid)) void refresh();
    },
    logout() { generation++; connected=false; allowed.clear(); rows=[]; busy=false; queued=false; emit(); },
  };
  return {
    refresh,
    async select(uid) {
      if (disposed || busy || !allowed.has(uid)) return false;
      const version = generation;
      busy = true; emit();
      try {
        const fresh = check(await getSession(),version);
        if (!contactIds(fresh).includes(uid)) throw Error('Unavailable contact');
        // Existing adapter performs pre/post-login identity and target checks.
        const opened = await onSelect(uid);
        const after = check(await getSession(),version);
        if (!contactIds(after).includes(uid)) throw Error('Contact access changed');
        if (opened !== true) throw Error('Not opened');
        rows = rows.map(row => row.uid === uid ? {...row,unread:0} : row);
        busy = false; emit(); return true;
      } catch {
        if (!disposed && version === generation) { allowed.clear(); rows=[]; busy=false; emit('Розмова недоступна. Оновіть список повідомлень.'); }
        return false;
      } finally {
        if (queued && !disposed && version === generation) { queued=false; void refresh(); }
      }
    },
    dispose() { disposed=true; generation++; unsubscribe?.(); allowed.clear(); rows=[]; },
  };
}

export function mountStudentInbox(container, options) {
  const doc=container.ownerDocument, toolbar=doc.createElement('div'), toggle=doc.createElement('button');
  const badge=doc.createElement('span'), panel=doc.createElement('section'), heading=doc.createElement('h2');
  const help=doc.createElement('p'), refresh=doc.createElement('button'), status=doc.createElement('p'), list=doc.createElement('div');
  container.className='sd-student-inbox'; toolbar.className='sd-inbox-toolbar';
  toggle.type='button'; toggle.textContent='Повідомлення'; toggle.setAttribute('aria-expanded','false');
  badge.className='sd-inbox-badge'; badge.hidden=true; toggle.append(badge);
  panel.hidden=true; panel.setAttribute('aria-label','Особисті повідомлення');
  heading.textContent='Особисті повідомлення'; help.textContent='Ваші розмови з командою SpeakDobre. До них можна повернутися з будь-якої групи.';
  refresh.type='button'; refresh.textContent='Оновити'; refresh.setAttribute('aria-label','Оновити особисті повідомлення');
  status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); list.className='sd-inbox-list';
  toolbar.append(toggle); panel.append(heading,help,refresh,status,list); container.replaceChildren(toolbar,panel);
  const inbox=createStudentInbox({...options,onState(state){
    badge.textContent=String(state.unread); badge.hidden=!state.unread;
    toggle.setAttribute('aria-label',state.unread?`Повідомлення · непрочитаних: ${state.unread}`:'Повідомлення');
    refresh.disabled=state.busy; list.replaceChildren();
    for (const row of state.rows) {
      const item=doc.createElement('button'), details=doc.createElement('span'), name=doc.createElement('strong'), preview=doc.createElement('span');
      item.type='button'; item.className='sd-inbox-row'; item.disabled=state.busy;
      item.setAttribute('aria-label',`Відкрити розмову: ${row.name}${row.unread?` · непрочитаних: ${row.unread}`:''}`);
      name.textContent=row.name; preview.textContent=row.preview; details.append(name,preview); item.append(details);
      if(row.unread){const count=doc.createElement('span');count.className='sd-inbox-badge';count.textContent=String(row.unread);item.append(count);}
      item.addEventListener('click',async()=>{if(await inbox.select(row.uid)){panel.hidden=true;toggle.setAttribute('aria-expanded','false');options.onOpened?.();}});
      list.append(item);
    }
    status.textContent=state.error||(state.busy?'Оновлюємо повідомлення…':state.rows.length?'':'Особистих контактів поки немає.');
  }});
  toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)void inbox.refresh();});
  refresh.addEventListener('click',()=>{void inbox.refresh();});
  const onVisibility=()=>{if(doc.visibilityState==='visible')void inbox.refresh();};
  doc.addEventListener('visibilitychange',onVisibility);
  return {start:inbox.refresh,refresh:inbox.refresh,
    close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');},
    dispose(){inbox.dispose();doc.removeEventListener('visibilitychange',onVisibility);container.replaceChildren();}};
}
