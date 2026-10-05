(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpeakDobreRoomBootstrap = api;
})(typeof window === 'undefined' ? {} : window, function () {
  'use strict';
  // Token responses must come directly from the authenticated server endpoint,
  // never from localStorage or client-editable Memberstack custom fields.
  function createBootstrap({ getSession, showSelector, startChat, hideSelector }) {
    let started = false, starting = false, identity;
    function check(session) {
      if (!session?.token || !session.user?.uid || !['student', 'moderator', 'super_moderator'].includes(session.user.role)) {
        throw new Error('Не вдалося перевірити доступ до чату.');
      }
      if (identity && session.user.uid !== identity) throw new Error('Акаунт змінився. Оновіть сторінку.');
      return session;
    }
    async function open() {
      if (started || starting) return;
      starting = true;
      try {
        // Recheck entitlement and obtain a fresh token after room selection.
        const fresh = check(await getSession());
        await startChat(fresh);
        started = true;
        hideSelector();
      } finally { starting = false; }
    }
    return async function boot() {
      const session = check(await getSession());
      identity = session.user.uid;
      if (session.user.role === 'student') {
        await showSelector({ onReady: open });
      } else {
        await open();
      }
    };
  }
  return { createBootstrap };
});
