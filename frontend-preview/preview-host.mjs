import { mountPreviewChat, createStaffTargetClient } from './chat.tsx';
import { createPreviewSessionClient, PREVIEW_ORIGIN } from './preview-session-client.mjs';
import { createPreviewFlow } from './preview-flow.mjs';

// Explicit host entry only; never auto-runs on import. The approved staging embed
// must load pinned SDK assets first and must NOT run the old widget concurrently.
export async function mountAuthenticatedPreview({ container, memberstack, roomSelector, roomNavigation }) {
  if (!container || container.ownerDocument.defaultView.location.origin !== 'https://speakdobre.webflow.io') throw Error('Доступна лише тестова сторінка.');
  if (!roomSelector?.createClient || !roomSelector?.mount || !roomNavigation?.mount) throw Error('Не завантажено вибір груп.');
  const { getSession, getMemberstackToken } = createPreviewSessionClient({ pageOrigin: container.ownerDocument.defaultView.location.origin, memberstack });
  // Validate account and entitlement before changing the host area or initializing SDK.
  await getSession();
  const doc = container.ownerDocument;
  const picker = doc.createElement('section'), rail = doc.createElement('nav'), chat = doc.createElement('div');
  container.replaceChildren(picker, rail, chat);
  const authorizeStudent = createStaffTargetClient({ endpoint: `${PREVIEW_ORIGIN}/api/chat-staff-target`, getMemberstackToken });
  const flow = createPreviewFlow({
    getSession,
    showSelector: ({ onReady }) => roomSelector.mount({ container: picker, client: roomSelector.createClient({ endpoint: `${PREVIEW_ORIGIN}/api/chat-rooms`, getToken: getMemberstackToken }), onReady }),
    hideSelector: () => { picker.hidden = true; },
    mountChat: () => mountPreviewChat({ container: chat, appId: '168437005e7f6fa2a', getSession, authorizeStudent }),
    mountNavigation: options => roomNavigation.mount({ ...options, root: rail, onChangeGroups: () => doc.defaultView.location.reload() }),
    clear: () => { container.replaceChildren(); },
  });
  try { await flow.start(); return flow; }
  catch (error) { await flow.dispose(); throw error; }
}
