import test from 'node:test';
import assert from 'node:assert/strict';
import { staffPresentation, mountStaffManagement } from './staff-management.mjs';
function fixture(role='moderator') {
  const doc={createElement:()=>({children:[],attrs:{},handlers:{},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;this.textContent='';},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.handlers[k]=fn;}})};
  const container=doc.createElement();container.ownerDocument=doc;
  const identity={uid:'mem_staff',role};let session={token:'synthetic',user:{...identity}};
  const panel=mountStaffManagement(container,{identity,getSession:async()=>session});
  return {container,panel,setSession:value=>session=value,toggle:container.children[0]?.children[1],body:container.children[1]};
}
test('students and unrecognized roles receive no staff interface',()=>{
  for(const role of ['student','admin','',undefined]){assert.equal(staffPresentation(role),null);const f=fixture(role===undefined?'':role);assert.equal(f.panel,null);assert.equal(f.container.children.length,0);}
});
test('moderator and owner have explicit distinct role labels',async()=>{
  for(const role of ['moderator','super_moderator']){
    const f=fixture(role);assert.equal(f.container.children[0].children[0].textContent,staffPresentation(role).label);
    assert.equal(f.body.hidden,true);await f.toggle.handlers.click();assert.equal(f.body.hidden,false);assert.equal(f.toggle.attrs['aria-expanded'],'true');
    await f.toggle.handlers.click();assert.equal(f.body.hidden,true);
  }
});
test('opening panel revalidates identity, role and session',async()=>{
  for(const session of [null,{token:'synthetic',user:{uid:'other',role:'moderator'}},{token:'synthetic',user:{uid:'mem_staff',role:'student'}},{user:{uid:'mem_staff',role:'moderator'}}]){
    const f=fixture();f.setSession(session);await f.toggle.handlers.click();assert.equal(f.body.hidden,true);
  }
});
test('clear removes previous group members and disposal removes staff controls',()=>{
  const f=fixture();f.panel.content.append({private:'synthetic'});f.panel.clear();assert.equal(f.panel.content.children.length,0);
  f.panel.setGroup('C2');assert.match(f.body.children[0].textContent,/C2/);f.panel.dispose();assert.equal(f.container.children.length,0);
});
