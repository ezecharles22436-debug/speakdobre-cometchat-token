const test = require('node:test');
const assert = require('node:assert/strict');
async function fixture(role = 'student', overrides = {}) {
  const { createPreviewFlow } = await import('./preview-flow.mjs');
  const events = []; let selector, navigation;
  const session = { token: 'synthetic', user: { uid: 'mem_sb_fixture', role }, rooms: [], staffContacts: [] };
  const flow = createPreviewFlow({ getSession: async () => session, showSelector: async value => { selector = value; events.push('selector'); }, hideSelector: () => events.push('hide'), mountChat: async () => { events.push('chat'); return { open: async (...args) => events.push(args), dispose: async () => events.push('dispose') }; }, mountNavigation: async value => { navigation = value; events.push('nav'); }, clear: () => events.push('clear'), ...overrides });
  return { flow, events, session, selector: () => selector, navigation: () => navigation };
}
test('student cannot mount chat until server-backed selector signals readiness', async () => {
  const f = await fixture(); await f.flow.start(); assert.deepEqual(f.events, ['selector']);
  await f.selector().onReady(); assert.deepEqual(f.events, ['selector','chat','nav','hide']);
  await f.navigation().app.chatWithGroup('c2'); assert.deepEqual(f.events.at(-1), ['group','c2',undefined,undefined]);
  assert.equal(await f.selector().onReady(), false);
});
test('staff bypass selector but never auto-open a conversation', async () => {
  const f = await fixture('moderator'); await f.flow.start(); assert.deepEqual(f.events, ['chat','nav','hide']);
});

test('returning student opens navigation after server verifies saved selection', async () => {
  const f = await fixture('student', { hasSavedSelection: async () => true });
  await f.flow.start(); assert.deepEqual(f.events, ['chat','nav','hide']);
});
test('selection check receives the authenticated session snapshot', async () => {
  let seen;
  const f = await fixture('student', { hasSavedSelection: async session => { seen = session; return true; } });
  await f.flow.start(); assert.equal(seen, f.session);
});

test('explicit change-groups intent still opens selector for returning student', async () => {
  const f = await fixture('student', { hasSavedSelection: async () => true });
  await f.flow.start({ chooseGroups: true }); assert.deepEqual(f.events, ['selector']);
});

test('unverified or pending memberships do not bypass selector', async () => {
  const f = await fixture('student', { hasSavedSelection: async () => false });
  await f.flow.start(); assert.deepEqual(f.events, ['selector']);
});

test('failed membership verification never mounts chat', async () => {
  const f = await fixture('student', { hasSavedSelection: async () => { throw Error('Unavailable'); } });
  await assert.rejects(f.flow.start(), /Unavailable/); assert.deepEqual(f.events, []);
});
test('changed identity after selecting groups cannot mount chat', async () => {
  const f = await fixture(); await f.flow.start(); f.session.user.uid = 'mem_sb_other';
  await assert.rejects(f.selector().onReady()); assert.ok(!f.events.includes('chat'));
});
test('disposal during SDK mounting closes the late result and never mounts navigation', async () => {
  let release, closed = false;
  const f = await fixture('moderator', { mountChat: () => new Promise(resolve => { release = resolve; }) });
  const start = f.flow.start(); while (!release) await new Promise(resolve => setImmediate(resolve));
  await f.flow.dispose(); release({ dispose: async () => { closed = true; } }); await start;
  assert.equal(closed, true); assert.ok(!f.events.includes('nav'));
});
