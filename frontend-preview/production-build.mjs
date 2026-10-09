// Fixed, build-time production variant. Never choose the environment from a URL
// parameter or user input. The original Preview sources stay independently pinned.
const previewOrigin = 'https://speakdobre-cometchat-git-db9a07-ezecharles22436-4127s-projects.vercel.app';
const productionOrigin = 'https://speakdobre-cometchat-token.vercel.app';
const approvedFiles = new Set(['preview-session-client.mjs', 'preview-host.mjs',
  'preview-loader.mjs', 'staff-target-client.mjs', 'chat.tsx', 'call-session.mjs',
  'incoming-calls.mjs', 'outgoing-calls.mjs']);

export function productionSource(source, filename) {
  const name = filename.replaceAll('\\', '/').split('/').pop();
  if (!approvedFiles.has(name)) return source;
  let result = source.replaceAll(previewOrigin, productionOrigin)
    .replaceAll('https://speakdobre.webflow.io', 'https://www.speakdobre.com')
    .replaceAll('168437005e7f6fa2a', '1677376866e3f736f');
  if (name === 'preview-session-client.mjs') {
    result = result.replace("import { phaseTimer, reportServerTiming } from './startup-timing.mjs';", 'const phaseTimer = () => () => {}; const reportServerTiming = () => {};');
    const guard = '/^mem_sb_[A-Za-z0-9_-]+$/';
    if (!result.includes(guard)) throw Error('Live member guard must be reviewed');
    result = result.replace(guard, '/^mem_(?!sb_)[A-Za-z0-9_-]+$/');
  }
  return result.replaceAll('Увійдіть до тестового акаунта.', 'Увійдіть до акаунта SpeakDobre.')
    .replaceAll('Ця версія доступна лише на тестовому сайті.', 'Відкрийте чат на сайті SpeakDobre.')
    .replaceAll('Доступна лише тестова сторінка.', 'Відкрийте чат на сайті SpeakDobre.')
    .replaceAll('Доступна лише ізольована версія чату.', 'Неправильна конфігурація чату.')
    .replaceAll('Доступна лише ізольована версія.', 'Неправильна конфігурація чату.')
    .replaceAll('Доступна лише перевірена Preview-адреса.', 'Неправильна адреса перевірки контакту.');
}
