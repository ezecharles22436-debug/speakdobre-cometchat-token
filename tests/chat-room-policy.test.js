const test = require('node:test');
const assert = require('node:assert/strict');
const { ROOMS, validateSelection, roleForMember, membershipDelta } = require('../api/_chat-room-policy');
const level = 'speakdobre-a1';
const topic = 'speakdobre-travel';

test('one level and zero to two topics are accepted', () => {
  for (const choice of [[level], [level, topic], [level, topic, 'speakdobre-music-lovers']]) {
    assert.deepEqual(validateSelection(choice), [...choice].sort());
  }
});
test('empty choices, four memberships and two level rooms are rejected', () => {
  for (const choice of [[], [level, topic, 'speakdobre-music-lovers', 'speakdobre-business'], [level, 'speakdobre-c1'], [topic]]) {
    assert.throws(() => validateSelection(choice));
  }
});
test('C2 is a selectable level and cannot be combined with another level', () => {
  assert.deepEqual(validateSelection(['speakdobre-c2', topic]), ['speakdobre-c2', topic].sort());
  assert.deepEqual(validateSelection(['speakdobre-c2']), ['speakdobre-c2']);
  assert.throws(() => validateSelection(['speakdobre-c2', level]));
});

test('duplicates, arbitrary room IDs and malformed values are rejected', () => {
  for (const choice of [[level, level], [level, 'cometchat-guid-1'], [level, {}], null, 'speakdobre-a1']) {
    assert.throws(() => validateSelection(choice));
  }
});
test('elevated roles depend on trusted IDs, with owner taking precedence', () => {
  const config = { superModeratorIds: ['mem_owner'], moderatorIds: ['mem_staff', 'mem_owner'] };
  assert.equal(roleForMember('mem_owner', config), 'super_moderator');
  assert.equal(roleForMember('mem_staff', config), 'moderator');
  assert.equal(roleForMember('mem_student', config), 'student');
  assert.equal(roleForMember('mem_owner'), 'student');
  assert.throws(() => roleForMember('../owner', config));
});
test('switching membership identifies old groups for removal and never grants elevated scope', () => {
  const delta = membershipDelta([level, topic, 'speakdobre-music-lovers'], ['speakdobre-c1', topic]);
  assert.deepEqual(delta.remove, [level, 'speakdobre-music-lovers']);
  assert.deepEqual(delta.add, ['speakdobre-c1']);
  assert.equal(delta.scope, 'participant');
  assert.deepEqual(membershipDelta([level, topic], [topic, level]).add, []);
  assert.equal(ROOMS.filter(room => room.kind === 'level').length, 4);
});
