import test from 'node:test';
import assert from 'node:assert/strict';
import {canOfferStaffDelete, authorizeStaffDelete, addStaffDeleteOption} from './moderation-policy.mjs';

function setup(role='moderator') {
  const identity={uid:'staff',role},roomGuid='room';
  const group={getGuid:()=>roomGuid,getScope:()=>role==='super_moderator'?'admin':'moderator'};
  const message={getReceiverType:()=> 'group',getReceiverId:()=>roomGuid,getCategory:()=> 'message',
    getDeletedAt:()=>0,getSender:()=>({getUid:()=> 'student'})};
  const session={token:'test-only',user:identity,rooms:[{guid:roomGuid,unlocked:true}]};
  const sdk={getLoggedInUser:async()=>({getUid:()=>identity.uid,getRole:()=>role}),getGroup:async()=>group};
  return {identity,roomGuid,group,message,sdk,getSession:async()=>session,session};
}
test('owner and moderator may see group moderation deletion', async()=>{
  for(const role of ['moderator','super_moderator']) {
    const x=setup(role);assert.equal(canOfferStaffDelete(x),true);assert.equal(await authorizeStaffDelete(x),true);
  }
});
test('students and participant scope never gain staff deletion', async()=>{
  const x=setup('student');assert.equal(canOfferStaffDelete(x),false);await assert.rejects(authorizeStaffDelete(x));
  const y=setup();y.group.getScope=()=> 'participant';assert.equal(canOfferStaffDelete(y),false);await assert.rejects(authorizeStaffDelete(y));
});
test('no private, cross-group, deleted, system or own-message staff shortcut',()=>{
  for(const [method,value] of [['getReceiverType','user'],['getReceiverId','other'],['getCategory','action'],['getDeletedAt',1]]) {
    const x=setup();x.message[method]=()=>value;assert.equal(canOfferStaffDelete(x),false);
  }
  const x=setup();x.message.getSender=()=>({getUid:()=>x.identity.uid});assert.equal(canOfferStaffDelete(x),false);
});
test('stale server identity and room access fail closed',async()=>{
  for(const mutate of [x=>{x.session.user={uid:'different',role:'moderator'};},x=>{x.session.rooms=[];},x=>{x.session.token='';}]) {
    const x=setup();mutate(x);await assert.rejects(authorizeStaffDelete(x));
  }
});
test('SDK identity and role mismatch fail closed',async()=>{
  for(const actor of [{getUid:()=> 'other',getRole:()=> 'moderator'},{getUid:()=> 'staff',getRole:()=> 'student'}]) {
    const x=setup();x.sdk.getLoggedInUser=async()=>actor;await assert.rejects(authorizeStaffDelete(x));
  }
});
test('access is checked again after SDK group fetch',async()=>{
  const x=setup();x.sdk.getGroup=async()=>{x.session.rooms=[];return x.group;};await assert.rejects(authorizeStaffDelete(x));
});
test('does not duplicate existing deletion or override hidden option',()=>{
  const x=setup(),existing=[{id:'delete'}];assert.equal(addStaffDeleteOption(existing,x),existing);
  const empty=[];assert.equal(addStaffDeleteOption(empty,{...x,hidden:true}),empty);
  const options=addStaffDeleteOption(empty,{...x,onDelete:()=>{}});assert.equal(options.length,1);assert.equal(options[0].id,'delete');
});
