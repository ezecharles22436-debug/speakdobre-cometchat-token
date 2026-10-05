const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomSelectionService } = require('../api/_chat-room-selection');
function fixture(overrides = {}) {
  let rooms = ['speakdobre-a1', 'speakdobre-travel', 'legacy-room'].map(guid => ({ guid, scope: 'participant' }));
  let held = false;
  const events = [];
  const deps = {
    access: async () => ({ active: true, role: 'student' }),
    locks: {
      acquire: async () => { if (held) return null; held = true; return 'operation'; },
      complete: async () => { events.push('complete'); held = false; },
      release: async () => { events.push('release'); held = false; },
      flagForReconciliation: async () => { events.push('reconcile'); }
    },
    chat: {
      memberships: async () => rooms.map(room => ({ ...room })),
      isBanned: async () => false,
      remove: async guid => { events.push('remove:' + guid); rooms = rooms.filter(room => room.guid !== guid); },
      addParticipant: async guid => { events.push('add:' + guid); rooms.push({ guid, scope: 'participant' }); assert.ok(rooms.length <= 3); }
    }
  };
  overrides.setup?.(deps);
  return { select: createRoomSelectionService(deps), events, deps };
}
test('removes legacy and old level membership before adding C2', async () => {
  const f = fixture();
  await f.select('mem_student', ['speakdobre-c2', 'speakdobre-travel']);
  assert.deepEqual(f.events, ['remove:speakdobre-a1', 'remove:legacy-room', 'add:speakdobre-c2', 'complete']);
});
test('bans reject selection before mutation', async () => {
  const f = fixture({ setup: d => { d.chat.isBanned = async () => true; } });
  await assert.rejects(f.select('mem_student', ['speakdobre-c2']), { code: 'ROOM_RESTRICTED' });
  assert.deepEqual(f.events, ['release']);
});
test('expired access and staff roles cannot use student membership changes', async () => {
  for (const state of [{ active: false, role: 'student' }, { active: true, role: 'moderator' }]) {
    const f = fixture({ setup: d => { d.access = async () => state; } });
    await assert.rejects(f.select('mem_student', ['speakdobre-c2']), { code: 'ACCESS_DENIED' });
    assert.deepEqual(f.events, []);
  }
});
test('uncertain mutation retains lock and blocks retry', async () => {
  const f = fixture({ setup: d => { d.chat.addParticipant = async () => { throw new Error('timeout'); }; } });
  await assert.rejects(f.select('mem_student', ['speakdobre-c2']));
  assert.equal(f.events.at(-1), 'reconcile');
  await assert.rejects(f.select('mem_student', ['speakdobre-c2']), { code: 'CHANGE_IN_PROGRESS' });
});
test('unconfirmed removals never proceed to additions', async () => {
  const f = fixture({ setup: d => { d.chat.remove = async () => {}; } });
  await assert.rejects(f.select('mem_student', ['speakdobre-c2']));
  assert.deepEqual(f.events, ['reconcile']);
});
test('overlapping requests cannot both mutate memberships', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.select('mem_student', ['speakdobre-c2']), f.select('mem_student', ['speakdobre-b1'])
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CHANGE_IN_PROGRESS');
});
