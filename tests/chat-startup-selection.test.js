const test = require('node:test');
const assert = require('node:assert/strict');
const { startupSelection } = require('../api/_chat-startup-selection');
const check = (ids, record) => startupSelection({ uid: 'mem_fixture', memberships: ids.map(guid => ({ guid })), store: { read: async uid => { assert.equal(uid, 'mem_fixture'); return record; } } });

test('suspension blocks startup despite valid joined groups', async () => {
  for (const accessState of ['suspended','revoking','restoring']) {
    await assert.rejects(check(['speakdobre-c2'], {state:'idle',accessState}), error => error.code === 'CHAT_SUSPENDED');
  }
});
test('startup accepts verified memberships, not saved preferences', async () => {
  assert.deepEqual(await check(['speakdobre-c2', 'speakdobre-travel'], null), { ready: true, pending: false });
  assert.deepEqual(await check([], { state: 'idle', selected: ['speakdobre-c2'] }), { ready: false, pending: false });
});
test('pending and reconciliation selections cannot bypass selector', async () => {
  for (const state of ['working', 'reconcile']) assert.deepEqual(await check(['speakdobre-c2'], { state }), { ready: false, pending: true });
});
test('invalid counts, unknown groups and multiple levels fail closed', async () => {
  for (const ids of [[], ['speakdobre-travel'], ['speakdobre-a1', 'speakdobre-c2'], ['unknown'], ['speakdobre-c2', 'speakdobre-travel', 'speakdobre-business', 'speakdobre-music-lovers']]) {
    assert.equal((await check(ids, null)).ready, false);
  }
});
test('store failure is not treated as an idle selection', async () => {
  await assert.rejects(startupSelection({ uid: 'mem_fixture', memberships: [], store: { read: async () => { throw Error('unavailable'); } } }), /unavailable/);
});
