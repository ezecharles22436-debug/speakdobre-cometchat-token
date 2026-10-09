import React from 'react';
import { phaseTimer } from './startup-timing.mjs';
import { createRoot } from 'react-dom/client';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { CometChatUIKit, UIKitSettingsBuilder, CometChatLocalize,
  CometChatMessageHeader, CometChatMessageList, CometChatMessageComposer } from '@cometchat/chat-uikit-react';
import '@cometchat/chat-uikit-react/styles';
import './chat.css';
import uk from './uk.json';
import ukExtra from './uk-extra.json';
import ukCompat from './uk-compat.json';
import { createSessionAdapter } from './session-adapter.cjs';
import { createIncomingCalls } from './incoming-calls.mjs';
import { createOutgoingCalls } from './outgoing-calls.mjs';
import { mountPreviewCall } from './call-host';
import { mountStudentPicker } from './student-picker.mjs';
import { moderateGroupMember } from './member-moderation.mjs';
import { ReportProvider as CometChatProvider } from './report-provider';
export { mountPreviewCall } from './call-host';
export { createStaffTargetClient } from './staff-target-client.mjs';

type Session = { token: string; user: { uid: string; role: string }; rooms: { guid: string; name: string; unlocked: boolean }[]; staffContacts: string[] };
type View = { type: 'group' | 'user'; id: string; role: string; canStartCalls: boolean; roomGuid?: string };

// Isolated integration entry point, not imported by Webflow. No automatic login.
// The host must retain the existing server-confirmed group selector before mounting.
export async function mountPreviewChat({ container, appId, getSession, authorizeStudent }: {
  container: HTMLElement; appId: string; getSession: () => Promise<Session>;
  authorizeStudent?: (target:{uid:string;roomGuid:string}) => Promise<any>;
}) {
  if (appId !== '168437005e7f6fa2a') throw Error('Доступна лише ізольована версія чату.');
  await CometChatUIKit.init(new UIKitSettingsBuilder().setAppId(appId).setRegion('eu').setCallingEnabled(true).build());
  // Pinned UI Kit composer still requests legacy keys absent from its dictionary.
  CometChatLocalize.getSharedInstance().addTranslation({ uk: { ...uk, ...ukExtra, ...ukCompat } });
  const doc = container.ownerDocument;
  const messages = doc.createElement('div'), offers = doc.createElement('div'), callSurface = doc.createElement('div'), studentPicker=doc.createElement('div');
  offers.setAttribute('aria-live','polite'); offers.className='sd-incoming-offer';
  container.replaceChildren(messages,studentPicker,offers,callSurface);
  const root = createRoot(messages);
  container.classList.add('sd-isolated-chat');
  container.lang = 'uk';
  let generation = 0;
  let incoming: ReturnType<typeof createIncomingCalls> | undefined;
  let activeCall: ReturnType<typeof mountPreviewCall> | undefined;
  let outgoing: ReturnType<typeof createOutgoingCalls> | undefined;
  let removeStudentPicker: (()=>void) | undefined;
  const clear = () => {
    removeStudentPicker?.();removeStudentPicker=undefined;
    generation++; incoming?.dispose(); incoming=undefined; activeCall?.dispose(); activeCall=undefined;
    if(outgoing){const previous=outgoing;outgoing=undefined;void previous.cancel().catch(()=>{});previous.dispose();}
    root.render(<p role="status">Оберіть групу або зверніться до модератора.</p>);
  };
  const adapter = createSessionAdapter({
    getSession,
    authorizeStudent,
    sdk: {
      getLoggedInUser: () => CometChatUIKit.getLoggedInUser(),
      logout: () => CometChatUIKit.logout(),
      loginWithAuthToken: async (token: string) => {
        const done = phaseTimer('sdk-login');
        try { return await CometChatUIKit.loginWithAuthToken(token); }
        finally { done(); }
      },
    },
    clear,
    async render(view: View) {
      const done = phaseTimer('group-render');
      const version = generation;
      const entity = view.type === 'group' ? { group: await CometChat.getGroup(view.id) } : { user: await CometChat.getUser(view.id) };
      done();
      if (version !== generation) return;
      if(view.canStartCalls&&view.type==='group'&&authorizeStudent){
        removeStudentPicker=mountStudentPicker(studentPicker,{
          identity:{uid:CometChatUIKit.getLoggedInUser()?.getUid(),role:view.role},roomGuid:view.id,roomName:entity.group?.getName(),getSession,authorizeStudent,
          moderateMember:args=>moderateGroupMember({...args,sdk:CometChat,identity:{uid:CometChatUIKit.getLoggedInUser()?.getUid(),role:view.role}}),
          createRequest:(guid:string,limit:number)=>new CometChat.GroupMembersRequestBuilder(guid).setLimit(limit).setScopes(['participant']).build(),
          onSelect:(uid:string,guid:string)=>adapter.open('user',uid,guid),
        });
      }
      if(view.canStartCalls&&view.type==='user'&&view.roomGuid&&authorizeStudent){
        outgoing=createOutgoingCalls({chat:CometChat,getSession,authorizeTarget:authorizeStudent,
          identity:{uid:CometChatUIKit.getLoggedInUser()?.getUid(),role:view.role},
          onState:state=>{
            offers.replaceChildren();const label=doc.createElement('p');
            label.textContent=state==='ringing'?'Очікуємо на відповідь…':state==='checking'?'Перевіряємо доступ…':state==='failed'?'Не вдалося розпочати дзвінок.':'';offers.append(label);
            if(state==='ringing'){const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='Скасувати виклик';cancel.addEventListener('click',()=>{void outgoing?.cancel();});offers.append(cancel);}
          },
          onAccepted:async({authorize,finish})=>{activeCall?.dispose();activeCall=mountPreviewCall({container:callSurface,authorize,onClose:finish});await activeCall.start();},
          onEnded:()=>{activeCall?.dispose();activeCall=undefined;},
        });
      }
      incoming = createIncomingCalls({ chat:CometChat, getSession,
        identity:{uid:CometChatUIKit.getLoggedInUser()?.getUid(),role:view.role},
        onOffer: offer => {
          offers.replaceChildren(); if(!offer)return;
          const label=doc.createElement('p');label.textContent=`${offer.type==='audio'?'Аудіодзвінок':'Відеодзвінок'} від модератора: ${offer.callerName}`;
          const accept=doc.createElement('button'), decline=doc.createElement('button');
          accept.type=decline.type='button';accept.textContent='Прийняти';decline.textContent='Відхилити';
          accept.addEventListener('click',()=>{void incoming?.accept();});decline.addEventListener('click',()=>{void incoming?.decline();});
          offers.append(label,accept,decline);
        },
        onAccepted: async ({authorize,finish}) => {
          activeCall?.dispose();
          activeCall=mountPreviewCall({container:callSurface,authorize,onClose:finish});
          await activeCall.start();
        },
        onEnded:()=>{activeCall?.dispose();activeCall=undefined;},
        onError:message=>{offers.textContent=message;},
      });
      root.render(<CometChatProvider theme="light" locale="uk" moderation={view.type==='group'&&view.canStartCalls?
        {identity:{uid:CometChatUIKit.getLoggedInUser()?.getUid()||'',role:view.role},roomGuid:view.id,getSession}:undefined}>
        <section className="sd-message-panel" aria-label="Кімната розмовної практики">
          <CometChatMessageHeader {...entity} hideBackButton hideUserStatus
            hideVoiceCallButton={!outgoing} hideVideoCallButton={!outgoing}
            onVoiceCallClick={()=>{void outgoing?.start({uid:view.id,roomGuid:view.roomGuid},'audio');}}
            onVideoCallClick={()=>{void outgoing?.start({uid:view.id,roomGuid:view.roomGuid},'video');}}
            showSearchOption={false} hidePinnedMessagesOption />
          <div className="sd-message-list"><CometChatMessageList {...entity}
            hideMessagePrivatelyOption hideReplyInThreadOption hideTranslateMessageOption /></div>
          <CometChatMessageComposer {...entity} placeholder="Напишіть повідомлення…" hideAIButton hideStickersButton />
        </section>
      </CometChatProvider>);
    },
  });
  clear();
  return { open: adapter.open, async dispose() { try { await adapter.dispose(); } finally { root.unmount(); container.replaceChildren(); } } };
}
