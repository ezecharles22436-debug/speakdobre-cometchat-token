const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(__dirname + '/firebase-messaging-sw.js','utf8');
function fixture(windows=[]) {
  const handlers={},events=[],shown=[],opened=[];let background;
  const context=vm.createContext({URL,URLSearchParams,
    clients:{matchAll:async()=>windows,claim:async()=>{},openWindow:async url=>{opened.push(url);return{focus:async()=>events.push('focus-new')};}},
    self:{location:{origin:'https://www.speakdobre.com'},skipWaiting:async()=>{},
      addEventListener:(name,fn)=>{handlers[name]=fn;events.push(name);},registration:{showNotification:async(...args)=>shown.push(args)}},
    importScripts:()=>events.push('firebase-import'),firebase:{initializeApp:()=>{},messaging:()=>({onBackgroundMessage:fn=>{background=fn;}})},
  });vm.runInContext(source,context);
  return {context,events,shown,opened,background:payload=>background(payload),click:async data=>{
    let pending;handlers.notificationclick({notification:{data,close:()=>events.push('close')},stopImmediatePropagation:()=>events.push('stop'),waitUntil:p=>{pending=p;}});await pending;
  }};
}
const data={type:'chat',receiverType:'user',sender:'mem_staff',receiver:'mem_student'};
const expected='https://www.speakdobre.com/practice-chat#sd-notification=private&from=mem_staff&to=mem_student';
test('old foreground, data-only and Firebase automatic payloads route to the same conversation',async()=>{
  for(const value of [{payload:data},{payload:JSON.stringify(data)},{FCM_MSG:{data}},data]){
    const f=fixture();await f.click(value);assert.deepEqual(f.opened,[expected]);
  }
});
test('click handler precedes Firebase and stops double handling',async()=>{
  const f=fixture();assert.ok(f.events.indexOf('notificationclick')<f.events.indexOf('firebase-import'));
  await f.click({payload:data});assert.equal(f.events.filter(e=>e==='stop').length,1);
});
test('reuses only chat tabs and awaits navigation before focus',async()=>{
  const events=[];const f=fixture([
    {url:'https://www.speakdobre.com/profile',navigate:()=>{throw Error('Do not navigate profile');}},
    {url:'https://evil.invalid/practice-chat',navigate:()=>{throw Error('Do not navigate other origin');}},
    {url:'https://www.speakdobre.com/practice-chat',navigate:async url=>{events.push(url);return{focus:async()=>events.push('focused')};}},
  ]);await f.click({payload:data});assert.deepEqual(events,[expected,'focused']);assert.deepEqual(f.opened,[]);
});
test('closed chat window falls back to a new window',async()=>{
  for(const navigate of [async()=>null,async()=>{throw Error('closed');}]){
    const f=fixture([{url:'https://www.speakdobre.com/practice-chat',navigate}]);await f.click({payload:data});assert.deepEqual(f.opened,[expected]);
  }
});
test('malformed, group, call and arbitrary URLs cannot produce a private route',async()=>{
  for(const payload of [null,{},'invalid',{...data,receiverType:'group'},{...data,type:'call'},
    {...data,sender:'https://evil.invalid'},{...data,sender:data.receiver},{...data,receiver:null}]){
    const f=fixture();await f.click({url:'https://evil.invalid',payload});assert.deepEqual(f.opened,['https://www.speakdobre.com/practice-chat']);
  }
});
test('automatic background notification is not duplicated; data-only notification keeps routing metadata',async()=>{
  const f=fixture();await f.background({notification:{title:'existing'},data});assert.equal(f.shown.length,0);
  await f.background({data});assert.equal(f.shown.length,1);await f.click(f.shown[0][1].data);assert.deepEqual(f.opened,[expected]);
});
test('no message sending, API calls, tokens or remote redirects in click code',()=>{
  assert.doesNotMatch(source,/sendMessage|fetch\(|getToken|localStorage|postMessage|click_action/);
});
