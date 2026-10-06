// TEMPORARY: remove with PREVIEW_ROOM_TEST_SECRET after isolated SDK checks.
const crypto = require('node:crypto');
const APP = '168437005e7f6fa2a';
const USERS = { student: 'mem_preview_contacts2_student', peer: 'mem_preview_contacts2_peer', moderator: 'mem_preview_contacts2_moderator', owner: 'mem_preview_contacts2_owner' };
const PRIVATE = 'preview-contacts2-private';
const EXPIRES_AT = Date.parse('2026-10-06T11:00:00Z');
function permitted(env, now=Date.now()) {
  return now < EXPIRES_AT && env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'codex/practice-chat-room-selection' &&
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
        for(const student of [USERS.student,USERS.peer]){
          await api('/users/'+student+'/friends','DELETE',{friends:[USERS.moderator,USERS.owner]});
        }
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
      for(const [guid,type] of [[PRIVATE,'private'],['preview-contacts2-public','public']]){
        let group;try{group=await api(`/groups/${guid}`);}catch(e){if(e.status!==404)throw e;}
        if(!group)await api('/groups','POST',{guid,name:`Synthetic ${type} room`,type,owner:USERS.owner});
      }
      const added=await api(`/groups/${PRIVATE}/members`,'POST',{participants:[USERS.student,USERS.peer],moderators:[USERS.moderator]});
      // Existing membership can return per-user already-member errors; SDK checks
      // verify actual resulting permissions instead of treating HTTP 200 as proof.
      await api(`/groups/${PRIVATE}/scopes/moderator/permissions`,'PUT',{permissions:{deleteGroup:'deny'}});
      // Only synthetic student/staff IDs. No peer-to-peer friendship is created.
      for(const student of [USERS.student,USERS.peer]) {
        const staff=[USERS.moderator,USERS.owner];
        const added=await api('/users/'+student+'/friends','POST',{accepted:staff,addToConversations:false});
        if(!staff.every(uid=>added?.accepted?.[uid]?.success===true))throw new Error('Staff contacts not confirmed');
        const contacts=await api('/users/'+student+'/friends?perPage=100&page=1');
        if(!Array.isArray(contacts)||contacts.length!==2||!contacts.every(u=>staff.includes(u.uid)))throw new Error('Unexpected contacts');
      }
      const fixtures={};
      const seed=async(label,sender,receiver,type='user',parent)=>{
        const value=await api('/messages','POST',{receiver,receiverType:type,category:'message',type:'text',data:{text:'Synthetic history fixture '+label},...(parent?{parentMessageId:parent}:{})},sender);
        fixtures[label]=String(value.id);return value.id;
      };
      await api('/users/'+USERS.student,'PUT',{role:'default'});
      await api('/users/'+USERS.peer,'PUT',{role:'default'});
      try {
        const parent=await seed('peerInbound',USERS.peer,USERS.student);
        await seed('peerOutbound',USERS.student,USERS.peer);
        await seed('peerThread',USERS.peer,USERS.student,'user',parent);
      } finally {
        await api('/users/'+USERS.student,'PUT',{role:'student'});
        await api('/users/'+USERS.peer,'PUT',{role:'student'});
      }
      await seed('moderatorInbound',USERS.moderator,USERS.student);
      await seed('moderatorOutbound',USERS.student,USERS.moderator);
      await seed('ownerInbound',USERS.owner,USERS.student);
      await seed('ownerOutbound',USERS.student,USERS.owner);
      const groupParent=await seed('groupPeer',USERS.peer,PRIVATE,'group');
      await seed('groupStudent',USERS.student,PRIVATE,'group');
      await seed('groupModerator',USERS.moderator,PRIVATE,'group');
      await seed('groupThread',USERS.peer,PRIVATE,'group',groupParent);
      const data=JSON.stringify({users:USERS,sessions,fixtures,historicalId:fixtures.peerInbound}).replace(/</g,'\\u003c');
      const secret=JSON.stringify(body.secret).replace(/</g,'\\u003c');
      return res.status(200).send(shell(`<h1>Isolated SDK permission checks</h1><p>Only synthetic Preview accounts and rooms.</p><button id="run">Run checks</button><button id="cleanup">Revoke synthetic sessions</button><pre id="results">Ready</pre><script src="https://unpkg.com/@cometchat/chat-sdk-javascript/CometChat.js"></script><script>
const data=${data}, output=document.querySelector('#results'), rows=[];
async function check(name,allowed,fn,verify){try{const value=await fn();rows.push({name,pass:allowed&&(!verify||verify(value)),outcome:'allowed'});}catch(e){rows.push({name,pass:!allowed&&/PERMISSION|DENIED|NOT_ALLOWED|FORBIDDEN|ROLE|NOT_AUTHORIZED|NO_SELF_ACTION/i.test(String(e.code)),outcome:String(e.code||'unknown-error')});}output.textContent=JSON.stringify(rows,null,2);}
document.querySelector('#run').onclick=async function(){this.disabled=true;try{
await CometChat.init('${APP}',new CometChat.AppSettingsBuilder().setRegion('eu').autoEstablishSocketConnection(false).build());
try{await CometChat.logout();}catch(_){}await CometChat.login(data.sessions.student);
const msg=(to,type='user')=>CometChat.sendMessage(new CometChat.TextMessage(to,'Synthetic Preview permission check',type));
await check('student cannot privately message peer',false,()=>msg(data.users.peer));
await check('student can message moderator',true,()=>msg(data.users.moderator));
await check('student can message owner',true,()=>msg(data.users.owner));
await check('student can message joined group',true,()=>msg('${PRIVATE}','group'));
await check('student cannot join public group directly',false,()=>CometChat.joinGroup('preview-contacts2-public',CometChat.GROUP_TYPE.PUBLIC,''));
await check('student cannot create group',false,()=>CometChat.createGroup(new CometChat.Group('preview-student-create-check','Synthetic forbidden group',CometChat.GROUP_TYPE.PRIVATE)));
await check('student directory excludes peers',true,()=>new CometChat.UsersRequestBuilder().setLimit(100).build().fetchNext(),list=>list.every(u=>['moderator','super_moderator'].includes(u.getRole())));
await check('student cannot inspect peer profile',false,()=>CometChat.getUser(data.users.peer));
await check('student can read group member identities',true,()=>new CometChat.GroupMembersRequestBuilder('${PRIVATE}').setLimit(100).build().fetchNext());
await check('student cannot promote self to group admin',false,()=>CometChat.updateGroupMemberScope('${PRIVATE}',data.users.student,CometChat.GROUP_MEMBER_SCOPE.ADMIN));
await check('student cannot kick another member',false,()=>CometChat.kickGroupMember('${PRIVATE}',data.users.peer));
await check('student cannot reply to historical peer DM thread',false,()=>{const m=new CometChat.TextMessage(data.users.peer,'Synthetic blocked thread reply','user');m.setParentMessageId(Number(data.historicalId));return CometChat.sendMessage(m);});
const ids=list=>list.map(m=>String(m.getId()));
const contains=(list,keys)=>keys.every(k=>ids(list).includes(data.fixtures[k]));
async function privacy(name,fn){try{const v=await fn();rows.push({name,pass:Array.isArray(v)&&v.length===0,outcome:Array.isArray(v)?'returned '+v.length+' records':'returned message'});}catch(e){rows.push({name,pass:/PERMISSION|DENIED|NOT_ALLOWED|FORBIDDEN|NOT_AUTHORIZED|NOT_FOUND/.test(String(e.code)),outcome:String(e.code||'unknown-error')});}output.textContent=JSON.stringify(rows,null,2);}
await privacy('peer history hides both directions',()=>new CometChat.MessagesRequestBuilder().setUID(data.users.peer).setLimit(100).build().fetchPrevious());
await privacy('known inbound peer message is inaccessible',()=>CometChat.getMessageDetails(Number(data.fixtures.peerInbound)));
await privacy('known outbound peer message is inaccessible',()=>CometChat.getMessageDetails(Number(data.fixtures.peerOutbound)));
await privacy('peer thread history inaccessible',()=>new CometChat.MessagesRequestBuilder().setParentMessageId(Number(data.fixtures.peerInbound)).setLimit(100).build().fetchPrevious());
await check('group history keeps peer own and staff messages',true,()=>new CometChat.MessagesRequestBuilder().setGUID('${PRIVATE}').setLimit(100).build().fetchPrevious(),list=>contains(list,['groupPeer','groupStudent','groupModerator']));
await check('group thread history keeps peer replies',true,()=>new CometChat.MessagesRequestBuilder().setParentMessageId(Number(data.fixtures.groupPeer)).setLimit(100).build().fetchPrevious(),list=>contains(list,['groupThread']));
await check('group-scoped thread history keeps peer replies',true,()=>new CometChat.MessagesRequestBuilder().setGUID('${PRIVATE}').setParentMessageId(Number(data.fixtures.groupPeer)).setLimit(100).build().fetchPrevious(),list=>contains(list,['groupThread']));
await privacy('peer-scoped thread stays inaccessible',()=>new CometChat.MessagesRequestBuilder().setUID(data.users.peer).setParentMessageId(Number(data.fixtures.peerInbound)).setLimit(100).build().fetchPrevious());
await check('group message details readable',true,()=>CometChat.getMessageDetails(Number(data.fixtures.groupPeer)),m=>String(m.getId())===data.fixtures.groupPeer);
await check('moderator history keeps both directions',true,()=>new CometChat.MessagesRequestBuilder().setUID(data.users.moderator).setLimit(100).build().fetchPrevious(),list=>contains(list,['moderatorInbound','moderatorOutbound']));
await check('owner history keeps both directions',true,()=>new CometChat.MessagesRequestBuilder().setUID(data.users.owner).setLimit(100).build().fetchPrevious(),list=>contains(list,['ownerInbound','ownerOutbound']));
await check('conversation list hides peer',true,()=>new CometChat.ConversationsRequestBuilder().setLimit(50).build().fetchNext(),list=>list.every(c=>!(c.getConversationType()==='user'&&c.getConversationWith()?.getUid()===data.users.peer)));
await check('student cannot initiate peer call',false,async()=>{const c=await CometChat.initiateCall(new CometChat.Call(data.users.peer,CometChat.CALL_TYPE.AUDIO,CometChat.RECEIVER_TYPE.USER));await CometChat.rejectCall(c.getSessionId(),CometChat.CALL_STATUS.CANCELLED);return c;});
await check('student can reply in group thread',true,async()=>{const parent=await msg('${PRIVATE}','group');const m=new CometChat.TextMessage('${PRIVATE}','Synthetic group thread reply','group');m.setParentMessageId(parent.getId());return CometChat.sendMessage(m);});
await CometChat.logout();await CometChat.login(data.sessions.moderator);
await check('moderator can message student',true,()=>msg(data.users.student));
await check('moderator cannot delete group',false,()=>CometChat.deleteGroup('${PRIVATE}'));
await check('moderator cannot promote self to admin',false,()=>CometChat.updateGroupMemberScope('${PRIVATE}',data.users.moderator,CometChat.GROUP_MEMBER_SCOPE.ADMIN));
await check('moderator can initiate then cancel student call',true,async()=>{const c=await CometChat.initiateCall(new CometChat.Call(data.users.student,CometChat.CALL_TYPE.AUDIO,CometChat.RECEIVER_TYPE.USER));await CometChat.rejectCall(c.getSessionId(),CometChat.CALL_STATUS.CANCELLED);return c;});
await check('moderator can kick a synthetic participant',true,()=>CometChat.kickGroupMember('${PRIVATE}',data.users.peer));
await CometChat.logout();await CometChat.login(data.sessions.owner);
await check('owner can delete synthetic public room',true,()=>CometChat.deleteGroup('preview-contacts2-public'));
await CometChat.logout();output.textContent+='\\nFinished';
}catch(e){output.textContent+='\\nStopped: '+String(e.code||e.name||'unknown');}};
document.querySelector('#cleanup').onclick=async function(){this.disabled=true;try{await CometChat.logout();}catch(_){}const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({secret:${secret},action:'cleanup'})});output.textContent+=response.ok?'\\nCleanup confirmed':'\\nCleanup failed';};
</script>`));
    }catch(error){return res.status(502).send(shell('<h1>Preparation stopped</h1><p>'+String(error.code||error.status||'Verification failed').replace(/[^A-Za-z0-9_ -]/g,'')+'</p>'));}
  };
}
module.exports=createHandler();module.exports._test={permitted,secretMatches,createHandler};

