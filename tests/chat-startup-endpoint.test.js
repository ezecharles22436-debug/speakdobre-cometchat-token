const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../api/_trial-booking-shared');
const handler = require('../api/cometchat-token');

test('consolidated student startup checks access once and memberships once; pending state is preserved', async () => {
  const env = { MEMBERSTACK_SECRET_KEY: 'synthetic', MEMBERSTACK_ALLOWED_PLAN_IDS: 'plan_fixture', COMETCHAT_APP_ID: 'fixture', COMETCHAT_REGION: 'eu', COMETCHAT_API_KEY: 'synthetic', ALLOWED_ORIGINS: 'https://speakdobre.webflow.io', CHAT_ROOMS_ENABLED: 'true', CHAT_ROOMS_PERMISSIONS_VERIFIED: 'true', CHAT_SUPER_MODERATOR_IDS: 'mem_owner', CHAT_MODERATOR_IDS: '', CHAT_ROOMS_DATA_NAMESPACE: 'preview_fixture' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const originalFetch = global.fetch, originalRead = shared.getDocument;
  let record = null, deny = false;
  const calls = [];
  shared.getDocument = async path => { assert.match(path, /preview_fixture_chatRoomSelections\/mem_student$/); return record; };
  global.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname; calls.push({ path, method: options.method });
    let data;
    if (path.endsWith('/members/verify-token')) data = { id: 'mem_student' };
    else if (path.endsWith('/members/mem_student')) data = { id: 'mem_student', planConnections: deny ? [] : [{ active: true, planId: 'plan_fixture' }] };
    else if (path.endsWith('/users/mem_student') && options.method === 'GET') data = { uid: 'mem_student', role: 'student' };
    else if (path.endsWith('/users/mem_owner')) data = { uid: 'mem_owner', role: 'super_moderator' };
    else if (path.endsWith('/friends')) data = [{ uid: 'mem_owner', role: 'super_moderator' }];
    else if (path.endsWith('/groups')) data = [{ guid: 'speakdobre-c2', hasJoined: true, scope: 'participant' }];
    else if (path.endsWith('/users') && options.method === 'PUT') data = {};
    else if (path.endsWith('/auth_tokens')) data = { authToken: 'synthetic' };
    else throw Error('Unexpected fixture request');
    return new Response(JSON.stringify({ data, meta: { pagination: { total_pages: 1 } } }), { status: 200 });
  };
  const run = async () => {
    const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: { origin: 'https://speakdobre.webflow.io', authorization: 'Bearer synthetic' } }, res);
    return res;
  };
  try {
    let res = await run(); assert.equal(res.statusCode, 200); assert.deepEqual(res.body.selection, { ready: true, pending: false });
    assert.equal(calls.filter(c => c.path.endsWith('/members/verify-token')).length, 1);
    assert.equal(calls.filter(c => c.path.endsWith('/groups')).length, 1);
    assert.equal(calls.filter(c => c.path.endsWith('/users/mem_student') && c.method === 'PUT').length, 0);
    record = { state: 'working' }; res = await run(); assert.deepEqual(res.body.selection, { ready: false, pending: true });
    calls.length = 0; deny = true; res = await run(); assert.equal(res.statusCode, 403);
    assert.equal(calls.some(c => c.path.includes('/v3/')), false);
  } finally {
    global.fetch = originalFetch; shared.getDocument = originalRead;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
