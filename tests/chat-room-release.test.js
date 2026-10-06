const test = require('node:test');
const assert = require('node:assert/strict');
const { roomReleaseReady, ACCEPTED_LOOKUP_RISK } = require('../api/_chat-room-release');
const { roomRoleForMember } = require('../api/cometchat-token')._test;
test('risk acceptance alone cannot enable rollout or waive baseline checks', () => {
  for (const env of [{}, {CHAT_ROOMS_ACCEPTED_RISK:ACCEPTED_LOOKUP_RISK},
    {CHAT_ROOMS_ENABLED:'true',CHAT_ROOMS_ACCEPTED_RISK:ACCEPTED_LOOKUP_RISK},
    {CHAT_ROOMS_ENABLED:'true',CHAT_ROOMS_BASELINE_VERIFIED:'true',CHAT_ROOMS_ACCEPTED_RISK:'true'}]) {
    assert.equal(roomReleaseReady(env), false);
  }
});
test('specific accepted risk supports rollout without claiming full privacy verification', () => {
  const env={CHAT_ROOMS_ENABLED:'true',CHAT_ROOMS_BASELINE_VERIFIED:'true',
    CHAT_ROOMS_PERMISSIONS_VERIFIED:'false',CHAT_ROOMS_ACCEPTED_RISK:ACCEPTED_LOOKUP_RISK};
  assert.equal(roomReleaseReady(env),true);
  assert.equal(roomRoleForMember('mem_student',env),'student');
  assert.equal(roomRoleForMember('mem_owner',{...env,CHAT_SUPER_MODERATOR_IDS:'mem_owner'}),'super_moderator');
});
test('existing fully verified release remains supported',()=>{
  assert.equal(roomReleaseReady({CHAT_ROOMS_ENABLED:'true',CHAT_ROOMS_PERMISSIONS_VERIFIED:'true'}),true);
});

