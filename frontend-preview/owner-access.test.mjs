import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerAccessClient, mountOwnerAccess} from './owner-access.mjs';
test('owner client validates targets and requires authentication before sending',async()=>{
  let calls=0;
  const request=createOwnerAccessClient({endpoint:'https://example.com/api/chat-owner-access',getToken:async()=>null,fetcher:async()=>{calls++;}});
  await assert.rejects(request('mem_student','suspend'),/Увійдіть/);
  await assert.rejects(request('invalid','suspend'));
  await assert.rejects(request('mem_student','delete'));
  assert.equal(calls,0);
});
test('owner client sends authenticated no-cache request and verifies response identity',async()=>{
  let options;
  const request=createOwnerAccessClient({endpoint:'https://example.com/api/chat-owner-access',getToken:async()=>'synthetic',fetcher:async(url,opts)=>{options=opts;return {ok:true,json:async()=>({targetUid:'mem_other',status:'active'})};}});
  await assert.rejects(request('mem_student','status'),/Не підтверджено/);
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  assert.deepEqual(JSON.parse(options.body),{targetUid:'mem_student',action:'status'});
});
function fixture(request){
  const doc={createElement:tag=>({tag,children:[],handlers:{},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},setAttribute(){},addEventListener(k,f){this.handlers[k]=f;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();},focus(){}})};
  const root=doc.createElement('section');root.ownerDocument=doc;const dispose=mountOwnerAccess(root,request);
  const [, ,label,lookup,status,action,dialog]=root.children;
  return {root,dispose,input:label.children[0],lookup,status,action,dialog};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('pending lookup locks target input and failed revocation offers retry not restore',async()=>{
  let resolve;
  const f=fixture(()=>new Promise(r=>{resolve=r;}));f.input.value='mem_student';f.lookup.handlers.click();
  assert.equal(f.input.disabled,true);
  resolve({targetUid:'mem_student',status:'suspended',syncError:true});await tick();
  assert.equal(f.input.disabled,false);assert.equal(f.action.textContent,'Повторити призупинення');
  f.action.handlers.click();assert.equal(f.dialog.open,true);assert.match(f.dialog.children[0].textContent,/Призупинити/);
});
test('suspension is only sent after explicit confirmation and disposal suppresses updates',async()=>{
  const calls=[];const f=fixture(async(uid,action)=>{calls.push(action);return {targetUid:uid,status:action==='suspend'?'suspended':'active'};});
  f.input.value='mem_student';f.lookup.handlers.click();await tick();f.action.handlers.click();
  assert.deepEqual(calls,['status']);f.dialog.children[2].handlers.click();await tick();
  assert.deepEqual(calls,['status','suspend']);f.dispose();assert.equal(f.root.children.length,0);
});
