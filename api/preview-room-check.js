// TEMPORARY: remove with PREVIEW_ROOM_TEST_SECRET after isolated SDK checks.
const crypto = require('node:crypto');
const APP = '168437005e7f6fa2a';
const USERS = { student: 'mem_preview_room_student_a', peer: 'mem_preview_room_student_b', moderator: 'mem_preview_room_moderator', owner: 'mem_preview_room_owner' };
const PRIVATE = 'preview-room-private';
function permitted(env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'codex/practice-chat-room-selection' &&
    env.COMETCHAT_APP_ID === APP && env.COMETCHAT_REGION === 'eu' && env.CHAT_ROOMS_DATA_NAMESPACE === 'preview_room_selection' &&
    typeof env.PREVIEW_ROOM_TEST_SECRET === 'string' && env.PREVIEW_ROOM_TEST_SECRET.length >= 40;
}
function secretMatches(a,b) {
  const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||''));
  return x.length===y.length && x.length>=40 && crypto.timingSafeEqual(x,y);
}
const shell = content => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated Practice Chat verification</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto;padding:20px;background:#f5f7fc;color:#122441}button,input{padding:12px;margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:20px;border-radius:16px}</style>${content}</html>`;
function createHandler(env=process.env,fetcher=fetch) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    if(!permitted(env))return res.status(404).end();
    res.setHeader('Content-Type','text/html; charset=utf-8');
    if(req.method==='GET')return res.status(200).send(shell('<h1>Isolated Practice Chat verification</h1><p>Synthetic accounts only. Production is excluded by server checks.</p><form method="post"><label>Temporary test secret <input name="secret" type="password" autocomplete="off" required></label><input type="hidden" name="action" value="prepare"><button>Prepare SDK checks</button></form>'));
    if(req.method!=='POST')return res.status(405).end();
    let body=req.body;
    if(typeof body==='string')body=Object.fromEntries(new URLSearchParams(body));
    if(!secretMatches(body?.secret,env.PREVIEW_ROOM_TEST_SECRET))return res.status(401).send('Unauthorized');
    const origin=req.headers.origin;
    const allowedOrigins = new Set(['https://speakdobre-cometchat-git-db9a07-ezecharles22436-4127s-projects.vercel.app',
      ...(env.VERCEL_URL ? [`https://${env.VERCEL_URL}`] : [])]);
    if(origin && !allowedOrigins.has(origin))return res.status(403).send('Origin rejected: '+String(origin).replace(/[^A-Za-z0-9:./_-]/g,'')+'; host: '+String(req.headers.host).replace(/[^A-Za-z0-9:./_-]/g,''));
    const api=async(path,method='GET',payload,onBehalfOf)=>{
      const response=await fetcher(`https://${APP}.api-eu.cometchat.io/v3${path}`,{
        method,headers:{apikey:env.COMETCHAT_API_KEY,'Content-Type':'application/json',...(onBehalfOf?{onBehalfOf}:{})},
        body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
      const value=await response.json().catch(()=>({}));
      if(!response.ok)throw Object.assign(new Error('Provider operation failed'),{status:response.status,code:value.error?.code});
      return value.data;
    };
    try {
      if(body.action==='cleanup'){
        for(const uid of Object.values(USERS)){
          try{await api(`/users/${uid}/auth_tokens`,'DELETE');}catch(e){if(e.status!==404)throw e;}
        }
        await api('/users','DELETE',{uidsToDeactivate:Object.values(USERS)});
        return res.status(200).send(shell('<h1>Synthetic credentials revoked and accounts deactivated</h1>'));
      }
      if(body.action!=='prepare')return res.status(400).send('Unsupported action');
      const sessions={};
      for(const [label,uid] of Object.entries(USERS)){
        const role=label==='owner'?'super_moderator':label==='moderator'?'moderator':'student';
        let user;try{user=await api(`/users/${uid}`);}catch(e){if(e.status!==404)throw e;}
        if(!user)user=await api('/users','POST',{uid,name:`Preview ${label}`,role});
        if(user.role!==role)throw new Error('Synthetic role mismatch');
        sessions[label]=(await api(`/users/${uid}/auth_tokens`,'POST',{})).authToken;
      }
      for(const [guid,type] of [[PRIVATE,'private'],['preview-room-public','public']]){
        let group;try{group=await api(`/groups/${guid}`);}catch(e){if(e.status!==404)throw e;}
        if(!group)await api('/groups','POST',{guid,name:`Synthetic ${type} room`,type,owner:USERS.owner});
      }
      const added=await api(`/groups/${PRIVATE}/members`,'POST',{participants:[USERS.student,USERS.peer],moderators:[USERS.moderator]});
      // Existing membership can return per-user already-member errors; SDK checks
      // verify actual resulting permissions instead of treating HTTP 200 as proof.
      await api(`/groups/${PRIVATE}/scopes/moderator/permissions`,'PUT',{permissions:{deleteGroup:'deny'}});
      const historical=await api('/messages','POST',{receiver:USERS.peer,receiverType:'user',category:'message',type:'text',data:{text:'Synthetic historical peer message'}},USERS.student);
      const data=JSON.stringify({users:USERS,sessions,historicalId:historical.id}).replace(/</g,'\\u003c');
      const secret=JSON.stringify(body.secret).replace(/</g,'\\u003c');
      return res.status(200).send(shell(`<h1>Isolated SDK permission checks</h1><p>Only synthetic Preview accounts and rooms.</p><button id="run">Run checks</button><button id="cleanup">Revoke synthetic sessions</button><pre id="results">Ready</pre><script src="https://unpkg.com/@cometchat/chat-sdk-javascript/CometChat.js"></script><script>
const data=${data}, output=document.querySelector('#results'), rows=[];
async function check(name,allowed,fn,verify){try{const value=await fn();rows.push({name,pass:allowed&&(!verify||verify(value)),outcome:'allowed'});}catch(e){rows.push({name,pass:!allowed&&/PERMISSION|DENIED|NOT_ALLOWED|FORBIDDEN|ROLE|NOT_AUTHORIZED/i.test(String(e.code)),outcome:String(e.code||'unknown-error')});}output.textContent=JSON.stringify(rows,null,2);}
document.querySelector('#run').onclick=async function(){this.disabled=true;try{
await CometChat.init('${APP}',new CometChat.AppSettingsBuilder().setRegion('eu').autoEstablishSocketConnection(false).build());
try{await CometChat.logout();}catch(_){}await CometChat.login(data.sessions.student);
const msg=(to,type='user')=>CometChat.sendMessage(new CometChat.TextMessage(to,'Synthetic Preview permission check',type));
await check('student cannot privately message peer',false,()=>msg(data.users.peer));
await check('student can message moderator',true,()=>msg(data.users.moderator));
await check('student can message owner',true,()=>msg(data.users.owner));
await check('student can message joined group',true,()=>msg('${PRIVATE}','group'));
await check('student cannot join public group directly',false,()=>CometChat.joinGroup('preview-room-public',CometChat.GROUP_TYPE.PUBLIC,''));
await check('student cannot create group',false,()=>CometChat.createGroup(new CometChat.Group('preview-student-create-check','Synthetic forbidden group',CometChat.GROUP_TYPE.PRIVATE)));
await check('student directory excludes peers',true,()=>new CometChat.UsersRequestBuilder().setLimit(100).build().fetchNext(),list=>list.every(u=>['moderator','super_moderator'].includes(u.getRole())));
await check('student cannot inspect peer profile',false,()=>CometChat.getUser(data.users.peer));
await check('student can read group member identities',true,()=>new CometChat.GroupMembersRequestBuilder('${PRIVATE}').setLimit(100).build().fetchNext());
await check('student cannot promote self to group admin',false,()=>CometChat.updateGroupMemberScope('${PRIVATE}',data.users.student,CometChat.GROUP_MEMBER_SCOPE.ADMIN));
await check('student cannot kick another member',false,()=>CometChat.kickGroupMember('${PRIVATE}',data.users.peer));
await check('student cannot reply to historical peer DM thread',false,()=>{const m=new CometChat.TextMessage(data.users.peer,'Synthetic blocked thread reply','user');m.setParentMessageId(Number(data.historicalId));return CometChat.sendMessage(m);});
await check('historical peer DM is inaccessible',false,()=>new CometChat.MessagesRequestBuilder().setUID(data.users.peer).setLimit(10).build().fetchPrevious());
await check('student cannot initiate peer call',false,async()=>{const c=await CometChat.initiateCall(new CometChat.Call(data.users.peer,CometChat.CALL_TYPE.AUDIO,CometChat.RECEIVER_TYPE.USER));await CometChat.rejectCall(c.getSessionId(),CometChat.CALL_STATUS.CANCELLED);return c;});
await check('student can reply in group thread',true,async()=>{const parent=await msg('${PRIVATE}','group');const m=new CometChat.TextMessage('${PRIVATE}','Synthetic group thread reply','group');m.setParentMessageId(parent.getId());return CometChat.sendMessage(m);});
await CometChat.logout();await CometChat.login(data.sessions.moderator);
await check('moderator can message student',true,()=>msg(data.users.student));
await check('moderator cannot delete group',false,()=>CometChat.deleteGroup('${PRIVATE}'));
await check('moderator cannot promote self to admin',false,()=>CometChat.updateGroupMemberScope('${PRIVATE}',data.users.moderator,CometChat.GROUP_MEMBER_SCOPE.ADMIN));
await check('moderator can initiate then cancel student call',true,async()=>{const c=await CometChat.initiateCall(new CometChat.Call(data.users.student,CometChat.CALL_TYPE.AUDIO,CometChat.RECEIVER_TYPE.USER));await CometChat.rejectCall(c.getSessionId(),CometChat.CALL_STATUS.CANCELLED);return c;});
await check('moderator can kick a synthetic participant',true,()=>CometChat.kickGroupMember('${PRIVATE}',data.users.peer));
await CometChat.logout();await CometChat.login(data.sessions.owner);
await check('owner can delete synthetic public room',true,()=>CometChat.deleteGroup('preview-room-public'));
await CometChat.logout();output.textContent+='\\nFinished';
}catch(e){output.textContent+='\\nStopped: '+String(e.code||e.name||'unknown');}};
document.querySelector('#cleanup').onclick=async function(){this.disabled=true;try{await CometChat.logout();}catch(_){}const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret:${secret},action:'cleanup'})});output.textContent+=response.ok?'\\nCleanup confirmed':'\\nCleanup failed';};
</script>`));
    }catch(error){return res.status(502).send(shell('<h1>Preparation stopped</h1><p>'+String(error.code||error.status||'Verification failed').replace(/[^A-Za-z0-9_ -]/g,'')+'</p>'));}
  };
}
module.exports=createHandler();module.exports._test={permitted,secretMatches,createHandler};
