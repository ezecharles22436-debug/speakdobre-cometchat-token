const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionAdapter } = require('./session-adapter.cjs');
const session = () => ({ token: 'synthetic-only', user: { uid: 'test_student', role: 'student' }, rooms: [{ guid: 'c2', unlocked: true }], staffContacts: ['test_staff'] });
function fixture(getSession = async () => session(), overrides = {}, authorizeStudent) {
  const rendered = [], events = [];
  const sdk = {
    getLoggedInUser: async () => null,
    loginWithAuthToken: async token => { assert.equal(token, 'synthetic-only'); events.push('login'); return { getUid: () => 'test_student' }; },
    logout: async () => { events.push('logout'); }, ...overrides,
  };
  const adapter = createSessionAdapter({ getSession, sdk, render: async view => rendered.push(view), clear: () => events.push('clear'), authorizeStudent });
  return { adapter, rendered, events };
}
test('verified group and staff routes render without tokens; students cannot initiate calls', async () => {
  const f = fixture(); await f.adapter.open('group', 'c2'); await f.adapter.open('user', 'test_staff');
  assert.deepEqual(f.rendered, [{ type: 'group', id: 'c2', role: 'student', canStartCalls: false }, { type: 'user', id: 'test_staff', role: 'student', canStartCalls: false }]);
});
test('peer users, unjoined groups and unknown routes never log in or render', async () => {
  for (const [type, id] of [['user', 'peer'], ['group', 'a1'], ['anything', 'c2']]) {
    const f = fixture(); await assert.rejects(f.adapter.open(type, id));
    assert.equal(f.rendered.length, 0); assert.ok(!f.events.includes('login'));
  }
});
test('expired access clears view and logs out', async () => {
  const f = fixture(async () => { throw Error('expired'); });
  await assert.rejects(f.adapter.open('group', 'c2')); assert.equal(f.events[0], 'clear'); assert.ok(f.events.includes('logout'));
});
test('foreign cached SDK session is logged out before authentication', async () => {
  const f = fixture(undefined, { getLoggedInUser: async () => ({ getUid: () => 'someone_else' }) });
  await f.adapter.open('group', 'c2'); assert.ok(f.events.indexOf('logout') < f.events.indexOf('login'));
});
test('SDK identity mismatch fails closed', async () => {
  const f = fixture(undefined, { loginWithAuthToken: async () => ({ getUid: () => 'wrong' }) });
  await assert.rejects(f.adapter.open('group', 'c2')); assert.equal(f.rendered.length, 0);
});
test('account, role or membership changes during login prevent rendering', async () => {
  for (const mutate of [s => { s.user.uid = 'other'; }, s => { s.user.role = 'moderator'; }, s => { s.rooms = []; }]) {
    let reads = 0;
    const f = fixture(async () => { const s = session(); if (++reads > 1) mutate(s); return s; });
    await assert.rejects(f.adapter.open('group', 'c2')); assert.equal(f.rendered.length, 0);
  }
});
test('verified staff retain outgoing call presentation', async () => {
  for (const role of ['moderator', 'super_moderator']) {
    const f = fixture(async () => ({ ...session(), user: { uid: 'test_student', role } }));
    await f.adapter.open('group', 'c2'); assert.equal(f.rendered[0].canStartCalls, true);
  }
});
test('disposal during login prevents late render and future opens', async () => {
  let release;
  const f = fixture(undefined, { loginWithAuthToken: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.adapter.open('group', 'c2');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await f.adapter.dispose(); release({ getUid: () => 'test_student' });
  await assert.rejects(pending); await assert.rejects(f.adapter.open('group', 'c2')); assert.equal(f.rendered.length, 0);
});

const staffSession = () => ({ ...session(), user: { uid: 'test_student', role: 'moderator' } });
const targetGrant = () => ({ actor: staffSession().user, target: { uid: 'selected_student' }, roomGuid: 'c2' });
test('staff student route checks server authorization before and after SDK login', async () => {
  let checks = 0;
  const f = fixture(async () => staffSession(), {}, async args => {
    assert.deepEqual(args, { uid: 'selected_student', roomGuid: 'c2' });
    checks++; return targetGrant();
  });
  await f.adapter.open('user', 'selected_student', 'c2');
  assert.equal(checks, 2);
  assert.deepEqual(f.rendered, [{ type: 'user', id: 'selected_student', role: 'moderator', canStartCalls: true, roomGuid: 'c2' }]);
});
test('staff route without a shared room or authorization provider never logs in', async () => {
  for (const room of [undefined, 'a1', 'c2']) {
    const f = fixture(async () => staffSession());
    await assert.rejects(f.adapter.open('user', 'selected_student', room));
    assert.ok(!f.events.includes('login')); assert.equal(f.rendered.length, 0);
  }
});
test('revoked or mismatched staff target grant never renders', async () => {
  for (const mutate of [g => { g.actor.uid = 'other'; }, g => { g.actor.role = 'student'; }, g => { g.target.uid = 'other'; }, g => { g.roomGuid = 'a1'; }]) {
    let checks = 0;
    const f = fixture(async () => staffSession(), {}, async () => {
      const grant = targetGrant(); if (++checks === 2) mutate(grant); return grant;
    });
    await assert.rejects(f.adapter.open('user', 'selected_student', 'c2'));
    assert.equal(f.rendered.length, 0); assert.ok(f.events.includes('logout'));
  }
});
