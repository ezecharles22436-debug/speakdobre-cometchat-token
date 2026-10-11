// SpeakDobre notification conversation routing v1. Links grant no access.
// Register before Firebase, which otherwise handles FCM_MSG clicks itself.
self.addEventListener('notificationclick', function (event) {
  event.stopImmediatePropagation();
  event.notification.close();
  const destination = new URL(notificationDestination(event.notification.data), self.location.origin).href;
  event.waitUntil((async function () {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      // Never replace a profile, checkout or unrelated site's tab.
      if (url.origin !== self.location.origin || !/^\/practice-chat\/?$/.test(url.pathname)) continue;
      try {
        const navigated = await client.navigate(destination);
        if (navigated) { await navigated.focus(); return; }
      } catch { /* A closed/stale tab should not swallow the click. */ }
    }
    const opened = await clients.openWindow(destination);
    if (opened) await opened.focus();
  })());
});

function notificationDestination(notificationData) {
  function record(value) {
    if (typeof value === 'string' && value.length < 32768) {
      try { value = JSON.parse(value); } catch { return {}; }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  const outer = record(notificationData);
  // Existing page-generated notifications and Firebase automatic background
  // notifications retain their original data in these documented envelopes.
  const data = record(outer.FCM_MSG ? record(outer.FCM_MSG).data : outer.payload || outer);
  const uid = /^mem_[A-Za-z0-9_-]{1,96}$/;
  if (data.type !== 'chat' || data.receiverType !== 'user' ||
      typeof data.sender !== 'string' || typeof data.receiver !== 'string' ||
      !uid.test(data.sender) || !uid.test(data.receiver) || data.sender === data.receiver) return '/practice-chat';
  return '/practice-chat#' + new URLSearchParams({
    'sd-notification': 'private', from: data.sender, to: data.receiver,
  }).toString();
}

// This worker has no fetch/cache handler. Activate its click fix without
// waiting for every existing Practice Chat tab to be closed.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(clients.claim()));

importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: 'AIzaSyA_9cQQp0iK6lL-7m-d0RJsO0O-Bocx-V0',
  authDomain: 'speakdobre.firebaseapp.com', projectId: 'speakdobre',
  storageBucket: 'speakdobre.firebasestorage.app', messagingSenderId: '628396776245',
  appId: '1:628396776245:web:f33a04a1391b7945950a7c', measurementId: 'G-PJ38CXYMCQ',
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(function (payload) {
  // Firebase already displays notification payloads. Showing another would
  // duplicate the same notification. Data-only messages still need display.
  if (payload.notification) return;
  const data = payload.data || {};
  return self.registration.showNotification(data.title || data.senderName || 'Нове повідомлення у SpeakDobre', {
    body: data.body || 'Відкрий Practice Chat, щоб переглянути.',
    tag: data.tag || data.conversationId || 'speakdobre-chat', renotify: true,
    icon: 'https://www.speakdobre.com/favicon.ico', badge: 'https://www.speakdobre.com/favicon.ico',
    data: { url: '/practice-chat', payload: data },
  });
});
