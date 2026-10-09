const test = require('node:test');
const assert = require('node:assert/strict');
const { roomRoleForMember, ensureCometChatUser } = require('../api/cometchat-token')._test;

test('role rollout is inert when disabled and fails closed before permissions verified', () => {
  assert.equal(roomRoleForMember('mem_owner', {}), null);
  assert.throws(() => roomRoleForMember('mem_owner', { CHAT_ROOMS_ENABLED: 'true' }), { status: 503 });
});
test('only exact server-owned IDs assign staff roles', () => {
  const env = { CHAT_ROOMS_ENABLED: 'true', CHAT_ROOMS_PERMISSIONS_VERIFIED: 'true',
    CHAT_SUPER_MODERATOR_IDS: 'mem_owner', CHAT_MODERATOR_IDS: 'mem_mod' };
  assert.equal(roomRoleForMember('mem_owner', env), 'super_moderator');
  assert.equal(roomRoleForMember('mem_mod', env), 'moderator');
  assert.equal(roomRoleForMember('mem_owner_fake', env), 'student');
  assert.throws(() => roomRoleForMember('ezecharles22436@gmail.com', env));
});
test('existing elevated provider role is reset before a student can receive a token', async () => {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push(options);
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: {
      uid: 'mem_student', role: options.method === 'GET' ? 'super_moderator' : 'student'
    } }) };
  };
  try {
    await ensureCometChatUser('mem_student', 'Synthetic', 'student');
    assert.equal(calls[1].method, 'PUT');
    assert.deepEqual(JSON.parse(calls[1].body), { role: 'student' });
  } finally { global.fetch = original; }
});
test('verified matching provider role needs no redundant write', async () => {
  const original = global.fetch; const calls = [];
  global.fetch = async (url, options) => { calls.push(options.method); return { ok: true, status: 200, text: async () => JSON.stringify({ data: { role: 'student' } }) }; };
  try { await ensureCometChatUser('mem_student', 'Synthetic', 'student'); assert.deepEqual(calls, ['GET']); }
  finally { global.fetch = original; }
});
test('provider role mismatch fails closed', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200,
    text: async () => JSON.stringify({ data: { role: 'default' } }) });
  try { await assert.rejects(ensureCometChatUser('mem_student', 'Synthetic', 'student'), { status: 503 }); }
  finally { global.fetch = original; }
});
test('provider permission errors cannot be mistaken for an absent user', async () => {
  const original = global.fetch;
  let count = 0;
  global.fetch = async () => { count++; return { ok: false, status: 403, text: async () => '{}' }; };
  try {
    await assert.rejects(ensureCometChatUser('mem_student', 'Synthetic', 'student'), { status: 502 });
    assert.equal(count, 1);
  } finally { global.fetch = original; }
});
