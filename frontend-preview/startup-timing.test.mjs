import test from 'node:test';
import assert from 'node:assert/strict';
import { phaseTimer, reportServerTiming, timeClientStep } from './startup-timing.mjs';
test('timing diagnostics are silent in production and reject arbitrary labels', () => {
  const before = globalThis.location, info = console.info, calls = [];
  console.info = (...args) => calls.push(args);
  try {
    globalThis.location = { origin: 'https://www.speakdobre.com' };
    phaseTimer('authorization')(); assert.equal(calls.length, 0);
    globalThis.location = { origin: 'https://speakdobre.webflow.io' };
    phaseTimer('arbitrary private payload')(); assert.equal(calls.length, 0);
    phaseTimer('authorization')(); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 2), ['[sd-perf]', 'authorization']);
    assert.equal(typeof calls[0][2], 'number'); assert.equal(calls[0].length, 3);
  } finally { console.info = info; if (before === undefined) delete globalThis.location; else globalThis.location = before; }
});
test('server timing logger rejects arbitrary header text and stays silent in production',()=>{
  const before=globalThis.location, info=console.info, calls=[];
  console.info=(...args)=>calls.push(args);
  try {
    globalThis.location={origin:'https://www.speakdobre.com'};reportServerTiming('member;dur=12');assert.equal(calls.length,0);
    globalThis.location={origin:'https://speakdobre.webflow.io'};
    reportServerTiming('private=secret, member;dur=12.5, token;dur=invalid');
    assert.deepEqual(calls,[['[sd-server]','member',12.5]]);
  } finally {console.info=info;if(before===undefined)delete globalThis.location;else globalThis.location=before;}
});

test('client timings preserve values and failures without logging either', async () => {
  const before = globalThis.location, info = console.info, calls = [];
  console.info = (...args) => calls.push(args);
  try {
    globalThis.location = { origin: 'https://speakdobre.webflow.io' };
    const privateValue = { token: 'synthetic-private' };
    assert.equal(await timeClientStep('cookie', async () => privateValue), privateValue);
    const failure = new Error('synthetic-private-error');
    await assert.rejects(timeClientStep('request', async () => { throw failure; }), error => error === failure);
    assert.deepEqual(calls.map(row => row.slice(0, 2)), [['[sd-perf]', 'cookie'], ['[sd-perf]', 'request']]);
    assert.ok(calls.every(row => row.length === 3 && typeof row[2] === 'number'));
    globalThis.location = { origin: 'https://www.speakdobre.com' };
    await timeClientStep('cookie', async () => privateValue);
    assert.equal(calls.length, 2);
  } finally { console.info = info; if (before === undefined) delete globalThis.location; else globalThis.location = before; }
});
