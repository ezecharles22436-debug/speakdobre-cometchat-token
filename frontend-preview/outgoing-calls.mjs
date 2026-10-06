export function createOutgoingCalls({chat, getSession, authorizeTarget, identity, onState, onAccepted, onEnded}) {
  if(!['moderator','super_moderator'].includes(identity?.role))throw Error('Дзвінки доступні лише модераторам.');
  let current=null,busy=false,disposed=false,epoch=0,target=null,mediaStarted=false;
  const id='sd-outgoing-'+crypto.randomUUID();
  const details=c=>({id:c?.getSessionId(),caller:c?.getCallInitiator()?.getUid(),receiver:c?.getCallReceiver()?.getUid?.(),type:c?.getType(),receiverType:c?.getReceiverType()});
  async function verify() {
    const session=await getSession();
    if(disposed||session?.user?.uid!==identity.uid||session.user.role!==identity.role||!session.token||!target)throw Error('Доступ змінився.');
    const approved=await authorizeTarget(target);
    if(disposed||approved?.actor?.uid!==identity.uid||approved.actor.role!==identity.role||approved.target?.uid!==target.uid||approved.roomGuid!==target.roomGuid)throw Error('Контакт недоступний.');
    return session;
  }
  const reset=()=>{epoch++;current=null;target=null;busy=false;mediaStarted=false;onState('ended');onEnded();};
  function ended(call){if(current&&details(call).id===details(current).id)reset();}
  async function accepted(call) {
    if(disposed||!current||mediaStarted||details(call).id!==details(current).id)return;
    const expected=details(current),version=epoch,info=details(call);
    if(info.caller!==identity.uid||info.receiver!==target?.uid||info.type!==expected.type||info.receiverType!=='user')return;
    current=call;mediaStarted=true;
    try{
      await verify();if(disposed||version!==epoch)return;
      onState('accepted');
      await onAccepted({authorize:async()=>{
        const session=await verify(),active=details(chat.getActiveCall());
        if(disposed||version!==epoch||['id','caller','receiver','type','receiverType'].some(key=>active[key]!==info[key]))throw Error('Дзвінок змінився.');
        return{appId:'168437005e7f6fa2a',allowed:true,uid:identity.uid,role:identity.role,sessionId:info.id,type:info.type==='audio'?'VOICE':'VIDEO',direction:'outgoing',peerIsStaff:false,authToken:session.token};
      },finish:async()=>{if(current&&details(current).id===info.id){current=null;await chat.endCall(info.id);reset();}}});
    }catch{if(!disposed&&version===epoch){await chat.endCall(info.id).catch(()=>{});reset();onState('failed');}}
  }
  chat.addCallListener(id,new chat.CallListener({onOutgoingCallAccepted:accepted,onOutgoingCallRejected:ended,onCallEndedMessageReceived:ended}));
  return{
    async start(selected,type){
      if(disposed||busy||current)return false;
      if(!['audio','video'].includes(type)||!selected?.uid||!selected.roomGuid)throw Error('Некоректний дзвінок.');
      busy=true;target={uid:selected.uid,roomGuid:selected.roomGuid};const version=++epoch;onState('checking');
      try{
        await verify();if(disposed||version!==epoch)return false;
        const call=await chat.initiateCall(new chat.Call(target.uid,type,'user'));
        if(disposed||version!==epoch){await chat.rejectCall(call.getSessionId(),chat.CALL_STATUS.CANCELLED);return false;}
        const info=details(call);
        if(!info.id||info.caller!==identity.uid||info.receiver!==target.uid||info.type!==type||info.receiverType!=='user'){await chat.rejectCall(info.id,chat.CALL_STATUS.CANCELLED);throw Error('Дзвінок змінився.');}
        current=call;onState('ringing');return true;
      }catch{if(!disposed){reset();onState('failed');}return false;}finally{busy=false;}
    },
    async cancel(){const call=current,wasAccepted=mediaStarted;epoch++;current=null;if(call){if(wasAccepted)await chat.endCall(call.getSessionId());else await chat.rejectCall(call.getSessionId(),chat.CALL_STATUS.CANCELLED);}reset();},
    dispose(){disposed=true;epoch++;chat.removeCallListener(id);},
  };
}
