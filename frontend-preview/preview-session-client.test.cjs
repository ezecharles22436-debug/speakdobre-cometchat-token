const test = require('node:test');
const assert = require('node:assert/strict');
async function fixture(overrides = {}) {
  const { createPreviewSessionClient } = await import('./preview-session-client.mjs');
  const requests = [];
  const session = { token: 'synthetic-chat', user: { uid: 'mem_sb_fixture', role: 'student' }, rooms: [], staffContacts: [] };
  const client = createPreviewSessionClient({ pageOrigin: 'https://speakdobre.webflow.io', memberstack: { getCurrentMember: async () => ({ data: { id: 'mem_sb_fixture' } }), getMemberCookie: async () => 'synthetic-member' }, fetcher: async (...args) => { requests.push(args); return { ok: true, json: async () => session }; }, ...overrides });
  return { client, requests, session };
}
test('Preview client pins endpoint and uses a fresh in-memory credential without redirects', async () => {
  const f = await fixture(); assert.equal((await f.client.getSession()).user.uid, 'mem_sb_fixture');
  const [url, request] = f.requests[0];
  assert.equal(url, 'https://speakdobre-cometchat-git-db9a07-ezecharles22436-4127s-projects.vercel.app/api/cometchat-token');
  assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'no-store');
  assert.equal(request.headers.Authorization, 'Bearer synthetic-member');
});
test('production page or live member cannot request Preview session', async () => {
  await assert.rejects(fixture({ pageOrigin: 'https://www.speakdobre.com' }));
  const f = await fixture({ memberstack: { getCurrentMember: async () => ({ data: { id: 'mem_live' } }) } });
  await assert.rejects(f.client.getSession()); assert.equal(f.requests.length, 0);
});
test('account change during cookie retrieval never transmits token', async () => {
  let reads = 0;
  const f = await fixture({ memberstack: { getCurrentMember: async () => ({ data: { id: ++reads === 1 ? 'mem_sb_fixture' : 'mem_sb_other' } }), getMemberCookie: async () => 'synthetic' } });
  await assert.rejects(f.client.getSession()); assert.equal(f.requests.length, 0);
});
test('foreign server identity or unknown role is rejected', async () => {
  for (const mutate of [s => { s.user.uid = 'mem_sb_other'; }, s => { s.user.role = 'unknown'; }, s => { s.staffContacts = null; }]) {
    const f = await fixture(); mutate(f.session); await assert.rejects(f.client.getSession());
  }
});
test('upstream error content is never shown to students', async () => {
  const f = await fixture({ fetcher: async () => ({ ok: false, status: 500, json: async () => ({ error: 'sensitive upstream detail' }) }) });
  await assert.rejects(f.client.getSession(), error => !error.message.includes('sensitive'));
});

test('startup identity check uses one member read and no credential or server request', async () => {
  let reads=0, cookies=0, id='mem_sb_fixture';
  const f=await fixture({memberstack:{getCurrentMember:async()=>{reads++;return {data:{id}};},getMemberCookie:async()=>{cookies++;return 'synthetic';}}});
  await f.client.checkIdentity();
  assert.equal(reads,1);assert.equal(cookies,0);assert.equal(f.requests.length,0);
  id='mem_sb_other';await assert.rejects(f.client.checkIdentity());
});
