import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupSession } from './startup-session.mjs';

test('sequential and concurrent startup consumers share one authorization', async () => {
  let calls = 0, checks = 0;
  const client = createStartupSession({ load: async () => ({ token: ++calls }), checkIdentity: async () => { checks++; } });
  const sessions = await Promise.all([client.getSession(), client.getSession()]);
  assert.equal(sessions[0], sessions[1]);
  assert.equal(await client.getSession(), sessions[0]);
  assert.equal(calls, 1);
  assert.equal(checks, 2);
});
test('all post-startup requests obtain fresh authorization', async () => {
  let calls = 0;
  const client = createStartupSession({ load: async () => ++calls, checkIdentity: async () => {} });
  await client.getSession(); client.finish();
  assert.equal(await client.getSession(), 2);
  assert.equal(await client.getSession(), 3);
});
test('long startup cannot indefinitely reuse authorization', async () => {
  let time = 0, calls = 0;
  const client = createStartupSession({ load: async () => ++calls, checkIdentity: async () => {}, now: () => time });
  await client.getSession(); time = 10000;
  assert.equal(await client.getSession(), 2);
});
test('identity change rejects a previously successful startup session', async () => {
  let changed = false;
  const client = createStartupSession({ load: async () => ({}), checkIdentity: async () => { if (changed) throw Error('changed'); } });
  await client.getSession(); changed = true;
  await assert.rejects(client.getSession(), /changed/);
});
test('failed authorization never becomes a usable startup session', async () => {
  const client = createStartupSession({ load: async () => { throw Error('denied'); }, checkIdentity: async () => {} });
  await assert.rejects(client.getSession(), /denied/);
  await assert.rejects(client.getSession(), /denied/);
});
