import test from 'node:test';
import assert from 'node:assert/strict';
import {moderateGroupMember} from './member-moderation.mjs';
import {createStudentPicker} from './student-picker.mjs';
function setup(){
  const calls=[],identity={uid:'mem_staff',role:'moderator'};
  const actor={getUid:()=>identity.uid,getRole:()=>identity.role};
  const group={getGuid:()=> 'room',getScope:()=> 'moderator'};
  const target={getUid:()=> 'mem_student',getRole:()=> 'student'};
  const sdk={getLoggedInUser:async()=>actor,getGroup:async()=>group,getUser:async()=>target,
    kickGroupMember:async(...args)=>{calls.push(['kick',...args]);return true;},
    banGroupMember:async(...args)=>{calls.push(['ban',...args]);return true;}};
  return {sdk,identity,actor,group,target,calls,uid:'mem_student',roomGuid:'room',action:'kick',check:async()=>{}};
}
test('kick and ban use exact group and target and require confirmed success',async()=>{
  for(const action of ['kick','ban']){const x=setup();await moderateGroupMember({...x,action});assert.deepEqual(x.calls,[[action,'room','mem_student']]);}
  const x=setup();x.sdk.kickGroupMember=async()=>false;await assert.rejects(moderateGroupMember(x));
});
test('student actors, self-targets and unknown actions cannot mutate',async()=>{
  for(const override of [{identity:{uid:'mem_staff',role:'student'}},{uid:'mem_staff'},{action:'delete'},{uid:'bad id'}]){
    const x=setup();await assert.rejects(moderateGroupMember({...x,...override}));assert.deepEqual(x.calls,[]);
  }
});
test('SDK actor, group scope and target role are rechecked',async()=>{
  for(const change of [x=>x.actor.getUid=()=> 'mem_other',x=>x.actor.getRole=()=> 'student',x=>x.group.getScope=()=> 'participant',x=>x.group.getGuid=()=> 'other',x=>x.target.getRole=()=> 'moderator']){
    const x=setup();change(x);await assert.rejects(moderateGroupMember(x));assert.deepEqual(x.calls,[]);
  }
});
test('access revoked during SDK reads blocks mutation',async()=>{
  const x=setup();let checks=0;x.check=async()=>{if(++checks===2)throw Error('revoked');};await assert.rejects(moderateGroupMember(x));assert.deepEqual(x.calls,[]);
});
async function pickerFixture(overrides={}){
  const x=setup(),states=[];
  const session={token:'synthetic',user:x.identity,rooms:[{guid:'room',unlocked:true}]};
  const picker=createStudentPicker({identity:x.identity,roomGuid:'room',getSession:async()=>session,
    createRequest:()=>({fetchNext:async()=>[{getUid:()=>x.uid,getScope:()=> 'participant',getName:()=> 'Student'}]}),
    authorizeStudent:async()=>({actor:x.identity,target:{uid:x.uid},roomGuid:'room'}),onSelect:async()=>{},onState:s=>states.push(s),
    moderateMember:args=>moderateGroupMember({...x,...args}),...overrides});
  await picker.loadMore();return {...x,picker,states,session};
}
test('picker rejects unseen target and removes row only after success',async()=>{
  const x=await pickerFixture();assert.equal(await x.picker.moderate('mem_unseen','kick'),false);assert.equal(await x.picker.moderate(x.uid,'kick'),true);assert.equal(x.states.at(-1).rows.length,0);assert.match(x.states.at(-1).notice,/вилучено/);assert.equal(x.calls.length,1);
});
test('server denial leaves the member unchanged',async()=>{
  const x=await pickerFixture({authorizeStudent:async()=>{throw Error('denied');}});assert.equal(await x.picker.moderate(x.uid,'ban'),false);assert.equal(x.states.at(-1).rows.length,1);assert.deepEqual(x.calls,[]);
});
test('duplicate actions blocked while authorization is pending',async()=>{
  let resolve;const x=await pickerFixture({authorizeStudent:()=>new Promise(r=>{resolve=r;})});const first=x.picker.moderate(x.uid,'ban');
  while(!resolve)await new Promise(r=>setImmediate(r));assert.equal(await x.picker.moderate(x.uid,'kick'),false);
  resolve({actor:x.identity,target:{uid:x.uid},roomGuid:'room'});assert.equal(await first,true);assert.equal(x.calls.length,1);
});
test('leaving the view during authorization prevents the action',async()=>{
  let resolve;const x=await pickerFixture({authorizeStudent:()=>new Promise(r=>{resolve=r;})});const first=x.picker.moderate(x.uid,'ban');
  while(!resolve)await new Promise(r=>setImmediate(r));x.picker.dispose();resolve({actor:x.identity,target:{uid:x.uid},roomGuid:'room'});
  assert.equal(await first,false);assert.deepEqual(x.calls,[]);
});
test('false provider result never removes the row or claims success',async()=>{
  const x=await pickerFixture({moderateMember:async()=>false});assert.equal(await x.picker.moderate(x.uid,'kick'),false);assert.equal(x.states.at(-1).rows.length,1);assert.equal(x.states.at(-1).notice,'');
});
