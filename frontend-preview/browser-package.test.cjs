const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('browser entry loads pinned local SDKs before importing chat and never logs in', () => {
  const entry = fs.readFileSync('browser-entry.mjs', 'utf8');
  assert.match(entry, /chat-sdk-4\.2\.0\.js/);
  assert.match(entry, /calls-sdk-5\.0\.6\.js/);
  assert.ok(entry.indexOf('document.head.append(script)') < entry.indexOf("import('./chat.tsx')"));
  assert.doesNotMatch(entry, /https?:|loginWithAuthToken|mountPreviewChat\s*\(|initiateCall\s*\(/);
});
test('browser packaging intercepts SDK imports before Vite dependency resolution', () => {
  const config = fs.readFileSync('vite.browser.config.mjs', 'utf8');
  assert.match(config, /enforce: 'pre'/);
  assert.match(config, /CometChatException, PIN_SAVE_SENTINELS/);
  assert.match(config, /outDir: 'browser-dist'/);
  for (const [name, version] of [['chat-sdk-javascript','4.2.0'],['calls-sdk-javascript','5.0.6']]) {
    assert.equal(JSON.parse(fs.readFileSync(`node_modules/@cometchat/${name}/package.json`)).version, version);
  }
});
