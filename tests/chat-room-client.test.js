const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, validSelection } = require('../public/chat-room-selector');
const { ROOMS } = require('../api/_chat-room-policy');
test('client selection supports C2 and enforces one level and maximum three groups', () => {
  assert.equal(validSelection(ROOMS, ['speakdobre-c2', 'speakdobre-travel']), true);
  for (const ids of [[], ['speakdobre-travel'], ['speakdobre-c2', 'speakdobre-a1'], ['unknown'], ['speakdobre-c2', 'speakdobre-travel', 'speakdobre-business', 'speakdobre-food-cooking']]) assert.equal(validSelection(ROOMS, ids), false);
});
test('client sends only rooms, refreshes bearer token and forbids redirected credentials', async () => {
  const calls = []; let tokenCount = 0;
  const client = createClient({ endpoint: 'https://preview.example.test/api/chat-rooms', getToken: async () => `synthetic-${++tokenCount}`,
    fetcher: async (url, options) => { calls.push(options); return { ok: true, json: async () => ({}) }; } });
  await client.load(); await client.save(['speakdobre-c2']);
  assert.equal(calls[0].headers.Authorization, 'Bearer synthetic-1');
  assert.equal(calls[1].headers.Authorization, 'Bearer synthetic-2');
  assert.equal(calls[1].redirect, 'error'); assert.equal(calls[1].credentials, 'omit');
  assert.deepEqual(JSON.parse(calls[1].body), { rooms: ['speakdobre-c2'] });
});
test('missing session makes no request; permission failures use Ukrainian text, not upstream payloads', async () => {
  let requests = 0;
  const options = { endpoint: 'https://preview.example.test/api/chat-rooms', fetcher: async () => { requests++; return { ok: false, status: 403, json: async () => ({ error: 'upstream private detail' }) }; } };
  await assert.rejects(createClient({ ...options, getToken: async () => null }).load(), { status: 401 });
  assert.equal(requests, 0);
  await assert.rejects(createClient({ ...options, getToken: async () => 'synthetic' }).load(), error => error.status === 403 && !error.message.includes('upstream'));
});
test('rejects unsafe endpoint URLs', () => {
  for (const endpoint of ['http://example.test', 'https://user:secret@example.test', 'https://example.test?token=secret']) assert.throws(() => createClient({ endpoint }));
});
