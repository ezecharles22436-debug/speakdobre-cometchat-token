const test=require('node:test');
const assert=require('node:assert/strict');
const {stylesForRole}=require('../public/chat-room-presentation');
test('student presentation hides only outgoing call buttons',()=>{
  const css=stylesForRole('student');
  assert.match(css,/button\[title="Voice call"\]/);
  assert.match(css,/button\[title="Video call"\]/);
  assert.doesNotMatch(css,/composer|message|incoming|accept|reject/i);
});
test('moderator and owner calling UI is not hidden',()=>{
  assert.doesNotMatch(stylesForRole('moderator'),/display:none/);
  assert.doesNotMatch(stylesForRole('super_moderator'),/display:none/);
});
test('all roles keep the inner widget responsive after resizing',()=>{
  for(const role of ['student','moderator','super_moderator'])assert.match(stylesForRole(role),/max-width:100%!important/);
});
test('unverified roles cannot select a presentation',()=>{
  for(const role of [undefined,null,'admin','owner',''])assert.throws(()=>stylesForRole(role));
});
