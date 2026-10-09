// Framework-independent orchestration. Existing server-backed selector remains
// authoritative; no optimistic group membership or automatic room opening.
export function createPreviewFlow({ getSession, hasSavedSelection = async () => false, showSelector, hideSelector, mountChat, mountNavigation, clear }) {
  let identity, chat, disposed = false, starting = false, ready = false;
  function check(session) {
    if (disposed || !session?.token || !session.user?.uid || !['student','moderator','super_moderator'].includes(session.user.role)) throw Error('Сеанс чату недоступний.');
    if (identity && (identity.uid !== session.user.uid || identity.role !== session.user.role)) throw Error('Акаунт або права доступу змінилися.');
    return session;
  }
  async function open() {
    if (ready || starting || disposed) return false;
    starting = true;
    try {
      const session = check(await getSession());
      const mounted = await mountChat();
      if (disposed) { await mounted.dispose(); return false; }
      chat = mounted;
      const fresh = check(await getSession());
      await mountNavigation({ session: fresh, getSession: async () => check(await getSession()), app: {
        chatWithGroup: (id, verified) => chat.open('group', id, undefined, verified ? check(verified) : undefined),
        chatWithUser: (id, verified) => chat.open('user', id, undefined, verified ? check(verified) : undefined),
      } });
      if (disposed) return false;
      hideSelector(); ready = true; return true;
    } catch (error) {
      await chat?.dispose(); chat = undefined; clear(); throw error;
    } finally { starting = false; }
  }
  return {
    async start({ chooseGroups = false } = {}) {
      if (identity || disposed) throw Error('Перевірку вже розпочато.');
      const session = check(await getSession());
      identity = { uid: session.user.uid, role: session.user.role };
      if (identity.role === 'student' && (chooseGroups || !await hasSavedSelection(session))) await showSelector({ onReady: open });
      else await open();
    },
    async dispose() { disposed = true; await chat?.dispose(); chat = undefined; clear(); },
  };
}
