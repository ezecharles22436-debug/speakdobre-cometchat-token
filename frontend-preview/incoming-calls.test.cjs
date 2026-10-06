const test=require('node:test'),assert=require('node:assert/strict');
const call=(sid='one',caller='mod',receiver='student')=>({getSessionId:()=>sid,getCallInitiator:()=>({getUid:()=>caller,getName:()=> 'Модератор'}),getCallReceiver:()=>({getUid:()=>receiver}),getReceiverType:()=> 'user',getType:()=> 'video'});
async function fixture(getSession=async()=>({token:'synthetic',user:{uid:'student',role:'student'},staffContacts:['mod']})){
  const {createIncomingCalls}=await import('./incoming-calls.mjs');const offers=[],calls=[];let listener,active,authorized;
  const chat={CallListener:class{constructor(o){Object.assign(this,o);}},CALL_STATUS:{REJECTED:'rejected'},addCallListener:(id,l)=>listener=l,removeCallListener:()=>calls.push('remove'),acceptCall:async sid=>{calls.push('accept');active=call(sid);return active;},getActiveCall:()=>active,endCall:async()=>calls.push('end'),rejectCall:async()=>calls.push('reject')};
  const bridge=createIncomingCalls({chat,getSession,identity:{uid:'student',role:'student'},onOffer:o=>offers.push(o),onError:()=>{},onEnded:()=>{},onAccepted:async entry=>{authorized=entry;}});
  return{bridge,chat,calls,offers,get listener(){return listener;},get accepted(){return authorized;}};
}
test('real-shaped provider event plus server staff allowlist drives accepted grant',async()=>{
  const f=await fixture();await f.listener.onIncomingCallReceived(call());assert.equal(f.offers.at(-1).callerName,'Модератор');
  await f.bridge.accept();const grant=await f.accepted.authorize();assert.equal(grant.sessionId,'one');assert.equal(grant.peerIsStaff,true);await f.accepted.finish();assert.deepEqual(f.calls,['accept','end']);f.bridge.dispose();
});
test('peer and wrong receiver never display offer or accept',async()=>{
  for(const c of [call('one','peer'),call('one','mod','other')]){const f=await fixture();await f.listener.onIncomingCallReceived(c);assert.equal(await f.bridge.accept(),false);assert.equal(f.calls.length,0);f.bridge.dispose();}
});
test('revoked subscription between offer and accept prevents acceptance',async()=>{
  let reads=0;const f=await fixture(async()=>{if(++reads>1)throw Error('expired');return{token:'s',user:{uid:'student',role:'student'},staffContacts:['mod']};});
  await f.listener.onIncomingCallReceived(call());assert.equal(await f.bridge.accept(),false);assert.deepEqual(f.calls,[]);f.bridge.dispose();
});
test('unrelated cancellation cannot close current offer; matching one does',async()=>{
  const f=await fixture();await f.listener.onIncomingCallReceived(call());f.listener.onIncomingCallCancelled(call('other'));assert.notEqual(f.offers.at(-1),null);f.listener.onIncomingCallCancelled(call());assert.equal(f.offers.at(-1),null);assert.equal(await f.bridge.accept(),false);f.bridge.dispose();
});
test('active provider call mismatch prevents media authorization',async()=>{
  const f=await fixture();await f.listener.onIncomingCallReceived(call());await f.bridge.accept();f.chat.getActiveCall=()=>call('other');await assert.rejects(f.accepted.authorize());f.bridge.dispose();
});
test('cancellation while access is loading cannot resurrect an offer',async()=>{
  let resolve;const f=await fixture(()=>new Promise(r=>{resolve=r;}));const pending=f.listener.onIncomingCallReceived(call());
  assert.equal(await f.bridge.accept(),false);f.listener.onIncomingCallCancelled(call());resolve({token:'s',user:{uid:'student',role:'student'},staffContacts:['mod']});await pending;
  assert.equal(f.offers.at(-1),null);assert.equal(await f.bridge.accept(),false);assert.deepEqual(f.calls,[]);f.bridge.dispose();
});
test('cancellation during acceptance ends the late accepted call without mounting media',async()=>{
  const f=await fixture();let resolve;f.chat.acceptCall=()=>new Promise(r=>{resolve=r;});await f.listener.onIncomingCallReceived(call());const pending=f.bridge.accept();
  while(!resolve)await new Promise(r=>setImmediate(r));f.listener.onIncomingCallCancelled(call());resolve(call());await pending;
  assert.equal(f.accepted,undefined);assert.deepEqual(f.calls,['end']);f.bridge.dispose();
});
