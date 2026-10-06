export function createStaffTargetClient({endpoint,getMemberstackToken,fetcher=fetch}) {
  const url=new URL(endpoint);
  if(url.origin!=='https://speakdobre-cometchat-git-db9a07-ezecharles22436-4127s-projects.vercel.app')throw Error('Доступна лише перевірена Preview-адреса.');
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/api/chat-staff-target')throw Error('Некоректна адреса перевірки контакту.');
  return async ({uid,roomGuid})=>{
    const token=await getMemberstackToken();if(!token)throw Error('Увійдіть до акаунта.');
    const response=await fetcher(url.href,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({targetUid:uid,roomGuid}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Контакт недоступний. Перевірте доступ.');
    return response.json();
  };
}
