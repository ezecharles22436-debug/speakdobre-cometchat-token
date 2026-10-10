const test = require('node:test');
const assert = require('node:assert/strict');
const { selectionWindow, INTERVAL_MS } = require('../api/_chat-room-cooldown');
const { createRoomSelectionService } = require('../api/_chat-room-selection');
test('first choice allowed; exact 30-day boundary unlocks', () => {
  const start = Date.parse('2026-10-10T10:00:00Z');
  assert.equal(selectionWindow(null, start).canChange, true);
  const record = { selectionChangedAt: new Date(start).toISOString() };
  assert.equal(selectionWindow(record, start + INTERVAL_MS - 1).canChange, false);
  assert.equal(selectionWindow(record, start + INTERVAL_MS).canChange, true);
  assert.equal(selectionWindow({ selected: ['speakdobre-c2'], startedAt: record.selectionChangedAt }, start).canChange, false);
  assert.equal(selectionWindow({ startedAt: record.selectionChangedAt }, start).canChange, true);
});
test('server blocks early change without mutations but permits same-selection retry', async () => {
  const events = [];
  const select = createRoomSelectionService({
    now: () => Date.parse('2026-10-11T10:00:00Z'),
    access: async () => ({ active: true, role: 'student' }),
    locks: { acquire: async () => ({ previous: { selectionChangedAt: '2026-10-10T10:00:00Z' } }),
      release: async () => events.push('release'), complete: async () => events.push('complete') },
    chat: { memberships: async () => [{ guid: 'speakdobre-c2', scope: 'participant' }],
      isBanned: async () => false, remove: async () => events.push('remove'), addParticipant: async () => events.push('add') }
  });
  await assert.rejects(select('mem_student', ['speakdobre-a1']), { code: 'GROUP_CHANGE_COOLDOWN', nextChangeAt: '2026-11-09T10:00:00.000Z' });
  assert.deepEqual(await select('mem_student', ['speakdobre-c2']), { rooms: ['speakdobre-c2'] });
  assert.deepEqual(events, ['release', 'release']);
});
