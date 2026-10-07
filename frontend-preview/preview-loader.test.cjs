const test = require('node:test');
const assert = require('node:assert/strict');
test('asset success clears handlers without removing loaded element', async () => {
  const { waitForChatAsset } = await import('./preview-loader.mjs');
  let removed = false;
  const element = { remove() { removed = true; } };
  await waitForChatAsset({ head: { append(el) { el.onload(); } } }, element);
  assert.equal(element.onload, null); assert.equal(element.onerror, null); assert.equal(removed, false);
});
test('failed assets reject and remove unusable element', async () => {
  const { waitForChatAsset } = await import('./preview-loader.mjs');
  let removed = false;
  const element = { remove() { removed = true; } };
  await assert.rejects(waitForChatAsset({ head: { append(el) { el.onerror(); } } }, element), /Не вдалося/);
  assert.equal(removed, true); assert.equal(element.onload, null);
});
test('stalled assets time out rather than leaving the page loading forever', async () => {
  const { waitForChatAsset } = await import('./preview-loader.mjs');
  let removed = false;
  const element = { remove() { removed = true; } };
  await assert.rejects(waitForChatAsset({ head: { append() {} } }, element, 5), /надто довго/);
  assert.equal(removed, true); assert.equal(element.onerror, null);
});
