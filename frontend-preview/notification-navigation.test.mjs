import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotificationIntent, createNotificationNavigation } from './notification-navigation.mjs';

const hash = '#sd-notification=private&from=mem_staff&to=mem_student';
const session = () => ({ token: 'synthetic', user: { uid: 'mem_student', role: 'student' }, staffContacts: ['mem_staff'] });
function fixture(overrides = {}) {
  let current = hash; const opened = [], statuses = [];
  const router = createNotificationNavigation({ readHash: () => current, consumeHash: () => { current = ''; },
    getSession: async () => session(), openConversation: async id => { opened.push(id); return true; }, status: text => statuses.push(text), ...overrides });
  return { router, opened, statuses, hash: () => current, setHash: value => { current = value; } };
}
test('strict recipient-bound private intent', () => {
  assert.deepEqual(parseNotificationIntent(hash), {sender:'mem_staff', recipient:'mem_student'});
  for (const invalid of ['', '#choose-groups', '#sd-notification=group&from=mem_staff&to=mem_student',
    hash+'&from=mem_other', hash+'&url=https://evil.invalid', hash.replace('mem_staff','mem_student'),
    hash.replace('mem_staff','https://evil.invalid'), hash.replace('&to=mem_student',''), '#'+ 'x'.repeat(400)]) {
    assert.equal(parseNotificationIntent(invalid), null);
  }
});
test('opens existing staff conversation once and clears only its intent', async () => {
  const f = fixture(); assert.equal(await f.router.openPending(), true);
  assert.deepEqual(f.opened,['mem_staff']); assert.equal(f.hash(),'');
  assert.equal(await f.router.openPending(), false); assert.equal(f.statuses.at(-1),'');
});
test('wrong recipient, peer, missing session and staff account never open a conversation', async () => {
  for (const value of [null, {...session(),token:''}, {...session(),user:{uid:'mem_other',role:'student'}},
    {...session(),staffContacts:[]}, {...session(),user:{uid:'mem_student',role:'moderator'}}]) {
    const f=fixture({getSession:async()=>value});assert.equal(await f.router.openPending(),false);assert.deepEqual(f.opened,[]);
  }
});
test('changed hash during authentication is not consumed or opened', async () => {
  let release;const f=fixture({getSession:()=>new Promise(resolve=>{release=resolve;})});
  const pending=f.router.openPending();f.setHash('#choose-groups');release(session());
  assert.equal(await pending,false);assert.equal(f.hash(),'#choose-groups');assert.deepEqual(f.opened,[]);
});
test('dispose during authentication stops navigation and UI updates',async()=>{
  let release;const f=fixture({getSession:()=>new Promise(resolve=>{release=resolve;})});
  const pending=f.router.openPending();f.router.dispose();release(session());await pending;
  assert.deepEqual(f.opened,[]);assert.deepEqual(f.statuses,[]);
});
test('session failure or revoked permission leaves normal navigation usable',async()=>{
  for(const overrides of [{getSession:async()=>{throw Error('expired');}}, {openConversation:async()=>{throw Error('revoked');}}, {openConversation:async()=>false}]){
    const f=fixture(overrides);assert.equal(await f.router.openPending(),false);assert.match(f.statuses.at(-1),/Особисті повідомлення/);
  }
});
test('overlapping event handling does not open twice',async()=>{
  let release;const f=fixture({getSession:()=>new Promise(resolve=>{release=resolve;})});
  const first=f.router.openPending();assert.equal(await f.router.openPending(),false);release(session());await first;
  assert.equal(f.opened.length,1);
});
