import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudentInbox,conversationSummary} from './student-inbox.mjs';
const identity={uid:'mem_student',role:'student'};
const session=()=>({token:'synthetic-only',user:{...identity},staffContacts:['mem_owner','mem_moderator']});
const row=uid=>({uid,name:uid==='mem_owner'?'Керівник':'Модератор',preview:'Вітаємо!',unread:2,sentAt:uid==='mem_owner'?100:200});
function fixture(overrides={}) {
  const states=[],reads=[],selected=[];let listener,unsubscribed=0,prepared=0;
  const inbox=createStudentInbox({identity,getSession:async()=>session(),prepare:async()=>{prepared++;return session();},readContact:async uid=>{reads.push(uid);return row(uid);},
    subscribe:callbacks=>{listener=callbacks;return()=>unsubscribed++;},onSelect:async uid=>{selected.push(uid);return true;},onState:state=>states.push(state),...overrides});
  return {inbox,states,reads,selected,get listener(){return listener;},get unsubscribed(){return unsubscribed;},get prepared(){return prepared;}};
}
test('student-only initialization makes no provider calls until started',()=>{
  for(const role of ['moderator','super_moderator','default',undefined])assert.throws(()=>createStudentInbox({identity:{uid:'mem_student',role}}));
  assert.deepEqual(fixture().reads,[]);
});
test('only unique authorized staff contacts are read; recent conversations and unread totals appear',async()=>{
  const f=fixture({getSession:async()=>({...session(),staffContacts:['mem_owner','mem_owner','mem_moderator','mem_student','invalid'] }),prepare:async()=>({...session(),staffContacts:['mem_owner','mem_owner','mem_moderator','mem_student','invalid']})});
  assert.equal(await f.inbox.refresh(),true);assert.deepEqual(f.reads,['mem_owner','mem_moderator']);
  assert.deepEqual(f.states.at(-1).rows.map(r=>r.uid),['mem_moderator','mem_owner']);assert.equal(f.states.at(-1).unread,4);assert.deepEqual(f.selected,[]);
});
test('returning to the inbox reuses connection but freshly checks access',async()=>{
  const f=fixture();await f.inbox.refresh();await f.inbox.select('mem_owner');await f.inbox.refresh();await f.inbox.select('mem_owner');
  assert.equal(f.prepared,1);assert.deepEqual(f.selected,['mem_owner','mem_owner']);assert.equal(f.states.at(-1).rows.find(r=>r.uid==='mem_owner').unread,0);
});
test('arbitrary peer selection never reaches the message adapter',async()=>{
  const f=fixture();await f.inbox.refresh();assert.equal(await f.inbox.select('mem_peer'),false);assert.deepEqual(f.selected,[]);
});
test('contact removed before a metadata request prevents that request',async()=>{
  const f=fixture({getSession:async()=>({...session(),staffContacts:[]})});
  assert.equal(await f.inbox.refresh(),false);assert.deepEqual(f.reads,[]);assert.deepEqual(f.states.at(-1).rows,[]);
});
test('identity, role and entitlement changes discard all metadata',async()=>{
  for(const changed of [null,{...session(),token:''},{...session(),user:{uid:'mem_other',role:'student'}},{...session(),user:{...identity,role:'moderator'}}]){
    let switched=false;const f=fixture({getSession:async()=>switched?changed:session(),readContact:async uid=>{switched=true;return row(uid);}});
    assert.equal(await f.inbox.refresh(),false);assert.deepEqual(f.states.at(-1).rows,[]);
  }
});
test('contact revocation during metadata fetch discards all rows',async()=>{
  let changed=false;const f=fixture({getSession:async()=>({...session(),staffContacts:changed?['mem_owner']:session().staffContacts}),readContact:async uid=>{changed=true;return row(uid);}});
  assert.equal(await f.inbox.refresh(),false);assert.deepEqual(f.states.at(-1).rows,[]);
});
test('unavailable provider metadata preserves a permitted route without fabricated counts',async()=>{
  const f=fixture({readContact:async()=>{throw Error('Denied');}});assert.equal(await f.inbox.refresh(),true);
  assert.equal(f.states.at(-1).rows.length,2);assert.ok(f.states.at(-1).rows.every(r=>r.unread===null));assert.equal(await f.inbox.select('mem_owner'),true);
});
test('foreign provider result is never displayed',async()=>{
  const f=fixture({readContact:async()=>({...row('mem_peer'),name:'Private peer'})});await f.inbox.refresh();assert.ok(f.states.at(-1).rows.every(r=>r.name!=='Private peer'));
});
test('SDK listener ignores group messages, peer senders and messages for another account',async()=>{
  const f=fixture();await f.inbox.refresh();const count=f.reads.length;
  for(const [type,sender,recipient] of [['group','mem_owner','mem_student'],['user','mem_peer','mem_student'],['user','mem_owner','mem_other']])
    f.listener.message({getReceiverType:()=>type,getReceiverId:()=>recipient,getSender:()=>({getUid:()=>sender})});
  await new Promise(r=>setImmediate(r));assert.equal(f.reads.length,count);
});
test('authorized incoming event refreshes the inbox without sending or opening anything',async()=>{
  const f=fixture();await f.inbox.refresh();f.listener.message({getReceiverType:()=> 'user',getReceiverId:()=>identity.uid,getSender:()=>({getUid:()=> 'mem_owner'})});
  await new Promise(r=>setImmediate(r));assert.equal(f.reads.length,4);assert.deepEqual(f.selected,[]);
});
test('logout removes private metadata and blocks stale contact clicks',async()=>{
  const f=fixture();await f.inbox.refresh();f.listener.logout();assert.deepEqual(f.states.at(-1).rows,[]);assert.equal(await f.inbox.select('mem_owner'),false);
});
test('revoked contact cannot be opened and failed opens do not mark messages read',async()=>{
  let revoked=false;const f=fixture({getSession:async()=>({...session(),staffContacts:revoked?[]:session().staffContacts})});
  await f.inbox.refresh();revoked=true;assert.equal(await f.inbox.select('mem_owner'),false);assert.deepEqual(f.selected,[]);assert.deepEqual(f.states.at(-1).rows,[]);
  const failed=fixture({onSelect:async()=>false});await failed.inbox.refresh();assert.equal(await failed.inbox.select('mem_owner'),false);assert.deepEqual(failed.states.at(-1).rows,[]);
});
test('disposal suppresses delayed results and removes all listeners',async()=>{
  let release;const f=fixture({readContact:uid=>new Promise(r=>{release=()=>r(row(uid));}),prepare:async()=>({...session(),staffContacts:['mem_owner']})});
  const pending=f.inbox.refresh();while(!release)await new Promise(r=>setImmediate(r));f.inbox.dispose();const count=f.states.length;release();await pending;
  assert.equal(f.states.length,count);assert.equal(f.unsubscribed,1);
});
test('concurrent refresh is coalesced and navigation never opens a busy row',async()=>{
  let release;let once=true;const f=fixture({readContact:async uid=>{if(once){once=false;await new Promise(r=>{release=r;});}return row(uid);}});
  const pending=f.inbox.refresh();while(!release)await new Promise(r=>setImmediate(r));void f.inbox.refresh();assert.equal(await f.inbox.select('mem_owner'),false);release();await pending;await new Promise(r=>setImmediate(r));
  assert.equal(f.prepared,1);assert.deepEqual(f.selected,[]);assert.equal(f.states.at(-1).busy,false);
});
test('summaries support existing text and media, and reject a different peer or group',()=>{
  const user={getUid:()=> 'mem_owner',getName:()=>'<script>not HTML</script>'};
  const conversation=(type='text')=>({getConversationType:()=> 'user',getConversationWith:()=>user,getUnreadMessageCount:()=>2,getLastMessage:()=>({getType:()=>type,getText:()=> 'Привіт',getSentAt:()=>123})});
  assert.equal(conversationSummary('mem_owner',user,conversation()).preview,'Привіт');assert.equal(conversationSummary('mem_owner',user,conversation('audio')).preview,'Голосове повідомлення');
  assert.throws(()=>conversationSummary('mem_peer',user,conversation()));assert.throws(()=>conversationSummary('mem_owner',user,{...conversation(),getConversationType:()=> 'group'}));
  assert.equal(conversationSummary('mem_owner',user,null).unread,null);
});
