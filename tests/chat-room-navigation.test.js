const test=require('node:test');
const assert=require('node:assert/strict');
const {createNavigator}=require('../public/chat-room-navigation');
const session={user:{uid:'mem_student',role:'student'},rooms:[{guid:'level',unlocked:true},{guid:'other',unlocked:false}],staffContacts:['mem_mod']};
function setup(getSession=async()=>session){
  const calls=[];
  const open=createNavigator({session,getSession,app:{chatWithGroup:async id=>calls.push(['group',id]),chatWithUser:async id=>calls.push(['user',id])}});
  return {open,calls};
}
test('room rail opens verified joined groups and staff contacts',async()=>{
  const f=setup();await f.open('group','level');await f.open('user','mem_mod');
  assert.deepEqual(f.calls,[['group','level'],['user','mem_mod']]);
});
test('rail rejects peer users and unjoined rooms without calling embed',async()=>{
  const f=setup();await assert.rejects(f.open('user','mem_peer'));await assert.rejects(f.open('group','other'));assert.deepEqual(f.calls,[]);
});
test('fresh membership and identity are required before opening',async()=>{
  for(const fresh of [{...session,rooms:[]},{...session,user:{uid:'mem_other',role:'student'}},{...session,user:{uid:'mem_student',role:'moderator'}}]){
    const f=setup(async()=>fresh);await assert.rejects(f.open('group','level'));assert.deepEqual(f.calls,[]);
  }
});
test('expired access or network failure never opens embed',async()=>{
  const f=setup(async()=>{throw Error('expired');});await assert.rejects(f.open('group','level'));assert.deepEqual(f.calls,[]);
});
