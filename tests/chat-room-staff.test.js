const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareRoomAccess, trustedStaffConfig } = require('../api/_chat-room-staff');
const { ROOMS } = require('../api/_chat-room-policy');
const env = { CHAT_SUPER_MODERATOR_IDS:'mem_owner', CHAT_MODERATOR_IDS:'mem_mod' };
function fixture(role='student') {
  let friends=[], memberships=[], writes=[];
  const chat={
    user:async uid=>({uid,role:uid==='mem_owner'?'super_moderator':uid==='mem_mod'?'moderator':role}),
    friends:async()=>friends,
    addFriends:async(uid,ids)=>{writes.push(['friends',uid,ids]); friends.push(...await Promise.all(ids.map(chat.user)));},
    memberships:async()=>memberships,
    isBanned:async()=>false,
    addStaff:async(guid,uid,scope)=>{writes.push([guid,uid,scope]); memberships.push({guid,scope});}
  };
  return {chat,writes,friends,memberships};
}
test('student receives only verified staff contacts, repeat is idempotent',async()=>{
  const f=fixture();
  await prepareRoomAccess({uid:'mem_student',role:'student',env,chat:f.chat});
  assert.deepEqual(f.friends.map(u=>u.uid),['mem_owner','mem_mod']);
  await prepareRoomAccess({uid:'mem_student',role:'student',env,chat:f.chat});
  assert.equal(f.writes.length,1);
  assert.equal(f.memberships.length,0);
});
test('unexpected peer friendship stops setup without changing it',async()=>{
  const f=fixture(); f.friends.push({uid:'mem_peer',role:'student'});
  await assert.rejects(prepareRoomAccess({uid:'mem_student',role:'student',env,chat:f.chat}),/Unexpected/);
  assert.equal(f.writes.length,0);
});
test('demoted staff contact is rejected before any write',async()=>{
  const f=fixture(); f.chat.user=async uid=>({uid,role:'student'});
  await assert.rejects(prepareRoomAccess({uid:'mem_student',role:'student',env,chat:f.chat}),/Staff role/);
  assert.equal(f.writes.length,0);
});
test('students cannot claim staff role',async()=>{
  const f=fixture();
  await assert.rejects(prepareRoomAccess({uid:'mem_student',role:'super_moderator',env,chat:f.chat}),/Untrusted/);
  assert.equal(f.writes.length,0);
});
test('staff gets all catalog rooms with appropriate scope and no unrelated mutations',async()=>{
  for(const [uid,role,scope] of [['mem_owner','super_moderator','admin'],['mem_mod','moderator','moderator']]) {
    const f=fixture(); f.memberships.push({guid:'unrelated',scope:'participant'});
    await prepareRoomAccess({uid,role,env,chat:f.chat});
    assert.equal(f.writes.length,ROOMS.length);
    assert.ok(f.writes.every(w=>w[2]===scope));
    await prepareRoomAccess({uid,role,env,chat:f.chat});
    assert.equal(f.writes.length,ROOMS.length);
    assert.equal(f.memberships[0].scope,'participant');
  }
});
test('staff ban or mismatched existing scope requires review, never bypassed',async()=>{
  for(const type of ['ban','scope']){
    const f=fixture();
    if(type==='ban')f.chat.isBanned=async guid=>guid===ROOMS.at(-1).guid;
    else f.memberships.push({guid:ROOMS.at(-1).guid,scope:'admin'});
    await assert.rejects(prepareRoomAccess({uid:'mem_mod',role:'moderator',env,chat:f.chat}),/requires review/);
    assert.equal(f.writes.length,0);
  }
});
test('incomplete provider writes cannot report successful setup',async()=>{
  const f=fixture(); f.chat.addFriends=async()=>{};
  await assert.rejects(prepareRoomAccess({uid:'mem_student',role:'student',env,chat:f.chat}),/verification failed/);
});
test('missing or invalid trusted config fails closed',()=>{
  for(const bad of [{},{CHAT_SUPER_MODERATOR_IDS:'anything'},{CHAT_MODERATOR_IDS:'mem_ok,invalid'}])assert.throws(()=>trustedStaffConfig(bad));
});

test('returning staff checks bans concurrently with a four-request limit and one membership read',async()=>{
  const f=fixture(); let active=0, peak=0, checks=0, reads=0;
  f.memberships.push(...ROOMS.map(room=>({guid:room.guid,scope:'moderator'})));
  f.chat.memberships=async()=>{ reads++; return f.memberships; };
  f.chat.isBanned=async()=>{
    active++; peak=Math.max(peak,active); checks++;
    await new Promise(resolve=>setImmediate(resolve)); active--; return false;
  };
  const result=await prepareRoomAccess({uid:'mem_mod',role:'moderator',env,chat:f.chat});
  assert.equal(checks,ROOMS.length); assert.equal(peak,4); assert.equal(reads,1);
  assert.equal(f.writes.length,0); assert.deepEqual(result.memberships,f.memberships);
});

test('provider failure during parallel ban checks prevents any staff additions',async()=>{
  const f=fixture(); f.chat.isBanned=async()=>{ throw Error('provider unavailable'); };
  await assert.rejects(prepareRoomAccess({uid:'mem_mod',role:'moderator',env,chat:f.chat}),/provider unavailable/);
  assert.equal(f.writes.length,0);
});

test('returning students verify contacts with one list read and no writes',async()=>{
  const f=fixture(); let reads=0;
  f.friends.push({uid:'mem_owner',role:'super_moderator'},{uid:'mem_mod',role:'moderator'});
  f.chat.friends=async()=>{reads++;return f.friends;};
  await prepareRoomAccess({uid:'mem_student',role:'student',env,chat:f.chat});
  assert.equal(reads,1);assert.equal(f.writes.length,0);
});
