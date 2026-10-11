// Notification links are navigation hints, never authorization. No persistent
// storage, message text, tokens or arbitrary redirect URLs are accepted.
export function parseNotificationIntent(hash) {
  if (typeof hash !== 'string' || hash.length > 300) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const keys = [...params.keys()];
  if (keys.length !== 3 || new Set(keys).size !== 3 ||
      !keys.every(key => ['sd-notification', 'from', 'to'].includes(key)) ||
      params.get('sd-notification') !== 'private') return null;
  const sender = params.get('from'), recipient = params.get('to');
  const uid = /^mem_[A-Za-z0-9_-]{1,96}$/;
  if (!uid.test(sender || '') || !uid.test(recipient || '') || sender === recipient) return null;
  return { sender, recipient };
}

export function createNotificationNavigation({ readHash, consumeHash, getSession, openConversation, status = () => {} }) {
  let disposed = false, running = false;
  return {
    async openPending() {
      if (disposed || running) return false;
      const hash = readHash();
      const intent = parseNotificationIntent(hash);
      if (!intent) return false;
      running = true;
      try {
        const session = await getSession();
        if (disposed || readHash() !== hash) return false;
        consumeHash(hash);
        if (!session?.token || session.user?.role !== 'student' || session.user.uid !== intent.recipient ||
            !Array.isArray(session.staffContacts) || !session.staffContacts.includes(intent.sender)) {
          status('Не вдалося відкрити розмову зі сповіщення. Перевірте акаунт або відкрийте «Особисті повідомлення».');
          return false;
        }
        status('Відкриваємо особисту розмову…');
        // The existing adapter performs fresh identity/access checks before and
        // after SDK login. Do not pass a cached session or bypass those checks.
        const opened = await openConversation(intent.sender);
        if (!disposed) status(opened ? '' : 'Відкрийте розмову в розділі «Особисті повідомлення».');
        return opened === true;
      } catch {
        if (!disposed) status('Не вдалося відкрити розмову. Спробуйте «Особисті повідомлення».');
        return false;
      } finally { running = false; }
    },
    dispose() { disposed = true; },
  };
}
