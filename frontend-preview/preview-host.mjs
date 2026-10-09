import { mountPreviewChat, createStaffTargetClient } from './chat.tsx';
import { createPreviewSessionClient, PREVIEW_ORIGIN } from './preview-session-client.mjs';
import { createPreviewFlow } from './preview-flow.mjs';
import { createStartupSession } from './startup-session.mjs';
import { mountStaffManagement } from './staff-management.mjs';
import { createOwnerAccessClient } from './owner-access.mjs';

// Explicit host entry only; never auto-runs on import. The approved staging embed
// must load pinned SDK assets first and must NOT run the old widget concurrently.
export async function mountAuthenticatedPreview({ container, memberstack, roomSelector, roomNavigation, sessionClient, startupSession }) {
  if (!container || container.ownerDocument.defaultView.location.origin !== 'https://speakdobre.webflow.io') throw Error('Доступна лише тестова сторінка.');
  if (!roomSelector?.createClient || !roomSelector?.mount || !roomNavigation?.mount) throw Error('Не завантажено вибір груп.');
  const { getSession: loadSession, getMemberstackToken, checkIdentity } = sessionClient || createPreviewSessionClient({ pageOrigin: container.ownerDocument.defaultView.location.origin, memberstack });
  const startup = startupSession || createStartupSession({ load: loadSession, checkIdentity });
  const getSession = () => startup.getSession();
  // Validate account and entitlement before changing the host area or initializing SDK.
  const verifiedSession = await getSession();
  const doc = container.ownerDocument;
  const staffRoot = doc.createElement('div'), picker = doc.createElement('section'), rail = doc.createElement('nav'), chat = doc.createElement('div');
  container.replaceChildren(staffRoot, picker, rail, chat);
  const ownerAccess = verifiedSession.user.role === 'super_moderator'
    ? createOwnerAccessClient({endpoint:`${PREVIEW_ORIGIN}/api/chat-owner-access`,getToken:getMemberstackToken}) : undefined;
  const staffManagement = mountStaffManagement(staffRoot, { identity: verifiedSession.user, getSession, ownerAccess });
  const authorizeStudent = createStaffTargetClient({ endpoint: `${PREVIEW_ORIGIN}/api/chat-staff-target`, getMemberstackToken });
  const selectionClient = roomSelector.createClient({ endpoint: `${PREVIEW_ORIGIN}/api/chat-rooms`, getToken: getMemberstackToken });
  const flow = createPreviewFlow({
    getSession,
    hasSavedSelection: async session => {
      if (session.selection && typeof session.selection.ready === 'boolean' && typeof session.selection.pending === 'boolean') {
        return session.selection.ready && !session.selection.pending;
      }
      // Compatibility with an older backend during staged rollout.
      const saved = await selectionClient.load();
      return saved.pending === false && roomSelector.validSelection(saved.rooms, saved.selected);
    },
    showSelector: ({ onReady }) => roomSelector.mount({ container: picker, client: selectionClient, onReady }),
    hideSelector: () => {
      picker.hidden = true;
      if (doc.defaultView.location.hash === '#choose-groups') doc.defaultView.history.replaceState(null, '', doc.defaultView.location.pathname + doc.defaultView.location.search);
    },
    mountChat: () => mountPreviewChat({ container: chat, appId: '168437005e7f6fa2a', getSession, authorizeStudent, staffManagement }),
    mountNavigation: options => roomNavigation.mount({ ...options, root: rail, onChangeGroups: () => { doc.defaultView.location.hash = 'choose-groups'; doc.defaultView.location.reload(); } }),
    clear: () => { staffManagement?.dispose(); container.replaceChildren(); },
  });
  try { await flow.start({ chooseGroups: doc.defaultView.location.hash === '#choose-groups', verifiedSession }); return flow; }
  catch (error) { await flow.dispose(); throw error; }
  finally { startup.finish(); }
}
