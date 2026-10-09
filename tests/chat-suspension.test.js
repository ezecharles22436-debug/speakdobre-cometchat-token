const test = require('node:test'), assert = require('node:assert/strict');
const { assertChatAccess, createSuspensionService, verifyIssuedChatAccess } = require('../api/_chat-suspension');
function fixture(fail = false) {
  let record = null; const events = [];
  const store = { read: async () => record, writeAccess: async (_, previous, fields) => {
    assert.equal(previous, record); record = { state: 'idle', ...record, ...fields, _updateTime: String(events.length) }; events.push(fields.accessState); return record;
  } };
  const chat = { flushTokens: async () => { events.push('flush'); assert.throws(() => assertChatAccess(record)); if (fail) throw Error('provider failure'); }, deactivate: async () => events.push('deactivate'), user: async () => ({ deactivatedAt: 123 }) };
  const run = createSuspensionService({ store, chat });
  return { run: action => run({ actor: { uid: 'mem_owner', role: 'super_moderator' }, uid: 'mem_student', action }), events, record: () => record };
}
test('restriction is durable before tokens revoked and stays blocked until explicit restore', async () => {
  const f = fixture(); await f.run('suspend'); assert.deepEqual(f.events, ['revoking','flush','deactivate','suspended']);
  assert.throws(() => assertChatAccess(f.record()), { code: 'CHAT_SUSPENDED' });
  await f.run('restore'); assert.doesNotThrow(() => assertChatAccess(f.record()));
  assert.deepEqual(f.events.slice(-2), ['restoring','active']); // no plan changes or automatic provider activation
});
test('provider failure leaves durable restriction and reports failure', async () => {
  const f = fixture(true); await assert.rejects(f.run('suspend')); assert.equal(f.record().accessState, 'suspended'); assert.equal(f.record().accessSyncError, true);
  assert.ok(f.events.includes('deactivate'));
});

test('late token verification revokes on suspension or unavailable durable state', async () => {
  for (const read of [async()=>({accessState:'suspended'}),async()=>{throw Error('store unavailable');}]) {
    const events=[];
    const chat={flushTokens:async()=>events.push('flush'),deactivate:async()=>events.push('deactivate'),user:async()=>({deactivatedAt:1})};
    await assert.rejects(verifyIssuedChatAccess({store:{read},chat,uid:'mem_student'}));
    assert.deepEqual(events,['flush','deactivate']);
  }
});

test('explicit malformed access states cannot bypass restriction',()=>{
  for(const accessState of ['',null,false,0])assert.throws(()=>assertChatAccess({accessState}));
});
test('unknown, pending and suspended states fail closed', () => {
  for (const accessState of ['suspended','revoking','restoring','unknown']) assert.throws(() => assertChatAccess({ accessState }));
  assert.doesNotThrow(() => assertChatAccess(null)); assert.doesNotThrow(() => assertChatAccess({state:'idle'}));
});
test('moderators, students, self-target and unknown actions cannot mutate access', async () => {
  const run = createSuspensionService({ store: { read: () => { throw Error('must not read'); } }, chat: {} });
  for (const role of ['student','moderator']) await assert.rejects(run({actor:{uid:'mem_owner',role},uid:'mem_student',action:'suspend'}), {status:403});
  await assert.rejects(run({actor:{uid:'mem_owner',role:'super_moderator'},uid:'mem_owner',action:'suspend'}), {status:403});
});
test('selection or access operation in progress blocks competing owner operation', async () => {
  for (const record of [{state:'working'}, {accessState:'revoking'}, {accessState:'restoring'}]) {
    const run = createSuspensionService({store:{read:async()=>record},chat:{}});
    await assert.rejects(run({actor:{uid:'mem_owner',role:'super_moderator'},uid:'mem_student',action:'suspend'}),{status:409});
  }
});
