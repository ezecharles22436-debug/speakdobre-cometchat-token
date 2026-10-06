const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'chat.tsx'), 'utf8');
const core = require('./uk.json'), extra = require('./uk-extra.json');
const uk = { ...core, ...extra };
const compat = require('./uk-compat.json');

test('legacy vendor lookup keys are translated and installed, including edit and loading states', () => {
  const dir = path.join(__dirname, 'node_modules/@cometchat/chat-uikit-react/dist');
  const requested = new Set();
  for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of text.matchAll(/getLocalizedString\("([A-Z][A-Z_]*)"\)/g)) requested.add(match[1]);
  }
  assert.deepEqual(Object.keys(compat).sort(), [...requested].sort());
  for (const value of Object.values(compat)) assert.match(value, /[А-Яа-яІіЇїЄє]/);
  assert.match(source, /import ukCompat from '\.\/uk-compat\.json'/);
  assert.match(source, /addTranslation\(\{ uk: \{ \.\.\.uk, \.\.\.ukExtra, \.\.\.ukCompat \} \}\)/);
});
test('entry rejects production app and contains no auth-key initialization', () => {
  assert.match(source, /appId !== '168437005e7f6fa2a'/);
  assert.doesNotMatch(source, /setAuthKey|subscribePresenceForAllUsers|localStorage|sessionStorage/);
});
test('prototype omits directories and peer-message shortcut', () => {
  assert.doesNotMatch(source, /CometChatUsers|CometChatGroups|CometChatConversations/);
  assert.match(source, /hideMessagePrivatelyOption/);
  assert.match(source, /hideVoiceCallButton=\{!outgoing\}/);
  assert.match(source, /hideVideoCallButton=\{!outgoing\}/);
  assert.match(source, /onVoiceCallClick=/);
  assert.match(source, /onVideoCallClick=/);
});
test('renderer uses explicit Ukrainian locale and core accessible labels', () => {
  assert.match(source, /locale="uk"/);
  for (const key of ['accessibility_send_message', 'message_composer_placeholder', 'message_list_option_delete', 'message_header_typing']) {
    assert.match(uk[key], /[А-Яа-яІіЇїЄє]/);
  }
});
test('translation keys match pinned vendor dictionary and preserve placeholders', () => {
  const bundle = fs.readFileSync(path.join(__dirname, 'node_modules/@cometchat/chat-uikit-react/dist/chunk-3GBHHLFM.js'), 'utf8');
  const block = bundle.slice(bundle.indexOf('var translation_default = {'), bundle.indexOf('\n};'));
  const entries = Object.fromEntries([...block.matchAll(/^  ([a-z0-9_]+): ("(?:[^"\\]|\\.)*")/gm)].map(m => [m[1], JSON.parse(m[2])]));
  const placeholders = value => [...value.matchAll(/\{[^}]+\}/g)].map(m => m[0]).sort();
  for (const [key, value] of Object.entries(uk)) {
    assert.ok(Object.hasOwn(entries, key), `Unknown vendor key: ${key}`);
    assert.deepEqual(placeholders(value), placeholders(entries[key]), key);
  }
  assert.deepEqual(Object.keys(core).filter(key => Object.hasOwn(extra, key)), [], 'No shadowed translations');
  const missing = Object.keys(entries).filter(key => !Object.hasOwn(uk, key));
  assert.deepEqual(missing, [], 'Every pinned vendor label requires a translation');
  console.log(`Locale coverage: ${Object.keys(uk).length}/${Object.keys(entries).length} pinned vendor keys. Browser wording/layout verification remains required.`);
});
