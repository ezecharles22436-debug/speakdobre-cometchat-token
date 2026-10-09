export function createOwnerAccessClient({ endpoint, getToken, fetcher = fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid endpoint');
  return async (targetUid, action) => {
    if (!/^mem_[A-Za-z0-9_-]{1,96}$/.test(targetUid) || !['status','suspend','restore'].includes(action)) throw Error('Перевірте ID студента.');
    const token = await getToken();
    if (!token) throw Error('Увійдіть до акаунта.');
    const response = await fetcher(url.href, {method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({targetUid,action}),signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw Error(response.status === 503 ? 'Керування доступом недоступне. Перевірте стан перед повторною дією.' : 'Не вдалося підтвердити дію.');
    const result = await response.json();
    if (result.targetUid !== targetUid || !['active','suspended','revoking','restoring'].includes(result.status)) throw Error('Не підтверджено стан доступу.');
    return result;
  };
}
export function mountOwnerAccess(root, request) {
  const doc=root.ownerDocument, title=doc.createElement('h3'), note=doc.createElement('p');
  const label=doc.createElement('label'), input=doc.createElement('input'), lookup=doc.createElement('button');
  const status=doc.createElement('p'), action=doc.createElement('button'), dialog=doc.createElement('dialog');
  const prompt=doc.createElement('p'), cancel=doc.createElement('button'), confirm=doc.createElement('button');
  title.textContent='Доступ студента до Practice Chat';
  note.textContent='Лише для власника. Призупинення стосується всіх груп Practice Chat. Акаунт, уроки та підписка не змінюються.';
  label.textContent='ID студента (mem_…)'; input.type='text';input.setAttribute('aria-label','ID студента');label.append(input);
  lookup.type=action.type=cancel.type=confirm.type='button';lookup.textContent='Перевірити доступ';action.hidden=true;
  status.setAttribute('role','status');dialog.className='sd-member-confirm';dialog.setAttribute('aria-label','Підтвердження доступу до Practice Chat');
  cancel.textContent='Скасувати';confirm.textContent='Підтвердити';dialog.append(prompt,cancel,confirm);
  root.className='sd-owner-access';root.append(title,note,label,lookup,status,action,dialog);
  let result, pending, disposed=false, busy=false;
  function reset(){result=undefined;action.hidden=true;}
  input.addEventListener('input',reset);
  async function run(uid, operation){
    if(disposed||busy)return;busy=true;input.disabled=lookup.disabled=action.disabled=true;status.textContent='Перевіряємо доступ…';
    try {const value=await request(uid,operation);if(disposed)return;result=value;
      status.textContent=`${value.name||uid}: ${value.status==='active'?'доступ не призупинено':value.status==='suspended'?'доступ призупинено':'операція виконується'}.`;
      if(value.syncError)status.textContent+=' Завершення активних сеансів не підтверджено. Повторіть призупинення.';
      action.hidden=!['active','suspended'].includes(value.status);action.textContent=value.status==='active'?'Призупинити доступ до Practice Chat':'Відновити доступ до Practice Chat';
      if(value.syncError)action.textContent='Повторити призупинення';
    }catch(error){reset();if(!disposed)status.textContent=error.message;}
    finally{busy=false;if(!disposed)input.disabled=lookup.disabled=action.disabled=false;}
  }
  lookup.addEventListener('click',()=>{reset();void run(input.value.trim(),'status');});
  action.addEventListener('click',()=>{
    if(!result||busy)return;pending={uid:result.targetUid,action:result.status==='active'||result.syncError?'suspend':'restore'};
    prompt.textContent=`${pending.action==='suspend'?'Призупинити':'Відновити'} доступ ${result.name||result.targetUid} до всього Practice Chat? Уроки та оплата не змінюються. Відновлення не надає безкоштовної підписки.`;
    dialog.showModal();cancel.focus();
  });
  cancel.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{pending=undefined;});
  confirm.addEventListener('click',()=>{const selection=pending;dialog.close();if(selection)void run(selection.uid,selection.action);});
  return()=>{disposed=true;dialog.close();root.replaceChildren();};
}
