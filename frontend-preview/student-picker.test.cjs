const test=require('node:test'),assert=require('node:assert/strict');
const session=()=>({token:'synthetic',user:{uid:'mem_mod',role:'moderator'},rooms:[{guid:'room',unlocked:true}]});
const member=(uid,scope='participant')=>({getUid:()=>uid,getScope:()=>scope,getName:()=> 'Студент'});
async function fixture(options={}){
 const {createStudentPicker}=await import('./student-picker.mjs');const states=[],selected=[],reads=[];
 const picker=createStudentPicker({identity:session().user,roomGuid:'room',getSession:async()=>session(),createRequest:(room,size)=>{reads.push([room,size]);return{fetchNext:async()=>[member('mem_student')]};},authorizeStudent:async({uid,roomGuid})=>({actor:session().user,target:{uid},roomGuid}),onSelect:async(...args)=>selected.push(args),onState:s=>states.push(s),...options});
 return{picker,states,selected,reads};
}
test('fetch is on demand and scoped to one group; selected target reauthorized',async()=>{const f=await fixture();assert.deepEqual(f.reads,[]);await f.picker.loadMore();await f.picker.select('mem_student');assert.deepEqual(f.reads,[['room',30]]);assert.deepEqual(f.selected,[['mem_student','room']]);f.picker.dispose();});
test('students cannot construct picker',async()=>{const {createStudentPicker}=await import('./student-picker.mjs');assert.throws(()=>createStudentPicker({identity:{uid:'mem_student',role:'student'},roomGuid:'room'}));});
test('lost group access prevents any member query',async()=>{const f=await fixture({getSession:async()=>({...session(),rooms:[]})});await f.picker.loadMore();assert.deepEqual(f.reads,[]);assert.deepEqual(f.states.at(-1).rows,[]);});
test('identity change while fetching discards returned participants',async()=>{let count=0;const f=await fixture({getSession:async()=>({...session(),user:{uid:++count===1?'mem_mod':'mem_other',role:'moderator'}})});await f.picker.loadMore();assert.deepEqual(f.states.at(-1).rows,[]);});
test('pagination filters staff, invalid IDs and duplicates',async()=>{const f=await fixture({createRequest:()=>({fetchNext:async()=>[member('mem_student'),member('mem_student'),member('mem_staff','moderator'),member('invalid')]})});await f.picker.loadMore();assert.equal(f.states.at(-1).rows.length,1);assert.equal(f.states.at(-1).more,false);});
test('arbitrary unseen target and denied subscription never open direct chat',async()=>{const f=await fixture({authorizeStudent:async()=>{throw Error('expired');}});await f.picker.loadMore();assert.equal(await f.picker.select('mem_unknown'),false);assert.equal(await f.picker.select('mem_student'),false);assert.deepEqual(f.selected,[]);});
test('dispose while loading suppresses late rows and UI writes',async()=>{let resolve;const f=await fixture({createRequest:()=>({fetchNext:()=>new Promise(r=>{resolve=r;})})});const pending=f.picker.loadMore();while(!resolve)await new Promise(r=>setImmediate(r));f.picker.dispose();const count=f.states.length;resolve([member('mem_student')]);await pending;assert.equal(f.states.length,count);});
