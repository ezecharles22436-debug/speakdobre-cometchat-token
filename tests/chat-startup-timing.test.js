const test = require('node:test'), assert = require('node:assert/strict');
const { createStartupTiming } = require('../api/_chat-startup-timing');
const req = { headers: { origin: 'https://speakdobre.webflow.io' } };
const preview = { VERCEL_ENV: 'preview', COMETCHAT_APP_ID: '168437005e7f6fa2a' };
test('timing headers require Preview environment, app and origin together', async () => {
  for (const [request, env] of [[req, {...preview, VERCEL_ENV:'production'}], [req, {...preview, COMETCHAT_APP_ID:'1677376866e3f736f'}], [{headers:{origin:'https://www.speakdobre.com'}},preview]]) {
    const headers={}, t=createStartupTiming(request,env);
    assert.equal(await t.run('verify',async()=>7),7); t.attach({setHeader:(k,v)=>headers[k]=v});assert.deepEqual(headers,{});
  }
});
test('timing emits fixed labels and durations, never action result or arbitrary labels', async()=>{
  let time=0; const headers={}, t=createStartupTiming(req,preview,()=>time);
  await t.run('verify',async()=>{time=12;return 'private';});
  await t.run('private-payload',async()=>42);
  t.attach({setHeader:(k,v)=>headers[k]=v});
  assert.equal(headers['Server-Timing'],'verify;dur=12.0');
  assert.equal(headers['Access-Control-Expose-Headers'],'Server-Timing');
  await assert.rejects(t.run('member',async()=>{throw Error('denied');}),/denied/);
});
