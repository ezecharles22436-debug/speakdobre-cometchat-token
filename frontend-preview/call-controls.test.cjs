const test = require('node:test');
const assert = require('node:assert/strict');
async function fixture(overrides = {}, timeoutMs = 100) {
  const { createCallControls } = await import('./call-controls.mjs');
  const events = new Map(), calls = [], states = [];
  const sdk = { addEventListener(name, fn) { events.set(name, fn); return () => events.delete(name); } };
  for (const method of ['muteAudio','unmuteAudio','pauseVideo','resumeVideo','startScreenSharing','stopScreenSharing','leaveSession']) sdk[method] = () => calls.push(method);
  Object.assign(sdk, overrides);
  const controls = createCallControls({ sdk, initial: { audioMuted:true, videoPaused:true, screenSharing:false }, onChange:s => states.push(s), timeoutMs });
  return { controls, events, calls, states };
}
test('mount never enables microphone, camera or screen automatically', async () => {
  const f = await fixture(); assert.deepEqual(f.calls, []); f.controls.dispose();
});
test('media state changes only after SDK event and rapid duplicate clicks are blocked', async () => {
  const f = await fixture(); await f.controls.act('audio'); await f.controls.act('audio');
  assert.deepEqual(f.calls, ['unmuteAudio']); assert.equal(f.states.at(-1).audioMuted, true);
  f.events.get('onAudioUnMuted')(); assert.equal(f.states.at(-1).audioMuted, false);
  await f.controls.act('audio'); assert.equal(f.calls.at(-1), 'muteAudio'); f.controls.dispose();
});
test('camera and screen controls use documented methods and react to external stop', async () => {
  const f = await fixture(); await f.controls.act('video'); assert.equal(f.calls.at(-1), 'resumeVideo');
  f.events.get('onVideoResumed')(); await f.controls.act('screen'); assert.equal(f.calls.at(-1), 'startScreenSharing');
  f.events.get('onScreenShareStarted')(); f.events.get('onScreenShareStopped')(); assert.equal(f.states.at(-1).screenSharing, false); f.controls.dispose();
});
test('permission failure yields Ukrainian error and allows retry', async () => {
  const f = await fixture({ unmuteAudio() { throw Error('permission'); } });
  assert.equal(await f.controls.act('audio'), false); assert.match(f.states.at(-1).error, /Не вдалося/); assert.equal(f.states.at(-1).pending,null); f.controls.dispose();
});
test('missing SDK event times out rather than reporting success', async () => {
  const f = await fixture({}, 10); await f.controls.act('audio'); await new Promise(r=>setTimeout(r,25));
  assert.equal(f.states.at(-1).audioMuted,true); assert.equal(f.states.at(-1).pending,null); assert.match(f.states.at(-1).error,/Не вдалося/); f.controls.dispose();
});
test('leave affects only local participant and prevents further actions', async () => {
  const f = await fixture(); await f.controls.act('leave'); assert.deepEqual(f.calls,['leaveSession']);
  assert.equal(f.states.at(-1).active,true); f.events.get('onSessionLeft')();
  assert.equal(await f.controls.act('audio'),false); f.controls.dispose();
});
test('connection loss disables controls until a fresh verified mount', async () => {
  const f = await fixture(); f.events.get('onConnectionLost')();
  assert.match(f.states.at(-1).error,/відкрийте його повторно/);
  assert.doesNotMatch(f.states.at(-1).error,/Очікуємо/);
  assert.equal(await f.controls.act('audio'),false); assert.match(f.states.at(-1).error,/З’єднання втрачено/); f.controls.dispose();
});
test('dispose removes event listeners and ignores late SDK completion', async () => {
  let release; const f = await fixture({ leaveSession:()=>new Promise(r=>{release=r;}) });
  const pending=f.controls.act('leave');f.controls.dispose();const count=f.states.length;release();await pending;
  assert.equal(f.events.size,0);assert.equal(f.states.length,count);
});
