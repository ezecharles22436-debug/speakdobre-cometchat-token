const test = require('node:test');
const assert = require('node:assert/strict');
const { createBootstrap } = require('../public/chat-room-bootstrap');
const session = role => ({ token: 'synthetic', user: { uid: 'mem_student', role } });
test('student chat waits for server-confirmed selector and refreshes authentication', async () => {
  let ready, starts = 0, reads = 0, hidden = 0;
  await createBootstrap({ getSession: async () => { reads++; return session('student'); },
    showSelector: async options => { ready = options.onReady; }, startChat: async () => { starts++; }, hideSelector: () => { hidden++; } })();
  assert.equal(starts, 0); await ready(); await ready();
  assert.equal(starts, 1); assert.equal(reads, 2); assert.equal(hidden, 1);
});
test('expired entitlement after selector prevents chat startup', async () => {
  let reads = 0, ready;
  await createBootstrap({ getSession: async () => { if (++reads > 1) throw new Error('expired'); return session('student'); },
    showSelector: async options => { ready = options.onReady; }, startChat: async () => assert.fail('must not open'), hideSelector() {} })();
  await assert.rejects(ready(), /expired/);
});
test('account switch while selecting fails closed', async () => {
  let reads = 0, ready;
  await createBootstrap({ getSession: async () => ({ ...session('student'), user: { uid: ++reads === 1 ? 'mem_one' : 'mem_two', role: 'student' } }),
    showSelector: async options => { ready = options.onReady; }, startChat: async () => assert.fail('must not open'), hideSelector() {} })();
  await assert.rejects(ready(), /Акаунт змінився/);
});
test('verified staff bypass student picker, unknown roles never open', async () => {
  for (const role of ['moderator', 'super_moderator']) {
    let starts = 0;
    await createBootstrap({ getSession: async () => session(role), showSelector: async () => assert.fail('staff picker'),
      startChat: async () => { starts++; }, hideSelector() {} })();
    assert.equal(starts, 1);
  }
  await assert.rejects(createBootstrap({ getSession: async () => session('default') })());
});

test('role change during room selection requires reload',async()=>{
  let ready,reads=0;
  await createBootstrap({getSession:async()=>session(++reads===1?'student':'moderator'),
    showSelector:async o=>{ready=o.onReady;},startChat:async()=>assert.fail('must not open'),hideSelector(){}})();
  await assert.rejects(ready(),/Права доступу/);
});
