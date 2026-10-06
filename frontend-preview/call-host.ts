import { CometChatCalls } from '@cometchat/calls-sdk-javascript';
import { CometChatUIKit } from '@cometchat/chat-uikit-react';
import { createCallSession } from './call-session.mjs';
import { mountCallControls } from './call-controls.mjs';
import './call-controls.css';

export type VerifiedCallGrant = {
  appId: string; allowed: boolean; uid: string; sessionId: string;
  type: 'VOICE' | 'VIDEO'; role: 'student' | 'moderator' | 'super_moderator';
  direction: 'incoming' | 'outgoing'; peerIsStaff: boolean; authToken: string;
};

// Must be called ONLY from a verified, accepted-call flow, never on page load.
// authorize is an integration requirement, NOT a newly implemented server API.
// The host owns SDK initialization and signaling cleanup for the accepted call.
export function mountPreviewCall({ container, authorize, onClose = async () => {} }: {
  container: HTMLElement; authorize: () => Promise<VerifiedCallGrant>; onClose?: () => Promise<void>;
}) {
  const doc = container.ownerDocument;
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const media = doc.createElement('div'); media.className = 'sd-call-media';
  const controls = doc.createElement('div');
  const exit = doc.createElement('button'); exit.type = 'button'; exit.textContent = 'Закрити дзвінок';
  container.lang = 'uk'; container.replaceChildren(status, media, controls, exit);
  const descriptions: Record<string,string> = {
    authorizing: 'Перевіряємо доступ до дзвінка…', joining: 'Приєднуємося до дзвінка…',
    active: 'Дзвінок підключено. Мікрофон і камера спочатку вимкнені.',
    ended: 'Дзвінок завершено.', failed: 'Не вдалося приєднатися. Закрийте вікно та спробуйте ще раз.',
    'connection-lost': 'З’єднання втрачено. Закрийте дзвінок і приєднайтеся повторно.',
  };
  let signalingClosed = false;
  const closeSignaling = () => { if(signalingClosed)return; signalingClosed=true; void onClose().catch(()=>{status.textContent='Не вдалося завершити сигналізацію дзвінка. Оновіть сторінку.';}); };
  const sdk = {
    getLoggedInUser: () => CometChatUIKit.getLoggedInUser(),
    generateToken: (id:string, token:string) => CometChatCalls.generateToken(id, token),
    addEventListener: CometChatCalls.addEventListener.bind(CometChatCalls),
    joinSession: CometChatCalls.joinSession.bind(CometChatCalls),
    leaveSession: CometChatCalls.leaveSession.bind(CometChatCalls),
  };
  const session = createCallSession({ sdk, authorize,
    mountControls: initial => mountCallControls(controls, {sdk:CometChatCalls, initial}),
    onState: phase => { status.textContent = descriptions[phase] || ''; if(phase==='ended'||phase==='failed')closeSignaling(); },
  });
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; session.dispose(); closeSignaling(); container.replaceChildren(); };
  exit.addEventListener('click', dispose);
  return { start: () => session.start(media), dispose };
}
