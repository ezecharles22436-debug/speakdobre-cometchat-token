const test=require('node:test');const assert=require('node:assert/strict');
const grant=()=>({appId:'168437005e7f6fa2a',allowed:true,uid:'synthetic',sessionId:'synthetic-call',type:'VIDEO',role:'student',direction:'incoming',peerIsStaff:true,authToken:'synthetic-only'});
async function fixture({authorize=async()=>grant(),overrides={}}={}) {
  const {createCallSession}=await import('./call-session.mjs');const states=[],calls=[],events=new Map();let mounted=0,removed=0;
  const sdk={addEventListener:(e,fn)=>{events.set(e,fn);return()=>events.delete(e);},getLoggedInUser:()=>({getUid:()=> 'synthetic'}),generateToken:async()=>{calls.push('token');return{token:'fake-call-token'};},joinSession:async(token,settings)=>{calls.push(settings);return{data:undefined,error:null};},leaveSession:()=>calls.push('leave'),...overrides};
  const session=createCallSession({sdk,authorize,mountControls:()=>{mounted++;return()=>{removed++;};},onState:s=>states.push(s)});
  return{session,states,calls,events,get mounted(){return mounted;},get removed(){return removed;}};
}
test('authorized incoming staff call joins muted without recording and mounts controls',async()=>{
  const f=await fixture();await f.session.start({});assert.equal(f.mounted,1);assert.equal(f.states.at(-1),'active');
  assert.equal(f.calls[1].startAudioMuted,true);assert.equal(f.calls[1].startVideoPaused,true);assert.equal(f.calls[1].autoStartRecording,false);assert.equal(f.calls[1].hideControlPanel,true);f.session.dispose();
});
test('production, denied access, student outgoing and peer calls never generate tokens',async()=>{
  for(const change of [{appId:'production'},{allowed:false},{direction:'outgoing'},{peerIsStaff:false}]){
    const f=await fixture({authorize:async()=>({...grant(),...change})});await assert.rejects(f.session.start({}));assert.deepEqual(f.calls,[]);f.session.dispose();
  }
});
test('identity mismatch fails before token generation',async()=>{
  const f=await fixture({overrides:{getLoggedInUser:()=>({getUid:()=> 'other'})}});await assert.rejects(f.session.start({}));assert.deepEqual(f.calls,[]);f.session.dispose();
});
test('revocation during token generation blocks join',async()=>{
  let reads=0;const f=await fixture({authorize:async()=>({...grant(),allowed:++reads===1})});await assert.rejects(f.session.start({}));assert.deepEqual(f.calls,['token']);f.session.dispose();
});
test('SDK result errors are failures even if promise resolves',async()=>{
  const f=await fixture({overrides:{joinSession:async()=>({data:null,error:Error('failed')})}});await assert.rejects(f.session.start({}));assert.equal(f.mounted,0);assert.equal(f.states.at(-1),'failed');f.session.dispose();
});
test('end event unmounts controls; disposal removes listeners',async()=>{
  const f=await fixture();await f.session.start({});f.events.get('onSessionLeft')();assert.equal(f.removed,1);assert.equal(f.states.at(-1),'ended');f.session.dispose();assert.equal(f.events.size,0);
});
test('dispose during authorization cannot later join',async()=>{
  let resolve;const f=await fixture({authorize:()=>new Promise(r=>{resolve=r;})});const promise=f.session.start({});f.session.dispose();resolve(grant());await assert.rejects(promise);assert.deepEqual(f.calls,[]);
});
