const test = require('node:test');
const assert = require('node:assert/strict');
const { assessmentContact: contact } = require('../api/_assessment-contact');
const email = 'student@example.com';

test('old cached forms retain their email fallback', () => {
  assert.equal(contact({}, email).contactValue, email);
  assert.equal(contact({}, email).contactSchemaVersion, 1);
});
test('new forms require an explicit supported contact method', () => {
  for (const value of ['', null, 'sms', {}, '__proto__']) assert.equal(contact({contactMethod:value}, email), null);
  assert.equal(contact({contactValue:'@student'}, email), null);
});
test('Telegram handles and international numbers normalize without changing identity', () => {
  for (const value of ['student_name', '@student_name']) assert.equal(contact({contactMethod:'telegram',contactValue:value},email).contactValue,'@student_name');
  for (const method of ['telegram','whatsapp','viber']) {
    const result=contact({contactMethod:method,contactValue:'+380 (67) 123-45-67'},email);
    assert.equal(result.contactValue,'+380671234567');
    assert.equal(result.contactSchemaVersion,2);
    assert.match(result.contactSummary,/\+380671234567$/);
  }
});
test('email preference uses validated email, not a second arbitrary address', () => {
  assert.equal(contact({contactMethod:'email',contactValue:''},email).contactValue,email);
});
test('reject unusable, malformed, multiline, link and injection inputs', () => {
  for (const method of ['telegram','whatsapp','viber']) for (const value of ['', '0671234567', '+01234567890', '+123', '+1234567890123456', 'https://example.com', '<script>alert(1)</script>', '+380671234567\nBCC:evil@example.com', 'a'.repeat(81), {}, ['@student']]) {
    assert.equal(contact({contactMethod:method,contactValue:value},email),null,method+': '+String(value));
  }
  for (const method of ['whatsapp','viber']) assert.equal(contact({contactMethod:method,contactValue:'@student'},email),null);
});
