const test = require('node:test');
const assert = require('node:assert/strict');
const { configuredRooms } = require('../api/cometchat-token')._test;
const { ROOMS } = require('../api/_chat-room-policy');

test('room release uses Ukrainian catalog and preserves disabled legacy configuration', () => {
  const keys = ['CHAT_ROOMS_ENABLED', 'CHAT_ROOMS_PERMISSIONS_VERIFIED', 'SPEAKDOBRE_CHAT_ROOMS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.CHAT_ROOMS_ENABLED = 'true';
    process.env.CHAT_ROOMS_PERMISSIONS_VERIFIED = 'true';
    process.env.SPEAKDOBRE_CHAT_ROOMS = JSON.stringify([{ guid: 'legacy', name: 'Legacy English label' }]);
    assert.deepEqual(configuredRooms().map(({ guid, name, description }) => ({ guid, name, description })),
      ROOMS.map(({ guid, name, description }) => ({ guid, name, description })));
    process.env.CHAT_ROOMS_ENABLED = 'false';
    assert.equal(configuredRooms()[0].name, 'Legacy English label');
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
