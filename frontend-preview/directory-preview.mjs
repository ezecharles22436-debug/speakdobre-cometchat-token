// Synthetic local UI only. Never sends provider requests or messages.
import {mountStaffManagement} from './staff-management.mjs';
import {mountStudentDirectory} from './student-directory.mjs';
const identity={uid:'mem_local_staff',role:'super_moderator'};
const rooms=[{guid:'a1',name:'A1–A2 · Початковий',unlocked:true},{guid:'c2',name:'C2 · Вільне володіння',unlocked:true},{guid:'travel',name:'Подорожі',unlocked:true}];
const getSession=async()=>({token:'synthetic-not-a-credential',user:identity,rooms});
const staff=mountStaffManagement(document.querySelector('#staff'),{identity,getSession});
const names=['Олена Коваль','Андрій Бондаренко','Марія — довге ім’я для перевірки мобільного вигляду'];
const directory=mountStudentDirectory(staff.directoryRoot,{identity,getSession,prepare:getSession,
  createRequest:(guid,limit,query)=>({fetchNext:async()=>names.map((name,i)=>({getUid:()=>`mem_fixture_${i}`,getScope:()=> 'participant',getRole:()=> 'student',getName:()=>name})).filter((row,i)=>(guid==='travel'||(guid==='a1'?i<2:i===2))&&row.getName().toLowerCase().includes(query.toLowerCase()))}),
  onSelect:async uid=>{document.querySelector('#selection').textContent=`Відкрито особисту розмову: ${names[Number(uid.slice(-1))]}. Повідомлень не надіслано.`;return true;}});
staff.bindDirectory(directory.open);
