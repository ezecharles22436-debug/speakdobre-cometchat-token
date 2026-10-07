const test = require('node:test');
const assert = require('node:assert/strict');
const { getVisibleRoomsForUser } = require('../api/cometchat-token')._test;

async function enabled(run) {
  const keys = ['CHAT_ROOMS_ENABLED', 'CHAT_ROOMS_PERMISSIONS_VERIFIED'];
  const before = keys.map(key => process.env[key]);
  keys.forEach(key => { process.env[key] = 'true'; });
  try { await run(); }
  finally { keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }); }
}

test('missing or banned level group stays locked without blocking other groups or selector', () => enabled(async () => {
  const calls = [];
  const rooms = await getVisibleRoomsForUser('mem_test', { memberships: async uid => {
    calls.push(uid);
    return [{ guid: 'speakdobre-travel', scope: 'participant' }, { guid: 'speakdobre-business', scope: 'participant' }];
  } });
  assert.deepEqual(calls, ['mem_test']);
  assert.equal(rooms.length, 16);
  assert.equal(rooms.find(room => room.guid === 'speakdobre-c2').unlocked, false);
  assert.deepEqual(rooms.filter(room => room.unlocked).map(room => room.guid).sort(), ['speakdobre-business', 'speakdobre-travel']);
}));

test('zero memberships returns locked catalog for selection, not automatic rejoin', () => enabled(async () => {
  const rooms = await getVisibleRoomsForUser('mem_test', { memberships: async () => [] });
  assert.equal(rooms.length, 16);
  assert.ok(rooms.every(room => room.unlocked === false));
}));

test('membership permission failure is not converted into an empty successful session', () => enabled(async () => {
  await assert.rejects(getVisibleRoomsForUser('mem_test', { memberships: async () => { throw Error('provider denied'); } }), /provider denied/);
}));

test('only joined catalog rooms unlock; unrelated membership never creates navigation', () => enabled(async () => {
  const rooms = await getVisibleRoomsForUser('mem_test', { memberships: async () => [
    { guid: 'speakdobre-c2', scope: 'participant' }, { guid: 'unrelated', scope: 'participant' }
  ] });
  assert.deepEqual(rooms.filter(room => room.unlocked).map(room => room.guid), ['speakdobre-c2']);
  assert.ok(!rooms.some(room => room.guid === 'unrelated'));
}));
