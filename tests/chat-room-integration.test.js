const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoomStore } = require('../api/_chat-room-store');
const { createRoomProvider } = require('../api/_chat-room-provider');
const { createHandler } = require('../api/chat-rooms');
const env = { COMETCHAT_APP_ID: 'testapp', COMETCHAT_REGION: 'eu', COMETCHAT_API_KEY: 'synthetic' };
test('durable lock uses create conflict and version preconditions', async () => {
  let record = null, version = 0;
  const db = {
    getDocument: async () => record ? { ...record } : null,
    createDocument: async (collection, id, fields) => {
      if (record) throw Object.assign(new Error('conflict'), { status: 409 });
      record = { ...fields, _updateTime: String(++version) }; return record;
    },
    patchDocument: async (path, fields, options) => {
      if (options.updateTime !== record._updateTime) throw Object.assign(new Error('conflict'), { status: 409 });
      record = { ...record, ...fields, _updateTime: String(++version) }; return record;
    }
  };
  const store = createRoomStore(db, 'preview_rooms');
  const locks = await Promise.all([store.acquire('mem_test', ['speakdobre-c2']), store.acquire('mem_test', ['speakdobre-a1'])]);
  assert.equal(locks.filter(Boolean).length, 1);
  const lock = locks.find(Boolean);
  await store.complete(lock, ['speakdobre-c2']);
  const next = await store.acquire('mem_test', ['speakdobre-b1']);
  assert.ok(next);
  await assert.rejects(store.release(lock));
  await store.flagForReconciliation(next, 'MEMBERSHIP_CHANGE_UNCERTAIN');
  assert.equal(await store.acquire('mem_test', ['speakdobre-a1']), null);
});
test('missing namespace cannot write to default production collections', () => {
  assert.throws(() => createRoomStore({}, ''));
  assert.throws(() => createRoomStore({}, '../bad'));
});
test('provider checks nested participant failures even with HTTP 200', async () => {
  const provider = createRoomProvider(async () => ({ ok: true, json: async () => ({ data: { participants: { mem_test: { success: false } } } }) }), env);
  await assert.rejects(provider.addParticipant('speakdobre-c2', 'mem_test'));
});
test('provider reads all membership pages under verified user identity', async () => {
  const requests = [];
  const provider = createRoomProvider(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ data: [{ guid: requests.length === 1 ? 'speakdobre-c2' : 'legacy', scope: 'participant', hasJoined: true }], meta: { pagination: { total_pages: 2 } } }) };
  }, env);
  assert.equal((await provider.memberships('mem_test')).length, 2);
  assert.equal(requests[1].options.headers.onBehalfOf, 'mem_test');
  assert.match(requests[1].url, /page=2/);
});
test('provider does not interpret permission failure as missing membership', async () => {
  const provider = createRoomProvider(async () => ({ ok: false, status: 403 }), env);
  await assert.rejects(provider.memberships('mem_test'));
});
function response() {
  return { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
}
const enabled = { CHAT_ROOMS_ENABLED: 'true', CHAT_ROOMS_PERMISSIONS_VERIFIED: 'true' };
test('endpoint defaults off and requires explicit permission readiness', async () => {
  for (const settings of [{}, { CHAT_ROOMS_ENABLED: 'true' }]) {
    const res = response();
    await createHandler({ env: settings })({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 503);
  }
});
test('endpoint rejects untrusted origin and unauthenticated requests', async () => {
  for (const [origin, expected] of [['https://untrusted.invalid', 403], ['https://www.speakdobre.com', 401]]) {
    const res = response();
    await createHandler({ env: enabled })({ method: 'GET', headers: { origin } }, res);
    assert.equal(res.code, expected);
  }
});
test('endpoint never accepts caller supplied identity or role', async () => {
  const original = process.env.MEMBERSTACK_ALLOWED_PLAN_IDS;
  process.env.MEMBERSTACK_ALLOWED_PLAN_IDS = 'plan_test';
  try {
    const member = { id: 'mem_test', planConnections: [{ planId: 'plan_test', active: true }] };
    const res = response();
    await createHandler({ env: enabled, verifyMember: async () => ({ memberId: member.id, member }), store: {}, chat: {} })({
      method: 'POST', headers: { origin: 'https://www.speakdobre.com', 'content-type': 'application/json' },
      body: { rooms: ['speakdobre-c2'], memberId: 'mem_owner', role: 'super_moderator' }
    }, res);
    assert.equal(res.code, 400);
  } finally { if (original === undefined) delete process.env.MEMBERSTACK_ALLOWED_PLAN_IDS; else process.env.MEMBERSTACK_ALLOWED_PLAN_IDS = original; }
});
