// No real accounts, provider calls, messages, purchases, or permissions.
import {mountStudentInbox} from './student-inbox.mjs';
const identity={uid:'mem_local_student',role:'student'};
const contacts=[
  {uid:'mem_local_owner',name:'Олександр · Команда SpeakDobre',preview:'Вітаю! Як проходить ваша практика цього тижня?',unread:1,sentAt:200},
  {uid:'mem_local_moderator',name:'Марія · Модератор',preview:'Можете написати мені, якщо потрібна допомога з групою.',unread:0,sentAt:100},
];
const getSession=async()=>({token:'synthetic-only',user:identity,staffContacts:contacts.map(row=>row.uid)});
const inbox=mountStudentInbox(document.querySelector('#inbox'),{
  identity,getSession,prepare:getSession,readContact:async uid=>({...contacts.find(row=>row.uid===uid)}),
  onSelect:async uid=>{const row=contacts.find(row=>row.uid===uid);if(!row)return false;row.unread=0;
    document.querySelector('#selected-title').textContent=row.name;document.querySelector('#selected-message').textContent=row.preview;return true;},
  onOpened:()=>document.querySelector('#conversation').scrollIntoView({block:'nearest'}),
});
document.querySelectorAll('[data-room]').forEach(button=>button.addEventListener('click',()=>{
  inbox.close();document.querySelector('#selected-title').textContent=button.dataset.room;
  document.querySelector('#selected-message').textContent='Ви повернулися до групи. Особиста розмова залишається доступною через «Повідомлення».';
}));
void inbox.start();
