// Provider events + fresh existing server session, not URL/form supplied grants.
// This client routing check complements, never replaces, provider permissions.
export function createIncomingCalls({ chat, getSession, identity, onOffer, onAccepted, onEnded, onError }) {
  if (!identity?.uid || !['student','moderator','super_moderator'].includes(identity.role)) throw Error('Невідомий акаунт.');
  const id = 'sd-incoming-' + crypto.randomUUID();
  let current = null, accepted = false, offered = false, busy = false, disposed = false, epoch = 0;
  const describe = call => ({ sessionId:call?.getSessionId(), caller:call?.getCallInitiator()?.getUid(), receiver:call?.getCallReceiver()?.getUid?.(), type:call?.getType(), receiverType:call?.getReceiverType() });
  async function validate(call) {
    const info = describe(call), session = await getSession();
    if (disposed || session?.user?.uid !== identity.uid || session.user.role !== identity.role || !session.token ||
      info.receiver !== identity.uid || info.receiverType !== 'user' || !info.sessionId ||
      !['audio','video'].includes(info.type) || !session.staffContacts?.includes(info.caller)) throw Error('Цей дзвінок недоступний.');
    return { ...info, authToken:session.token };
  }
  const same = (a,b) => ['sessionId','caller','receiver','type','receiverType'].every(key=>a[key]===b[key]);
  const clear = () => { epoch++; current=null; accepted=false; offered=false; busy=false; onOffer(null); onEnded(); };
  async function receive(call) {
    if (disposed || current) return;
    const version=++epoch; current=call;
    try { await validate(call); if(disposed||version!==epoch)return; offered=true; onOffer({type:call.getType(), callerName:call.getCallInitiator().getName()}); }
    catch { if(!disposed&&version===epoch){clear();onError('Не вдалося перевірити вхідний дзвінок.');} }
  }
  function ended(call) { if(current && describe(call).sessionId===describe(current).sessionId)clear(); }
  chat.addCallListener(id,new chat.CallListener({onIncomingCallReceived:receive,onIncomingCallCancelled:ended,onCallEndedMessageReceived:ended}));
  return {
    async accept() {
      if(disposed||!current||!offered||busy||accepted)return false;
      busy=true; const call=current, version=epoch;
      try {
        const expected=await validate(call);
        if(disposed||epoch!==version) return false;
        const result=await chat.acceptCall(expected.sessionId);
        if(disposed||epoch!==version){await chat.endCall(expected.sessionId);return false;}
        if(!same(describe(result),expected)){await chat.endCall(expected.sessionId);throw Error('Дзвінок змінився.');}
        current=result;accepted=true;onOffer(null);
        await onAccepted({
          authorize: async()=>{
            if(disposed||!accepted||epoch!==version)throw Error('Дзвінок завершено.');
            const fresh=await validate(result);
            if(disposed||epoch!==version||!same(fresh,expected)||!same(describe(chat.getActiveCall()),expected))throw Error('Дзвінок змінився.');
            return{appId:'168437005e7f6fa2a',allowed:true,uid:identity.uid,role:identity.role,sessionId:fresh.sessionId,type:fresh.type==='audio'?'VOICE':'VIDEO',direction:'incoming',peerIsStaff:true,authToken:fresh.authToken};
          },
          finish:async()=>{if(accepted&&current?.getSessionId()===expected.sessionId){accepted=false;await chat.endCall(expected.sessionId);clear();}},
        });
        return true;
      }catch{
        if(accepted&&current?.getSessionId()===call.getSessionId()){accepted=false;await chat.endCall(call.getSessionId()).catch(()=>{});clear();}
        if(!disposed)onError('Не вдалося прийняти дзвінок. Спробуйте ще раз.');return false;
      }finally{busy=false;}
    },
    async decline(){
      if(disposed||!current||!offered||busy||accepted)return false;
      busy=true;const call=current;
      try{await chat.rejectCall(call.getSessionId(),chat.CALL_STATUS.REJECTED);if(current===call)clear();return true;}
      catch{if(!disposed)onError('Не вдалося відхилити дзвінок.');return false;}
      finally{busy=false;}
    },
    dispose(){disposed=true;epoch++;chat.removeCallListener(id);onOffer(null);},
  };
}
