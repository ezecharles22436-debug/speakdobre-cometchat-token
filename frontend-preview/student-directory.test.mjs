import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudentDirectory} from './student-directory.mjs';
const identity={uid:'mem_staff',role:'moderator'};
const rooms=[{guid:'a1',name:'A1',unlocked:true},{guid:'c2',name:'C2',unlocked:true},{guid:'locked',unlocked:false}];
const session=()=>({token:'synthetic',user:identity,rooms});
const member=(uid='mem_student',role='student',scope='participant',name='Олена')=>({getUid:()=>uid,getName:()=>name,getRole:()=>role,getScope:()=>scope});
function fixture(overrides={}) {
  const states=[],requests=[],selected=[];
  const directory=createStudentDirectory({identity,getSession:async()=>session(),prepare:async()=>session(),createRequest:(...args)=>{requests.push(args);return {fetchNext:async()=>[member()]};},onSelect:async(...args)=>{selected.push(args);return true;},onState:s=>states.push(s),...overrides});
  return {directory,states,requests,selected};
}
test('directory is staff-only and makes no request before opening',()=>{
  for(const role of ['student','admin','',undefined])assert.throws(()=>createStudentDirectory({identity:{uid:'mem_student',role}}));
  assert.deepEqual(fixture().requests,[]);
});
test('both staff roles list only unlocked groups, merge duplicates, and preserve group context',async()=>{
  for(const role of ['moderator','super_moderator']) {
    const s=()=>({...session(),user:{...identity,role}});
    const f=fixture({identity:s().user,getSession:async()=>s(),prepare:async()=>s()});
    assert.equal(await f.directory.refresh(),true);
    assert.deepEqual(f.requests.map(r=>r[0]),['a1','c2']);
    assert.equal(f.states.at(-1).rows.length,1);
    assert.deepEqual(f.states.at(-1).rows[0].rooms.map(r=>r.guid),['a1','c2']);
    assert.deepEqual(f.selected,[]);
    assert.equal(await f.directory.select('mem_student'),true);
    assert.deepEqual(f.selected,[['mem_student','a1']]);
  }
});
test('search is sent to every permitted group, not just currently loaded rows',async()=>{
  const f=fixture();await f.directory.refresh('  Олена  ');
  assert.deepEqual(f.requests,[['a1',20,'Олена'],['c2',20,'Олена']]);
});
test('arbitrary, staff, self and invalid participants are excluded',async()=>{
  const f=fixture({createRequest:()=>({fetchNext:async()=>[member(),member('mem_staff'),member('mem_mod','moderator'),member('bad'),member('mem_admin','student','admin')]})});
  await f.directory.refresh();assert.deepEqual(f.states.at(-1).rows.map(r=>r.uid),['mem_student']);
  assert.equal(await f.directory.select('mem_arbitrary'),false);assert.deepEqual(f.selected,[]);
});
test('pagination preserves seen rows without duplicates',async()=>{
  const f=fixture({pageSize:1,createRequest:guid=>{let n=0;return {fetchNext:async()=>++n===1?[member()]:n===2?[member(`mem_${guid}`)]:[]};}});
  await f.directory.refresh();assert.equal(f.states.at(-1).more,true);
  await f.directory.more();assert.equal(f.states.at(-1).rows.length,3);
  await f.directory.more();assert.equal(f.states.at(-1).more,false);
});
test('identity, role and group access changes after provider fetch discard all rows',async()=>{
  for(const mutate of [s=>({...s,user:{...identity,uid:'mem_other'}}),s=>({...s,user:{...identity,role:'student'}}),s=>({...s,rooms:[]}),()=>null]) {
    let changed=false;
    const f=fixture({getSession:async()=>changed?mutate(session()):session(),createRequest:()=>({fetchNext:async()=>{changed=true;return [member()];}})});
    assert.equal(await f.directory.refresh(),false);assert.deepEqual(f.states.at(-1).rows,[]);
  }
});
test('failed target authorization clears stale list and never reports opened',async()=>{
  const f=fixture({onSelect:async()=>{throw Error('inactive');}});await f.directory.refresh();
  assert.equal(await f.directory.select('mem_student'),false);assert.deepEqual(f.states.at(-1).rows,[]);assert.match(f.states.at(-1).error,/Розмова недоступна/);
});
test('disposed directory suppresses delayed provider responses',async()=>{
  let release;const f=fixture({createRequest:()=>({fetchNext:()=>new Promise(r=>{release=r;})}),prepare:async()=>({...session(),rooms:[rooms[0]]})});
  const pending=f.directory.refresh();while(!release)await new Promise(r=>setImmediate(r));
  f.directory.dispose();const count=f.states.length;release([member()]);await pending;assert.equal(f.states.length,count);
});
test('provider failure produces retryable error instead of a misleading partial directory',async()=>{
  const f=fixture({createRequest:guid=>({fetchNext:async()=>{if(guid==='c2')throw Error('network');return [member()];}})});
  assert.equal(await f.directory.refresh(),false);assert.deepEqual(f.states.at(-1).rows,[]);
});
