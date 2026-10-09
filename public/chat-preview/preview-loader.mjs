import { createPreviewSessionClient } from './preview-session-client.mjs';
import { createStartupSession } from './startup-session.mjs';
const BASE = new URL('./', import.meta.url);
const ORIGIN = 'https://speakdobre-cometchat-git-db9a07-ezecharles22436-4127s-projects.vercel.app';
export function waitForChatAsset(doc, element, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); element.onload = element.onerror = null;
      if (error) { element.remove(); reject(error); } else resolve();
    };
    const timer = setTimeout(() => finish(Error('Завантаження чату триває надто довго. Оновіть сторінку.')), timeoutMs);
    element.onload = () => finish();
    element.onerror = () => finish(Error('Не вдалося завантажити компоненти чату. Оновіть сторінку.'));
    try { doc.head.append(element); } catch (error) { finish(error); }
  });
}
export async function startSpeakDobrePreview({ container, memberstack }) {
  if (location.origin !== 'https://speakdobre.webflow.io' || BASE.origin !== ORIGIN) throw Error('Доступна лише ізольована версія.');
  const sessionClient = createPreviewSessionClient({ pageOrigin: location.origin, memberstack });
  const startupSession = createStartupSession({ load: sessionClient.getSession, checkIdentity: sessionClient.checkIdentity });
  // Observe rejection immediately while public assets download in parallel.
  const authorization = startupSession.getSession().then(value => ({ value }), error => ({ error }));
  try {
  const response = await fetch(new URL('preview-manifest.json', BASE), { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('Не вдалося завантажити пакет чату.');
  const manifest = await response.json();
  const asset = name => {
    if (typeof name !== 'string' || !/^assets\/[A-Za-z0-9_.-]+$/.test(name)) throw Error('Некоректний пакет чату.');
    return new URL(name, BASE).href;
  };
  const styles = manifest.css.map(name => {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = asset(name);
    return waitForChatAsset(document, link);
  });
  const script = path => {
    const element = document.createElement('script'); element.src = new URL(path, BASE).href;
    return waitForChatAsset(document, element);
  };
  const selectorCss = document.createElement('link'); selectorCss.rel = 'stylesheet'; selectorCss.href = new URL('../chat-room-selector.css', BASE).href;
  await Promise.all([
    ...styles, waitForChatAsset(document, selectorCss),
    script('vendor/chat-sdk-4.2.0.js').then(() => script('vendor/calls-sdk-5.0.6.js')),
    window.SpeakDobreRoomSelector ? Promise.resolve() : script('../chat-room-selector.js'),
    window.SpeakDobreRoomNavigation ? Promise.resolve() : script('../chat-room-navigation.js'),
  ]);
  const { mountAuthenticatedPreview } = await import(asset(manifest.entry));
  const authorized = await authorization;
  if (authorized.error) throw authorized.error;
  return await mountAuthenticatedPreview({ container, memberstack, roomSelector: window.SpeakDobreRoomSelector, roomNavigation: window.SpeakDobreRoomNavigation, sessionClient, startupSession });
  } finally { startupSession.finish(); }
}
