const BASE = new URL('./', import.meta.url);
const ORIGIN = 'https://speakdobre-cometchat-token.vercel.app';
export async function startSpeakDobrePreview({ container, memberstack }) {
  if (location.origin !== 'https://www.speakdobre.com' || BASE.origin !== ORIGIN) throw Error('Неправильна конфігурація чату.');
  const response = await fetch(new URL('preview-manifest.json', BASE), { credentials: 'omit', cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw Error('Не вдалося завантажити пакет чату.');
  const manifest = await response.json();
  const asset = name => {
    if (typeof name !== 'string' || !/^assets\/[A-Za-z0-9_.-]+$/.test(name)) throw Error('Некоректний пакет чату.');
    return new URL(name, BASE).href;
  };
  await Promise.all(manifest.css.map(name => new Promise((resolve, reject) => {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = asset(name);
    link.onload = resolve; link.onerror = () => reject(Error('Не завантажено стилі чату.')); document.head.append(link);
  })));
  const script = path => new Promise((resolve, reject) => {
    const element = document.createElement('script'); element.src = new URL(path, BASE).href;
    element.onload = resolve; element.onerror = () => reject(Error('Не завантажено компоненти чату.')); document.head.append(element);
  });
  await script('vendor/chat-sdk-4.2.0.js');
  await script('vendor/calls-sdk-5.0.6.js');
  if (!window.SpeakDobreRoomSelector) await script('../chat-room-selector.js');
  if (!window.SpeakDobreRoomNavigation) await script('../chat-room-navigation.js');
  const selectorCss = document.createElement('link'); selectorCss.rel = 'stylesheet'; selectorCss.href = new URL('../chat-room-selector.css', BASE).href; document.head.append(selectorCss);
  const { mountAuthenticatedPreview } = await import(asset(manifest.entry));
  return mountAuthenticatedPreview({ container, memberstack, roomSelector: window.SpeakDobreRoomSelector, roomNavigation: window.SpeakDobreRoomNavigation });
}
