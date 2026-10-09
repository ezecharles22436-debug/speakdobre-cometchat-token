import test from 'node:test';
import assert from 'node:assert/strict';
import { phaseTimer } from './startup-timing.mjs';
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
